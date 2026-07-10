"use client";

import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";

const GAMES = [
  { icon: "📚", title: "만화책 읽기", bg: "#e8845a" },
  { icon: "🧠", title: "퀴즈 게임", bg: "#3b82f6" },
  { icon: "💇", title: "헤어스타일", bg: "#2d9f8f" },
  { icon: "🔮", title: "MBTI 성격 유형", bg: "#22c55e" },
];

export default function DemoChildPlayPage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#fafaf8" }}>
        <div className="shrink-0 flex items-center justify-center px-4 pt-4 pb-2">
          <Link href="/child/home" className="font-bold text-sm cursor-pointer" style={{ color: "#1a6b5a" }}>
            케이와 놀이
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <p className="text-sm text-center mb-5" style={{ color: "#6b7280" }}>
            하고 싶은 놀이를 골라보세요
          </p>

          <div className="grid grid-cols-2 gap-4">
            {GAMES.map((game) => (
              <div
                key={game.title}
                onClick={() => alert(`준비 중인 서비스입니다. 조금만 기다려주세요! ${game.icon}`)}
                className="flex flex-col items-center justify-center gap-3 rounded-3xl px-4 py-8 shadow-md cursor-pointer select-none active:scale-95 transition-transform"
                style={{ background: game.bg }}
              >
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-4xl"
                  style={{ background: "rgba(255,255,255,0.25)" }}
                >
                  {game.icon}
                </div>
                <p className="text-white font-bold text-sm text-center">{game.title}</p>
              </div>
            ))}
          </div>
        </div>

        <RealChildNav active="놀이" />
      </div>
    </DemoFrame>
  );
}
