"use client";

import { useState, useEffect, useCallback } from "react";
import { getStore, STORE_EVENT, type StoreData } from "@/lib/store";

export function useStore(): StoreData {
  const [data, setData] = useState<StoreData>({
    activeFamilyId: null,
    familyName: null,
    activeChildId: null,
    children: [],
    questions: [],
    missions: [],
    moodScore: null,
    notifSettings: { reportAlert: true, emotionAlert: true, weeklySummary: false },
    notifications: [],
  });

  const refresh = useCallback(() => setData(getStore()), []);

  useEffect(() => {
    refresh(); // SSR → 클라이언트 hydration 후 localStorage 동기화
    window.addEventListener(STORE_EVENT, refresh);
    return () => window.removeEventListener(STORE_EVENT, refresh);
  }, [refresh]);

  return data;
}
