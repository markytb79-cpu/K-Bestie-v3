"use client";

import type { ReactNode } from "react";
import { useDemoView } from "./DemoViewContext";

export function DemoFrame({ children }: { children: ReactNode }) {
  const { view } = useDemoView();

  return (
    <div
      className={`min-h-dvh w-full transition-all ${
        view === "mobile" ? "max-w-[420px]" : "max-w-[720px]"
      } mx-auto px-0`}
      style={{ background: "#fafaf8" }}
    >
      {children}
    </div>
  );
}
