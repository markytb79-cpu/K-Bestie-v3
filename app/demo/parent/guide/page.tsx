"use client";

import { useState } from "react";
import Link from "next/link";
import { DemoFrame } from "../../components/DemoFrame";
import { ParentNav } from "../../components/ParentNav";
import { parentGuideTurns } from "../../lib/mockData";

const INITIAL_VISIBLE = 2;

export default function DemoParentGuidePage() {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  const isDone = visibleCount >= parentGuideTurns.length;
  const visibleTurns = parentGuideTurns.slice(0, visibleCount);

  const handleNext = () => {
    if (isDone) return;
    setVisibleCount((c) => Math.min(c + 1, parentGuideTurns.length));
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-2">
          <Link href="/demo/parent" className="text-lg" style={{ color: "#1e1e2d" }}>
            ←
          </Link>
          <Link href="/demo" className="font-bold text-sm cursor-pointer" style={{ color: "#1a6b5a" }}>
            케이와 대화
          </Link>
          <span className="w-5" />
        </div>

        <p className="shrink-0 text-center text-xs pb-3" style={{ color: "#6b7280" }}>
          AI 대화 가이드 — 상황별 추천 질문과 대화법
        </p>

        {/* 대화 말풍선: 이 영역만 스크롤 */}
        <div className="flex-1 min-h-0 px-4 flex flex-col gap-3 overflow-y-auto pb-4">
          {visibleTurns.map((turn, i) => (
            <div
              key={i}
              className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                turn.speaker === "kay" ? "self-start" : "self-end"
              }`}
              style={{
                background: turn.speaker === "kay" ? "#f3f4f6" : "#3b82f6",
                color: turn.speaker === "kay" ? "#1e1e2d" : "#ffffff",
              }}
            >
              {turn.text}
            </div>
          ))}
        </div>

        <div className="shrink-0 px-4 pb-4">
          <button
            onClick={handleNext}
            disabled={isDone}
            className="w-full py-3.5 rounded-2xl font-bold text-sm text-white shadow-sm transition-transform active:scale-[0.98] disabled:opacity-40 cursor-pointer"
            style={{ background: "#e8845a" }}
          >
            {isDone ? "대화가 모두 끝났어요" : "다음 이야기 이어보기"}
          </button>
        </div>

        <ParentNav />
      </div>
    </DemoFrame>
  );
}
