// containsForeignScript 단위 테스트 — node:test 내장 러너(npm test).
// 정책: 한글·숫자·공백·기본 문장부호만 허용. 라틴 알파벳 한 글자라도 섞이면(영어 혼입/영어
// 전체 문장 모두) 오염으로 판정하고, 일본어/중국어/아랍어/키릴 문자도 동일하게 오염으로 본다.

import { test } from "node:test";
import assert from "node:assert/strict";
import { containsForeignScript, validateFinalTranscript, resolveFinalTranscript } from "./scriptGuard.js";

test("정상 한글 문장은 오염 아님", () => {
  assert.equal(containsForeignScript("오늘 학교에서 축구를 했어요"), false);
});

test("한글 + 숫자 + 기본 문장부호는 오염 아님", () => {
  assert.equal(containsForeignScript("저는 10살이고, 친구가 3명 있어요!"), false);
});

test("한글 문장에 영문이 한 글자만 섞여도 오염으로 판정", () => {
  assert.equal(containsForeignScript("나는 K팝을 좋아해"), true); // K
  assert.equal(containsForeignScript("유튜브 봤어요 OK"), true);
});

test("영어 전체 문장은 오염으로 판정", () => {
  assert.equal(containsForeignScript("I want to go to the park today"), true);
});

test("숫자만 있는 답변은 오염 아님", () => {
  assert.equal(containsForeignScript("8"), false);
});

test("일본어 가나 혼입은 오염으로 판정", () => {
  assert.equal(containsForeignScript("こんにちは 안녕"), true);
});

test("중국어 한자 혼입은 오염으로 판정", () => {
  assert.equal(containsForeignScript("你好 안녕"), true);
});

test("아랍 문자 혼입은 오염으로 판정", () => {
  assert.equal(containsForeignScript("مرحبا 안녕"), true);
});

test("키릴 문자 혼입은 오염으로 판정", () => {
  assert.equal(containsForeignScript("Привет 안녕"), true);
});

test("빈 문자열/공백만 있는 경우는 오염 아님", () => {
  assert.equal(containsForeignScript(""), false);
  assert.equal(containsForeignScript("   "), false);
});

// ── validateFinalTranscript: 출처 불문 단일 검증 경로 ─────────────────────

test("validateFinalTranscript: 정상 한글 문장은 통과", () => {
  assert.equal(validateFinalTranscript(" 오늘 축구했어요 "), "오늘 축구했어요");
});

test("validateFinalTranscript: 외국 문자 혼입은 거부", () => {
  assert.equal(validateFinalTranscript("나는 K팝을 좋아해"), null);
  assert.equal(validateFinalTranscript("こんにちは"), null);
});

test("validateFinalTranscript: 숫자만 있는 응답은 거부(유효한 대화 답변 아님)", () => {
  assert.equal(validateFinalTranscript("8"), null);
  assert.equal(validateFinalTranscript("123"), null);
});

test("validateFinalTranscript: 빈 문자열/공백만 있는 응답은 거부", () => {
  assert.equal(validateFinalTranscript(""), null);
  assert.equal(validateFinalTranscript("   "), null);
  assert.equal(validateFinalTranscript("..."), null); // 문장부호뿐, 한글 없음
});

// ── resolveFinalTranscript: GCP/Live 폴백을 아우르는 단일 경로 ────────────────

function callCounter(results: (string | null)[]) {
  let i = 0;
  return async () => (i < results.length ? results[i++] : null);
}

test("resolveFinalTranscript: GCP 정상 한국어 — 1회만 호출하고 그대로 사용", async () => {
  let calls = 0;
  const fetchGcp = async () => { calls++; return "안녕하세요"; };
  const result = await resolveFinalTranscript(fetchGcp, "fallback");
  assert.equal(result, "안녕하세요");
  assert.equal(calls, 1); // 첫 시도부터 깨끗하면 재시도 없음
});

test("resolveFinalTranscript: GCP 1차 외국문자 → 2차 정상이면 2차 값 사용", async () => {
  const fetchGcp = callCounter(["hello world", "안녕하세요"]);
  const result = await resolveFinalTranscript(fetchGcp, "fallback");
  assert.equal(result, "안녕하세요");
});

test("resolveFinalTranscript: GCP가 응답은 했지만 2회 모두 외국문자면 Live로 대체하지 않고 거부", async () => {
  const fetchGcp = callCounter(["hello", "world"]);
  const result = await resolveFinalTranscript(fetchGcp, "안녕하세요"); // Live엔 멀쩡한 한국어가 있어도
  assert.equal(result, null); // GCP가 실제로 응답했으므로 Live로 대체하지 않음
});

test("resolveFinalTranscript: GCP 호출이 2회 다 실패 + Live 전사가 정상 한국어면 Live 사용", async () => {
  const fetchGcp = callCounter([null, null]);
  const result = await resolveFinalTranscript(fetchGcp, "안녕하세요");
  assert.equal(result, "안녕하세요");
});

test("resolveFinalTranscript: GCP 호출이 2회 다 실패 + Live 전사가 외국문자면 거부", async () => {
  const fetchGcp = callCounter([null, null]);
  const result = await resolveFinalTranscript(fetchGcp, "hello");
  assert.equal(result, null);
});

test("resolveFinalTranscript: 양쪽 다 빈 응답이면 거부", async () => {
  const fetchGcp = callCounter(["", ""]);
  const result = await resolveFinalTranscript(fetchGcp, "");
  assert.equal(result, null);
});

test("resolveFinalTranscript: GCP가 숫자만 두 번 반환하면 거부(Live로 대체 안 함)", async () => {
  const fetchGcp = callCounter(["8", "10"]);
  const result = await resolveFinalTranscript(fetchGcp, "안녕하세요");
  assert.equal(result, null);
});
