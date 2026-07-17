// Vertex Live 릴레이(Cloud Run, services/vertex-live-relay) 접속용 1회성 단기 티켓 발급 — 서버 전용.
// 릴레이는 별도 배포 단위라 이 파일을 import할 수 없다 — services/vertex-live-relay/src/ticket.ts에
// 동일한 서명 포맷의 검증 로직을 별도 보유한다. 이 파일과 그 파일 중 하나만 바꾸면 반드시
// 반대쪽도 맞춰서 바꿀 것.
//
// v1 포맷: innerB64 = base64url(JSON.stringify({childId, voiceName, exp, nonce})),
// signedPayload = `v1:${innerB64}`, ticket = base64url(`${signedPayload}:${sig}`).
// (2026-07-16 사고 교훈: 콜론 세그먼트를 계속 늘리는 방식 대신 버전 태그+JSON 구조로 —
// 향후 필드가 늘어나도 릴레이의 파싱 로직이 세그먼트 개수에 의존하지 않게 한다.)
// 릴레이는 이 v1과 함께 예전 legacy 포맷(childId:exp:nonce:sig, voiceName 없음)도 계속 받아준다
// — 배포 타이밍이 어긋나 한쪽이 구버전이어도 서비스가 끊기지 않도록 하는 하위호환 안전장치.

import crypto from "crypto";
import { ALL_LIVE_VOICES, DEFAULT_LIVE_VOICE_NAME } from "@/lib/plan/liveVoices";

const TICKET_TTL_MS = 2 * 60 * 1000; // 발급 직후 WS 연결에만 쓰이므로 2분이면 충분
const ALL_LIVE_VOICE_NAMES = new Set(ALL_LIVE_VOICES.map((v) => v.name));

export function mintVertexLiveTicket(childId: string, voiceName?: string): string {
  const secret = process.env.VERTEX_LIVE_RELAY_SECRET;
  if (!secret) throw new Error("VERTEX_LIVE_RELAY_SECRET not configured");

  // Google 공식 30개 목록 기준으로 검증 — DB에 잘못된/오래된 값이 남아있어도 서명 티켓에는
  // 항상 유효한 이름만 담는다(릴레이도 동일 목록으로 재검증, 이중 방어).
  const safeVoiceName = voiceName && ALL_LIVE_VOICE_NAMES.has(voiceName) ? voiceName : DEFAULT_LIVE_VOICE_NAME;

  const exp = Date.now() + TICKET_TTL_MS;
  const nonce = crypto.randomBytes(16).toString("hex");
  const inner = { childId, voiceName: safeVoiceName, exp, nonce };
  const innerB64 = Buffer.from(JSON.stringify(inner)).toString("base64url");
  const signedPayload = `v1:${innerB64}`;
  const sig = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return Buffer.from(`${signedPayload}:${sig}`).toString("base64url");
}
