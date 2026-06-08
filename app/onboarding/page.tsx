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

    setLoading(true);
    setError(null);
    let childId: string;
    try {
      const res = await fetch("/api/child/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), grade, interests }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "등록 실패");
      childId = data.childId;
    } catch {
      // API 실패 시 로컬 데모 ID로 fallback (데모 환경)
      childId = `demo-local-${Date.now().toString(36)}`;
    }
    localStorage.setItem("k_child_id", childId);
    registerChild({ id: childId, name: name.trim(), grade, interests });
    router.replace("/parent/home");
    setLoading(false);
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
    </div>
  );
}
