"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackArrow } from "@/components/ParentIcons";
import { registerChild } from "@/lib/store";

const GRADES = ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"];
const INTERESTS = ["공룡", "우주", "동물", "그림", "음악", "스포츠", "요리", "게임", "과학", "책"];

export default function OnboardingPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 법정대리인 동의 및 초대 코드 발급 상태
  const [consent, setConsent] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [codeExpiresAt, setCodeExpiresAt] = useState<string | null>(null);
  const [showCodeModal, setShowCodeModal] = useState(false);

  function toggleInterest(item: string) {
    setInterests((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("이름을 입력해주세요."); return; }
    if (!grade) { setError("학년을 선택해주세요."); return; }
    if (interests.length === 0) { setError("관심사를 하나 이상 선택해주세요."); return; }
    if (!consent) { setError("법정대리인 동의가 필요합니다."); return; }

    setLoading(true);
    setError(null);
    try {
      // 1. 활성 가족 ID 가져오기
      const { getStore, syncChildrenFromDB } = await import("@/lib/store");
      let familyId = getStore().activeFamilyId;
      if (!familyId) {
        // 백업으로 가족 목록 다시 확인
        const famsRes = await fetch("/api/families");
        if (famsRes.ok) {
          const famData = await famsRes.json();
          if (famData.families?.length > 0) {
            familyId = famData.families[0].family_id;
          }
        }
      }
      if (!familyId) {
        throw new Error("가족 그룹이 존재하지 않습니다. 먼저 가족을 만들어주세요.");
      }

      // 2. 가족 아래 아이 프로필 등록
      const childRes = await fetch(`/api/families/${familyId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), grade, interests, guardian_consent: consent }),
      });
      const childData = await childRes.json();
      if (!childRes.ok) throw new Error(childData.error ?? "아이 등록 실패");

      const childId = childData.child.id;

      // 3. 아이 초대 코드 발급
      const codeRes = await fetch(`/api/children/${childId}/invite-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guardian_consent: true }),
      });
      const codeData = await codeRes.json();
      if (!codeRes.ok) throw new Error(codeData.error ?? "초대 코드 발급 실패");

      // 동기화
      await syncChildrenFromDB();

      // 발급 완료 상태 설정
      setInviteCode(codeData.code);
      setCodeExpiresAt(codeData.expires_at);
      setShowCodeModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "아이 추가에 실패했어요. 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-dvh md:max-w-[420px] md:mx-auto"
      style={{ background: "var(--hb-bg)" }}
    >
      {/* 헤더 */}
      <div className="bg-white px-5 pt-12 pb-4 flex items-center gap-3">
        <Link href="/parent/home" style={{ color: "var(--hb-primary)" }}>
          <BackArrow />
        </Link>
        <h1 className="text-[17px] font-bold text-gray-900">아이 추가</h1>
      </div>

      {/* 저장 안내 배너 */}
      <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl bg-green-50 border border-green-200">
        <p className="text-xs text-green-700 font-medium">
          아이 정보가 케이 서버에 안전하게 저장됩니다
        </p>
      </div>

      <div className="px-5 pt-5 pb-10">
        <div className="mb-6">
          <h2 className="text-lg font-bold text-gray-900">아이를 추가해요</h2>
          <p className="text-sm mt-1" style={{ color: "var(--hb-muted)" }}>
            아이 정보를 알려주시면 케이가 더 잘 대화할 수 있어요
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* 이름 */}
          <div>
            <label className="block text-sm font-bold mb-2 text-gray-800">
              이름
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예) 서준"
              maxLength={10}
              className="w-full px-4 py-3 rounded-2xl bg-white text-base outline-none border-2 border-transparent transition-colors"
              style={{ boxShadow: "var(--hb-shadow)" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
              onBlur={(e) => (e.target.style.borderColor = "transparent")}
            />
          </div>

          {/* 학년 */}
          <div>
            <label className="block text-sm font-bold mb-2 text-gray-800">
              학년
            </label>
            <div className="flex gap-2 flex-wrap">
              {GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGrade(g)}
                  className="px-4 py-2 rounded-full text-sm font-medium transition-colors"
                  style={
                    grade === g
                      ? { background: "var(--hb-primary)", color: "#fff" }
                      : { background: "white", color: "#374151", boxShadow: "var(--hb-shadow)" }
                  }
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          {/* 관심사 */}
          <div>
            <label className="block text-sm font-bold mb-2 text-gray-800">
              관심사{" "}
              <span className="font-normal text-xs" style={{ color: "var(--hb-muted)" }}>
                (여러 개 선택 가능)
              </span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {INTERESTS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleInterest(item)}
                  className="px-4 py-2 rounded-full text-sm font-medium transition-colors"
                  style={
                    interests.includes(item)
                      ? { background: "var(--hb-primary)", color: "#fff" }
                      : { background: "white", color: "#374151", boxShadow: "var(--hb-shadow)" }
                  }
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {/* 법정대리인 동의 */}
          <div className="flex items-start gap-3 bg-white p-4 rounded-2xl" style={{ boxShadow: "var(--hb-shadow)" }}>
            <input
              type="checkbox"
              id="consent"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="w-5 h-5 accent-[var(--hb-primary)] rounded cursor-pointer mt-0.5"
            />
            <label htmlFor="consent" className="text-xs text-gray-600 leading-relaxed cursor-pointer select-none">
              <span className="font-bold text-gray-800">[필수] 법정대리인 동의</span>
              <br />본인은 가입 대상 자녀의 법정대리인으로서 자녀의 개인정보 및 오디오 서비스 사용을 위해 제공하는 것에 동의합니다.
            </label>
          </div>

          {error && (
            <p className="text-sm text-red-500 bg-red-50 px-4 py-2.5 rounded-xl">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-2xl font-bold text-white transition-opacity disabled:opacity-50 active:opacity-80"
            style={{ background: "var(--hb-primary)" }}
          >
            {loading ? "추가하는 중..." : "아이 추가 완료 →"}
          </button>
        </form>
      </div>

      {/* 초대 코드 완료 모달 */}
      {showCodeModal && (
        <>
          <div className="fixed inset-0 z-[110] bg-black/40" />
          <div
            className="fixed bottom-0 left-0 right-0 z-[120] bg-white rounded-t-3xl px-5 pt-6 pb-10 md:max-w-[420px] md:mx-auto md:left-1/2 md:-translate-x-1/2 text-center"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.12)" }}
          >
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />
            <p className="text-5xl mb-2">🎉</p>
            <h2 className="text-lg font-bold text-gray-900 mb-1">아이 등록이 완료되었습니다!</h2>
            <p className="text-xs text-gray-500 mb-6">
              아래 초대 코드를 자녀의 기기 로그인 화면에 입력하여<br />가족 그룹에 합류시키세요.
            </p>

            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl py-4 px-6 mb-2">
              <p className="text-3xl font-bold tracking-widest text-[var(--hb-primary)] font-mono">
                {inviteCode}
              </p>
            </div>
            
            {codeExpiresAt && (
              <p className="text-[10px] text-gray-400 mb-6">
                만료 일시: {new Date(codeExpiresAt).toLocaleString()} (24시간 동안 유효)
              </p>
            )}

            <button
              onClick={() => {
                setShowCodeModal(false);
                router.replace("/parent/home");
              }}
              className="w-full py-3.5 rounded-2xl font-bold text-white text-sm"
              style={{ background: "var(--hb-primary)" }}
            >
              확인 (부모 대시보드로 이동)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
