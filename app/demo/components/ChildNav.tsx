"use client";

import Link from "next/link";

const NAV_ITEMS = [
  { icon: "🏠", label: "홈" },
  { icon: "🎯", label: "미션" },
  { icon: "💬", label: "대화" },
  { icon: "🎮", label: "놀이" },
  { icon: "⚙️", label: "설정" },
];

export function ChildNav({ active }: { active: string }) {
  return (
    <div
      className="shrink-0 flex items-stretch border-t"
      style={{ background: "#ffffff", borderColor: "#f3f4f6" }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.label === active;
        return (
          <Link
            key={item.label}
            href="/demo"
            className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 select-none"
          >
            <span className="text-lg" style={{ opacity: isActive ? 1 : 0.55 }}>
              {item.icon}
            </span>
            <span
              className="text-[10px] font-bold"
              style={{ color: isActive ? "#1a6b5a" : "#6b7280" }}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
