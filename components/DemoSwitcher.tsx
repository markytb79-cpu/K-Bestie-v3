"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEMO_CHILD } from "@/lib/demo-data";
import { clearStore, registerChild } from "@/lib/store";

type Mode = "parent" | "child";

const PARENT_LINKS = [
  { label: "홈", href: "/parent/home" },
  { label: "리포트", href: "/parent/report" },
  { label: "가이드", href: "/parent/guide" },
  { label: "전문가", href: "/parent/expert" },
  { label: "알림", href: "/parent/notifications" },
  { label: "설정", href: "/parent/settings" },
];

const CHILD_LINKS = [
  { label: "홈", href: "/child/home" },
  { label: "미션", href: "/child/missions" },
  { label: "대화", href: "/child/chat" },
];

export default function DemoSwitcher({ mode }: { mode: Mode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const accentColor = mode === "parent" ? "#5B5BD6" : "#1A6B5A";
  const otherColor = mode === "parent" ? "#1A6B5A" : "#5B5BD6";
  const modeIcon = mode === "parent" ? "👨‍👩‍👧" : "🧒";
  const modeLabel = mode === "parent" ? "부모 모드" : "아이 모드";
  const links = mode === "parent" ? PARENT_LINKS : CHILD_LINKS;

  const switchToOther = () => {
    if (mode === "parent") {
      if (!localStorage.getItem("k_child_id")) {
        localStorage.setItem("k_child_id", DEMO_CHILD.id);
      }
      registerChild({ id: DEMO_CHILD.id, name: DEMO_CHILD.name, grade: DEMO_CHILD.grade, interests: [] });
      router.push("/child/home");
    } else {
      router.push("/parent/home");
    }
    setOpen(false);
  };

  const handleReset = () => {
    clearStore(); // k_child_id + k_session_id + k_store_v1 전체 초기화
    router.push("/");
    setOpen(false);
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-[90]"
          onClick={() => setOpen(false)}
        />
      )}

      <div className="fixed bottom-[84px] right-4 z-[100] flex flex-col items-end gap-2">
        {open && (
          <div
            className="bg-white rounded-2xl p-3 w-52 flex flex-col gap-2 mb-1"
            style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06)" }}
          >
            {/* 현재 모드 */}
            <div className="flex items-center gap-2 px-1">
              <span className="text-base">{modeIcon}</span>
              <span className="text-xs font-bold" style={{ color: accentColor }}>
                {modeLabel}
              </span>
              <span
                className="ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: `${accentColor}18`, color: accentColor }}
              >
                DEMO
              </span>
            </div>

            {/* 빠른 이동 */}
            <div className="border-t border-gray-100 pt-2">
              <p className="text-[10px] font-medium px-1 mb-2" style={{ color: "#9CA3AF" }}>
                빠른 이동
              </p>
              <div className="flex flex-wrap gap-1.5 px-0.5">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="text-xs px-2.5 py-1 rounded-lg font-medium"
                    style={{ background: `${accentColor}14`, color: accentColor }}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            {/* 모드 전환 & 리셋 */}
            <div className="border-t border-gray-100 pt-2 flex flex-col gap-1.5">
              <button
                onClick={switchToOther}
                className="text-xs py-2 px-3 rounded-xl font-semibold text-white w-full text-left"
                style={{ background: otherColor }}
              >
                {mode === "parent" ? "🧒 아이 화면으로 전환" : "👨‍👩‍👧 부모 화면으로 전환"}
              </button>
              <button
                onClick={handleReset}
                className="text-xs py-1.5 px-3 rounded-xl font-medium text-gray-500 border border-gray-200 w-full text-left"
              >
                🏠 처음으로 (초기화)
              </button>
            </div>
          </div>
        )}

        {/* FAB */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-12 h-12 rounded-full flex items-center justify-center text-white text-xl shadow-lg active:scale-95 transition-transform"
          style={{ background: open ? "#6B7280" : accentColor }}
          aria-label="데모 메뉴"
        >
          {open ? "✕" : modeIcon}
        </button>
      </div>
    </>
  );
}
