"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDemoView } from "./DemoViewContext";
import { ViewToggle } from "./ViewToggle";

// 태블릿 = 가로(landscape), 스마트폰 = 세로(portrait). width/height 비율.
const FRAME = {
  tablet: { ratio: 4 / 3, bezel: 18, radius: 30 },
  mobile: { ratio: 9 / 19.5, bezel: 14, radius: 46 },
};

// PC 웹(마우스 포인터 + 넓은 화면)에서만 기기 프레임을 보여준다.
// 실제 태블릿/스마트폰 접속(터치 포인터)에서는 프레임 없이 꽉 차게 렌더링한다.
function usePcDetection() {
  const [isPc, setIsPc] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine) and (min-width: 900px)");
    const update = () => setIsPc(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isPc;
}

// 실기기에서는 전환 버튼 없이 실제 화면 너비에 맞는 view를 자동으로 반영한다.
function useAutoViewOnDevice(isPc: boolean, setView: (v: "tablet" | "mobile") => void) {
  useEffect(() => {
    if (isPc) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setView(mq.matches ? "tablet" : "mobile");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [isPc, setView]);
}

export function DemoFrame({ children }: { children: ReactNode }) {
  const { view, setView } = useDemoView();
  const isPc = usePcDetection();
  useAutoViewOnDevice(isPc, setView);

  if (!isPc) {
    return (
      <div className="h-dvh w-full overflow-y-auto" style={{ background: "#fafaf8" }}>
        {children}
      </div>
    );
  }

  const { ratio, bezel, radius } = FRAME[view];
  const innerRadius = Math.max(radius - bezel, 8);

  return (
    <div
      className="h-dvh w-full flex items-center justify-center gap-8 px-6 overflow-hidden"
      style={{ background: "#f3f4f6" }}
    >
      <ViewToggle orientation="vertical" />

      <div
        className="relative shrink-0"
        style={{
          height: "min(82vh, 800px)",
          aspectRatio: ratio,
          background: "#1e1e2d",
          borderRadius: radius,
          padding: bezel,
          boxShadow: "0 30px 70px rgba(0,0,0,0.28)",
        }}
      >
        {view === "mobile" ? (
          <div
            className="absolute left-1/2 -translate-x-1/2 z-10 rounded-full"
            style={{ top: 10, width: 100, height: 22, background: "#1e1e2d" }}
          />
        ) : (
          <div
            className="absolute top-1/2 -translate-y-1/2 z-10 rounded-full"
            style={{ left: 6, width: 8, height: 8, background: "#3a3a4a" }}
          />
        )}

        <div
          className="w-full h-full overflow-y-auto"
          style={{ background: "#fafaf8", borderRadius: innerRadius }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
