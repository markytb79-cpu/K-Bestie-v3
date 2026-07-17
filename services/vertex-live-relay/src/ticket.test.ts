// ticket.ts(verifyTicket)의 하위호환 검증 테스트 — node:test 내장 러너로 실행(npm test).
// 이 파일은 lib/plan/vertexLiveTicket.ts(Next.js 앱, 별도 배포 단위)를 import할 수 없으므로,
// 그 파일과 동일한 알고리즘을 여기 mint 헬퍼로 그대로 재현해 사용한다 — 포맷을 바꿀 때는
// 반드시 세 곳(lib/plan/vertexLiveTicket.ts, 이 파일, ticket.ts 자체)을 함께 맞출 것.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyTicket } from "./ticket.js";

const SECRET = "test-secret-do-not-use-in-real-env";
const CHILD_ID = "5e6d6ffa-8c44-4276-934c-71e79007faba";

function mintLegacy(childId: string, secret: string, ttlMs = 2 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(16).toString("hex");
  const payload = `${childId}:${exp}:${nonce}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

function mintV1(childId: string, voiceName: string, secret: string, ttlMs = 2 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const nonce = crypto.randomBytes(16).toString("hex");
  const inner = { childId, voiceName, exp, nonce };
  const innerB64 = Buffer.from(JSON.stringify(inner)).toString("base64url");
  const signedPayload = `v1:${innerB64}`;
  const sig = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return Buffer.from(`${signedPayload}:${sig}`).toString("base64url");
}

// ── URL 인코딩/디코딩 왕복 테스트 ─────────────────────────────────
// 브라우저는 실제로 `?ticket=${encodeURIComponent(ticket)}`로 보내고, 서버는
// URLSearchParams.get()으로 복원한다 — 이 왕복 후에도 서명이 그대로 유효해야 한다.
test("URL encode/decode round-trip preserves a valid v1 ticket", () => {
  const ticket = mintV1(CHILD_ID, "Achernar", SECRET);
  const url = new URL(`https://relay.example/live?ticket=${encodeURIComponent(ticket)}`);
  const roundTripped = url.searchParams.get("ticket") ?? "";
  assert.equal(roundTripped, ticket);

  const result = verifyTicket(roundTripped, SECRET);
  assert.equal(result.valid, true);
  assert.equal(result.childId, CHILD_ID);
  assert.equal(result.voiceName, "Achernar");
  assert.equal(result.diag.version, 1);
  assert.equal(result.diag.hasVoiceName, true);
  assert.equal(result.diag.parseStage, "ok");
});

test("URL encode/decode round-trip preserves a valid legacy ticket", () => {
  const ticket = mintLegacy(CHILD_ID, SECRET);
  const url = new URL(`https://relay.example/live?ticket=${encodeURIComponent(ticket)}`);
  const roundTripped = url.searchParams.get("ticket") ?? "";
  assert.equal(roundTripped, ticket);

  const result = verifyTicket(roundTripped, SECRET);
  assert.equal(result.valid, true);
  assert.equal(result.childId, CHILD_ID);
  assert.equal(result.voiceName, undefined);
  assert.equal(result.diag.version, 0);
  assert.equal(result.diag.hasVoiceName, false);
});

// ── 기존(legacy) 티켓 허용 ────────────────────────────────────────
test("legacy (pre-v1) ticket is still accepted", () => {
  const ticket = mintLegacy(CHILD_ID, SECRET);
  const result = verifyTicket(ticket, SECRET);
  assert.equal(result.valid, true);
  assert.equal(result.childId, CHILD_ID);
  assert.equal(result.voiceName, undefined);
});

// ── Achernar / Kore v1 티켓 허용 ──────────────────────────────────
test("v1 ticket with Achernar voiceName is accepted", () => {
  const ticket = mintV1(CHILD_ID, "Achernar", SECRET);
  const result = verifyTicket(ticket, SECRET);
  assert.equal(result.valid, true);
  assert.equal(result.voiceName, "Achernar");
});

test("v1 ticket with Kore voiceName is accepted", () => {
  const ticket = mintV1(CHILD_ID, "Kore", SECRET);
  const result = verifyTicket(ticket, SECRET);
  assert.equal(result.valid, true);
  assert.equal(result.voiceName, "Kore");
});

// ── 변조 티켓 거부 ────────────────────────────────────────────────
test("tampered v1 ticket (flipped char in signed payload) is rejected", () => {
  const ticket = mintV1(CHILD_ID, "Achernar", SECRET);
  const decoded = Buffer.from(ticket, "base64url").toString("utf8");
  const [tag, innerB64, sig] = decoded.split(":");
  const tamperedInnerB64 = innerB64.slice(0, -1) + (innerB64.at(-1) === "A" ? "B" : "A");
  const tampered = Buffer.from(`${tag}:${tamperedInnerB64}:${sig}`).toString("base64url");

  const result = verifyTicket(tampered, SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_signature");
});

test("tampered legacy ticket (flipped char) is rejected", () => {
  const ticket = mintLegacy(CHILD_ID, SECRET);
  const decoded = Buffer.from(ticket, "base64url").toString("utf8");
  const [childId, exp, nonce, sig] = decoded.split(":");
  const tamperedChildId = childId.slice(0, -1) + (childId.at(-1) === "a" ? "b" : "a");
  const tampered = Buffer.from(`${tamperedChildId}:${exp}:${nonce}:${sig}`).toString("base64url");

  const result = verifyTicket(tampered, SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_signature");
});

test("ticket signed with a different secret is rejected", () => {
  const ticket = mintV1(CHILD_ID, "Achernar", "a-completely-different-secret");
  const result = verifyTicket(ticket, SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "bad_signature");
});

test("expired v1 ticket is rejected", () => {
  const ticket = mintV1(CHILD_ID, "Achernar", SECRET, -1000);
  const result = verifyTicket(ticket, SECRET);
  assert.equal(result.valid, false);
  assert.equal(result.reason, "expired");
});

test("v1 ticket nonce cannot be reused", () => {
  const ticket = mintV1(CHILD_ID, "Achernar", SECRET);
  const first = verifyTicket(ticket, SECRET);
  assert.equal(first.valid, true);
  const second = verifyTicket(ticket, SECRET);
  assert.equal(second.valid, false);
  assert.equal(second.reason, "already_used");
});

test("garbage ticket reports malformed_ticket with diagnostics only (no raw content)", () => {
  const result = verifyTicket("not-a-valid-base64url-ticket!!!", SECRET);
  assert.equal(result.valid, false);
  assert.ok(result.reason === "malformed_ticket");
  assert.equal(typeof result.diag.ticketLength, "number");
  assert.equal(typeof result.diag.segmentCount, "number");
});
