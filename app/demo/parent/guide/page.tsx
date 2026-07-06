"use client";

import { useState } from "react";
import Link from "next/link";
import { DemoFrame } from "../../components/DemoFrame";
import { ParentNav } from "../../components/ParentNav";
import { parentGuideScript } from "../../lib/mockData";

export default function DemoParentGuidePage() {
  const [visiblePairs, setVisiblePairs] = useState(1);
  const isDone = visiblePairs >= parentGuideScript.length;

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-between px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/demo/parent" className="text-lg" style={{ color: "#1e1e2d" }}>
            ←
          </Link>
          <span className="font-bold text-sm" style={{ color: "#1a6b5a" }}>
            내친구 케이
          </span>
          <span className="w-5" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <div className="text-center mb-4">
            <p className="text-xs font-bold" style={{ color: "#1a6b5a" }}>
              내친구 케이
            </p>
            <p className="text-[11px]" style={{ color: "#6b7280" }}>
              AI 대화 가이드
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {parentGuideScript.slice(0, visiblePairs).map((pair, i) => (
              <div key={i}>
                <p className="text-sm font-bold mb-2" style={{ color: "#1e1e2d" }}>
                  {pair.question}
                </p>
                <div
                  className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
                  style={{ background: "#fdf1ec", color: "#3a3a4a" }}
                >
                  {pair.answer}
                </div>
              </div>
            ))}
          </div>

          {!isDone && (
            <button
              onClick={() => setVisiblePairs((v) => v + 1)}
              className="mt-5 w-full py-3 rounded-2xl font-bold text-sm text-white cursor-pointer"
              style={{ background: "#e8845a" }}
            >
              다음 이야기 보기
            </button>
          )}
        </div>

        <ParentNav />
      </div>
    </DemoFrame>
  );
}
