"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealChildNav } from "@/components/RealChildNav";

export default function ChildSettingsPage() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => {});
    localStorage.removeItem("k_child_id");
    localStorage.removeItem("k_session_id");
    router.push("/login");
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/child/home" className="font-bold text-sm cursor-pointer" style={{ color: "#1a6b5a" }}>
            설정
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          <button
            onClick={handleLogout}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex items-center gap-3 cursor-pointer active:opacity-85 transition-opacity w-full text-left"
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
              style={{ background: "#f3f4f6" }}
            >
              🚪
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>
                로그아웃
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "#6b7280" }}>
                다음에 또 만나요
              </p>
            </div>
            <span className="text-sm" style={{ color: "#6b7280" }}>
              →
            </span>
          </button>
        </div>

        <RealChildNav active="설정" />
      </div>
    </DemoFrame>
  );
}
