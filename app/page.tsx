"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface FamilyItem {
  family_id: string;
  role: string;
  families: { id: string; name: string };
}

export default function HubPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [families, setFamilies] = useState<FamilyItem[]>([]);

  useEffect(() => {
    const supabase = createClient();
    
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        router.replace("/login");
        return;
      }
      setHasSession(true);

      // 가족 목록 조회
      try {
        const res = await fetch("/api/families");
        if (res.ok) {
          const data = await res.json();
          const list = (data.families ?? []) as FamilyItem[];
          setFamilies(list);

          if (list.length > 0) {
            // 이미 가족이 있는 경우 role에 따라 자동 이동
            const myRole = list[0].role;
            if (myRole === "child") {
              router.replace("/child/home");
            } else {
              router.replace("/parent/home");
            }
            return;
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--hb-primary) var(--hb-primary) transparent transparent" }} />
        <p className="text-xs text-gray-500 mt-3">사용자 정보를 확인하는 중...</p>
      </div>
    );
  }

  // 로그인되었으나 가족이 전혀 없는 경우 역할 선택 유도
  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-8 w-full transition-all"
      style={{ background: "linear-gradient(160deg, #EEF2FF 0%, #F0FDF4 100%)" }}
    >
      <div className="max-w-md w-full flex flex-col items-center justify-center text-center">
        <p className="text-6xl mb-4">🌿</p>
        <h1 className="text-2xl font-bold text-gray-900">내친구 케이</h1>
        <p className="text-sm mt-2 text-gray-500 max-w-xs leading-relaxed">
          환영합니다! 아직 연결된 가족이 없습니다.<br />시작할 역할을 선택해주세요.
        </p>

        <div className="w-full flex flex-col gap-3 mt-8">
          <button
            onClick={() => router.push("/parent/home")}
            className="flex items-center gap-4 bg-white rounded-2xl p-5 w-full text-left active:scale-[0.98] transition-transform hover:shadow-md border border-gray-100"
            style={{ boxShadow: "var(--hb-shadow)" }}
          >
            <span className="text-3xl shrink-0">👨‍👩‍👧</span>
            <div className="flex-1">
              <p className="font-bold text-gray-900">부모용으로 시작하기</p>
              <p className="text-xs text-gray-400 mt-0.5">가족 그룹 생성 · 리포트 확인 · 초대하기</p>
            </div>
            <span className="text-gray-300 text-lg">›</span>
          </button>

          <button
            onClick={() => router.push("/child/home")}
            className="flex items-center gap-4 bg-white rounded-2xl p-5 w-full text-left active:scale-[0.98] transition-transform hover:shadow-md border border-gray-100"
            style={{ boxShadow: "var(--hb-shadow)" }}
          >
            <span className="text-3xl shrink-0">🧒</span>
            <div className="flex-1">
              <p className="font-bold text-gray-900">아이용으로 시작하기</p>
              <p className="text-xs text-gray-400 mt-0.5">초대 코드를 입력하여 가족에 합류하기</p>
            </div>
            <span className="text-gray-300 text-lg">›</span>
          </button>
        </div>
      </div>
    </div>
  );
}

