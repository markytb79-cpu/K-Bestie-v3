import type { ReactNode } from "react";
import { DemoViewProvider } from "./components/DemoViewContext";
import { ViewToggle } from "./components/ViewToggle";

export const metadata = {
  title: "내친구 케이 — 체험 데모",
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: "'Pretendard Variable', Pretendard, -apple-system, sans-serif" }}>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
      />
      <DemoViewProvider>
        <ViewToggle />
        {children}
      </DemoViewProvider>
    </div>
  );
}
