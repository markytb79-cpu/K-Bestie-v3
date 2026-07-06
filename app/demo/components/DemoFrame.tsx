"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useDemoView } from "./DemoViewContext";
import { ViewToggle } from "./ViewToggle";

const FRAME = {
  tablet: { outerW: 760, outerH: 980, bezel: 20, radius: 34 },
  mobile: { outerW: 448, outerH: 900, bezel: 14, radius: 46 },
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

export function DemoFrame({ children }: { children: ReactNode }) {
  const { view } = useDemoView();
  const isPc = usePcDetection();

  if (!isPc) {
    return (
      <div className="min-h-dvh w-full" style={{ background: "#fafaf8" }}>
        <div className="fixed top-3 right-3 z-50">
          <ViewToggle />
        </div>
        {children}
      </div>
    );
  }

  const size = FRAME[view];
  const innerRadius = Math.max(size.radius - size.bezel, 8);

  return (
    <div
      className="min-h-dvh w-full flex items-center justify-center gap-8 py-10 px-6"
      style={{ background: "#f3f4f6" }}
    >
      <ViewToggle orientation="vertical" />

      <div
        className="relative shrink-0"
        style={{
          width: size.outerW,
          height: size.outerH,
          background: "#1e1e2d",
          borderRadius: size.radius,
          padding: size.bezel,
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
            className="absolute left-1/2 -translate-x-1/2 z-10 rounded-full"
            style={{ top: 7, width: 8, height: 8, background: "#3a3a4a" }}
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
