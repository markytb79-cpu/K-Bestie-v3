"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { syncChildrenFromDB } from "@/lib/store";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const url = params.get("returnUrl");
      if (url) {
        setReturnUrl(url);
      }
    }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("이메일과 비밀번호를 입력해주세요.");
      return;
    }
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setError("이메일 또는 비밀번호가 올바르지 않아요.");
      setLoading(false);
      return;
    }

    // 로그인 성공 후 DB children → store 동기화 (k_child_id 포함)
    await syncChildrenFromDB();

    if (returnUrl) {
      router.push(returnUrl);
    } else {
      router.push("/parent/home");
    }
    router.refresh();
  }

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 md:max-w-[420px] md:mx-auto"
      style={{ background: "var(--hb-bg)" }}
    >
      {/* 로고 */}
      <div className="text-center mb-8">
        <p className="text-4xl mb-3">🌿</p>
        <h1 className="text-xl font-bold text-gray-900">내친구 케이</h1>
        <p className="text-sm mt-1" style={{ color: "var(--hb-muted)" }}>
          아이의 마음을 함께 돌봐요
        </p>
      </div>

      <form onSubmit={handleLogin} className="w-full flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="이메일을 입력하세요"
            className="w-full rounded-xl px-4 py-3 text-sm border-2 border-transparent outline-none transition-colors"
            style={{ background: "white", boxShadow: "var(--hb-shadow)" }}
            onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
            onBlur={(e) => (e.target.style.borderColor = "transparent")}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">비밀번호</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호를 입력하세요"
            className="w-full rounded-xl px-4 py-3 text-sm border-2 border-transparent outline-none transition-colors"
            style={{ background: "white", boxShadow: "var(--hb-shadow)" }}
            onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
            onBlur={(e) => (e.target.style.borderColor = "transparent")}
          />
        </div>

        {error && (
          <div
            className="rounded-xl px-4 py-3 text-xs font-medium"
            style={{ background: "#FEF2F2", color: "#DC2626" }}
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="py-3.5 rounded-xl font-bold text-white text-sm disabled:opacity-50 transition-opacity active:opacity-80"
          style={{ background: "var(--hb-primary)" }}
        >
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>

      <p className="mt-6 text-xs text-center" style={{ color: "var(--hb-muted)" }}>
        아직 계정이 없으신가요?{" "}
        <Link
          href="/signup"
          className="underline font-semibold"
          style={{ color: "var(--hb-primary)" }}
        >
          회원가입
        </Link>
      </p>
    </div>
  );
}
