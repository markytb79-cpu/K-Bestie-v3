"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type ViewMode = "tablet" | "mobile";

const STORAGE_KEY = "kbestie_demo_view_mode";

const DemoViewContext = createContext<{
  view: ViewMode;
  setView: (v: ViewMode) => void;
}>({ view: "tablet", setView: () => {} });

export function DemoViewProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<ViewMode>("tablet");

  // 페이지 이동/새로고침 후에도 선택한 기기 모드가 유지되도록 localStorage에 저장한다.
  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "tablet" || saved === "mobile") {
      setViewState(saved);
    }
  }, []);

  const setView = (v: ViewMode) => {
    setViewState(v);
    window.localStorage.setItem(STORAGE_KEY, v);
  };

  return (
    <DemoViewContext.Provider value={{ view, setView }}>
      {children}
    </DemoViewContext.Provider>
  );
}

export function useDemoView() {
  return useContext(DemoViewContext);
}
