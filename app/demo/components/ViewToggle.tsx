"use client";

import { useDemoView } from "./DemoViewContext";

export function ViewToggle() {
  const { view, setView } = useDemoView();

  return (
    <div className="fixed top-3 right-3 z-50 flex items-center gap-1 rounded-full bg-white/90 backdrop-blur px-1.5 py-1.5 shadow-md border border-[#f3f4f6]">
      <button
        onClick={() => setView("tablet")}
        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
          view === "tablet" ? "bg-[#1a6b5a] text-white" : "text-[#6b7280]"
        }`}
      >
        태블릿
      </button>
      <button
        onClick={() => setView("mobile")}
        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer ${
          view === "mobile" ? "bg-[#1a6b5a] text-white" : "text-[#6b7280]"
        }`}
      >
        스마트폰
      </button>
    </div>
  );
}
