"use client";

import Link from "next/link";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";

const SETTINGS_MENU = [
  { icon: "✏️", title: "이름 바꾸기", desc: "내 이름을 새로 정해요" },
  { icon: "🎂", title: "나이 설정하기", desc: "내 나이를 알려줘요" },
  { icon: "⭐", title: "나의 좋아하는 관심사 바꾸기", desc: "좋아하는 것들을 골라요" },
];

export default function DemoChildSettingsPage() {
  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/child/home" className="font-bold text-sm cursor-pointer" style={{ color: "#1a6b5a" }}>
            설정
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {SETTINGS_MENU.map((item, i) => (
            <div
              key={i}
              onClick={() => alert(`부모님 보호자 앱의 설정에서 수정할 수 있어요! ${item.icon}`)}
              className="bg-white rounded-2xl px-4 py-4 shadow-sm flex items-center gap-3 cursor-pointer active:opacity-85 transition-opacity"
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                style={{ background: "#f3f4f6" }}
              >
                {item.icon}
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>
                  {item.title}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                  {item.desc}
                </p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280" }}>
                →
              </span>
            </div>
          ))}
        </div>

        <RealChildNav active="설정" />
      </div>
    </DemoFrame>
  );
}
