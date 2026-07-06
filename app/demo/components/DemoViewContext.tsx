"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type ViewMode = "tablet" | "mobile";

const DemoViewContext = createContext<{
  view: ViewMode;
  setView: (v: ViewMode) => void;
}>({ view: "tablet", setView: () => {} });

export function DemoViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewMode>("tablet");
  return (
    <DemoViewContext.Provider value={{ view, setView }}>
      {children}
    </DemoViewContext.Provider>
  );
}

export function useDemoView() {
  return useContext(DemoViewContext);
}
