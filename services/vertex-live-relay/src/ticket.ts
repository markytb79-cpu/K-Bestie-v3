// Next.js 앱(lib/plan/vertexLiveTicket.ts)이 발급한 티켓 검증 — 이 파일은 그 파일과
// 별도 배포 단위라서 서명 포맷을 중복 구현한다. 포맷을 바꿀 때는 반드시 양쪽을 같이 바꿀 것.
//
// 두 포맷을 동시에 받는다(하위호환):
// - legacy(버전 없음): payload = `${childId}:${exp}:${nonce}`,
//   ticket = base64url(`${payload}:${sig}`) — 4 세그먼트, voiceName 없음.
// - v1(버전 있음): innerB64 = base64url(JSON.stringify({childId, voiceName, exp, nonce})),
//   signedPayload = `v1:${innerB64}`, ticket = base64url(`${signedPayload}:${sig}`) — 3 세그먼트,
//   첫 세그먼트가 고정 문자열 "v1". childId는 UUID라 "v1"과 절대 겹치지 않아 포맷 구분이 안전하다.
//
// 세그먼트 개수를 계속 늘려나가는 방식(2026-07-16 사고 원인) 대신, 버전 태그로 포맷을 명시적으로
// 구분하고 그 안쪽은 JSON으로 구조화해 향후 필드 추가가 세그먼트 개수에 영향받지 않게 한다.

import crypto from "node:crypto";

export interface TicketDiag {
  ticketLength: number;
  segmentCount: number;
  /** null = 버전 판별 전/legacy. 0 = legacy(버전 없음). 1 = v1. */
  version: number | null;
  hasVoiceName: boolean;
  parseStage: string;
}

export interface TicketVerifyResult {
  valid: boolean;
  childId?: string;
  voiceName?: string;
  reason?: string;
  diag: TicketDiag;
}

// 1회성 사용 처리 — 인스턴스 로컬 메모리 기준(best-effort). Cloud Run이 여러 인스턴스로
// 스케일아웃되면 완벽한 전역 1회성 보장은 안 되지만, 티켓 TTL이 2분으로 매우 짧고
// 이번 라운드는 소수 테스트 계정 한정이라 별도 공유 스토어(Redis 등) 없이 이 정도로 충분하다.
const usedNonces = new Map<string, number>(); // nonce -> expiresAt(ms)

function cleanupUsedNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt < now) usedNonces.delete(nonce);
  }
}

function fail(reason: string, diag: TicketDiag): TicketVerifyResult {
  return { valid: false, reason, diag };
}

export function verifyTicket(rawTicket: string, secret: string): TicketVerifyResult {
  cleanupUsedNonces();

  const diag: TicketDiag = {
    ticketLength: rawTicket?.length ?? 0,
    segmentCount: 0,
    version: null,
    hasVoiceName: false,
    parseStage: "decode",
  };

  let decoded: string;
  try {
    decoded = Buffer.from(rawTicket, "base64url").toString("utf8");
  } catch {
    return fail("malformed_ticket", diag);
  }

  const parts = decoded.split(":");
  diag.segmentCount = parts.length;

  // ── v1: "v1:<base64url(JSON)>:<sig>" ──────────────────────────────
  if (parts[0] === "v1") {
    diag.version = 1;
    diag.parseStage = "version_detect";
    if (parts.length !== 3) return fail("malformed_ticket", diag);
    const [tag, innerB64, sig] = parts;

    diag.parseStage = "signature";
    const signedPayload = `${tag}:${innerB64}`;
    const expectedSig = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return fail("bad_signature", diag);
    }

    diag.parseStage = "json_parse";
    let inner: { childId?: string; voiceName?: string; exp?: number; nonce?: string };
    try {
      inner = JSON.parse(Buffer.from(innerB64, "base64url").toString("utf8"));
    } catch {
      return fail("malformed_ticket", diag);
    }
    diag.hasVoiceName = typeof inner.voiceName === "string" && inner.voiceName.length > 0;

    if (!inner.childId || !Number.isFinite(inner.exp) || !inner.nonce) {
      return fail("malformed_ticket", diag);
    }

    diag.parseStage = "expiry";
    if (Date.now() > (inner.exp as number)) return fail("expired", diag);

    diag.parseStage = "nonce";
    if (usedNonces.has(inner.nonce)) return fail("already_used", diag);
    usedNonces.set(inner.nonce, inner.exp as number);

    diag.parseStage = "ok";
    return { valid: true, childId: inner.childId, voiceName: inner.voiceName, diag };
  }

  // ── legacy: "childId:exp:nonce:sig" (voiceName 없음) ──────────────
  diag.version = 0;
  diag.parseStage = "split";
  if (parts.length !== 4) return fail("malformed_ticket", diag);
  const [childId, expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!childId || !Number.isFinite(exp) || !nonce || !sig) {
    return fail("malformed_ticket", diag);
  }

  diag.parseStage = "expiry";
  if (Date.now() > exp) return fail("expired", diag);

  diag.parseStage = "nonce";
  if (usedNonces.has(nonce)) return fail("already_used", diag);

  diag.parseStage = "signature";
  const payload = `${childId}:${expStr}:${nonce}`;
  const expectedSig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const sigBuf = Buffer.from(sig, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return fail("bad_signature", diag);
  }

  usedNonces.set(nonce, exp);
  diag.parseStage = "ok";
  return { valid: true, childId, diag };
}
