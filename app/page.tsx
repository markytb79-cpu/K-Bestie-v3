"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function HubPage() {
  const router = useRouter();
  const [noChild, setNoChild] = useState(false);

  const enterChildMode = () => {
    if (localStorage.getItem("k_child_id")) {
      router.push("/child/home");
    } else {
      setNoChild(true);
    }
  };

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-8 w-full transition-all"
      style={{ background: "linear-gradient(160deg, #EEF2FF 0%, #F0FDF4 100%)" }}
    >
      <div className="max-w-4xl w-full flex flex-col items-center justify-center">
        {/* 앱 정보 */}
        <div className="text-center mb-10">
          <p className="text-6xl mb-4">🌿</p>
          <h1 className="text-2xl font-bold text-gray-900">내친구 케이</h1>
          <span
            className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold"
            style={{ background: "#EDEDFC", color: "#5B5BD6" }}
          >
            데모 버전
          </span>
          <p className="text-sm mt-2 text-gray-500">어떤 화면으로 시작할까요?</p>
        </div>

        {/* 모드 선택 카드 */}
        <div className="w-full max-w-3xl flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Link
              href="/parent/home"
              className="flex items-center gap-4 bg-white rounded-2xl p-6 active:opacity-80 transition-all hover:shadow-md"
              style={{ boxShadow: "0 1px 8px rgba(91,91,214,0.10), 0 0 0 1px rgba(91,91,214,0.08)" }}
            >
              <span className="text-3xl shrink-0">👨‍👩‍👧</span>
              <div className="flex-1">
                <p className="font-bold text-gray-900">부모 화면</p>
                <p className="text-xs text-gray-400 mt-0.5">리포트 · 알림 · 대화 가이드</p>
              </div>
              <span className="text-gray-300 text-lg">›</span>
            </Link>

            <button
              onClick={enterChildMode}
              className="flex items-center gap-4 bg-white rounded-2xl p-6 w-full text-left active:opacity-80 transition-all hover:shadow-md"
              style={{ boxShadow: "0 1px 8px rgba(26,107,90,0.10), 0 0 0 1px rgba(26,107,90,0.08)" }}
            >
              <span className="text-3xl shrink-0">🧒</span>
              <div className="flex-1">
                <p className="font-bold text-gray-900">아이 화면</p>
                <p className="text-xs text-gray-400 mt-0.5">케이와 대화 · 미션 · 감정 기록</p>
              </div>
              <span className="text-gray-300 text-lg">›</span>
            </button>
          </div>

          {noChild && (
            <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 max-w-md mx-auto w-full">
              <span className="text-amber-500 shrink-0">⚠</span>
              <div>
                <p className="text-xs font-semibold text-amber-800">아직 등록된 아이가 없어요</p>
                <Link
                  href="/parent/home"
                  className="text-xs text-amber-700 underline mt-0.5 block"
                >
                  부모 화면 → 설정에서 아이를 먼저 추가해주세요
                </Link>
              </div>
            </div>
          )}

          <Link
            href="/login"
            className="text-center text-xs py-2 font-medium mt-2"
            style={{ color: "#9CA3AF" }}
          >
            로그인 화면 보기 →
          </Link>
        </div>

        <p className="mt-8 text-xs text-center" style={{ color: "#D1D5DB" }}>
          서준이 기준 더미 데이터로 체험합니다
        </p>
      </div>
    </div>
  );
}
