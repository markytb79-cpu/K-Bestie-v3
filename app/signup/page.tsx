"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("이름을 입력해주세요."); return; }
    if (!email.trim()) { setError("이메일을 입력해주세요."); return; }
    if (password.length < 8) { setError("비밀번호는 8자 이상이어야 해요."); return; }

    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() } },
    });

    if (authError) {
      const msg = authError.message.toLowerCase();
      if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("user already")) {
        setError("이미 가입된 이메일이에요. 로그인해 주세요.");
      } else {
        setError(authError.message);
      }
      setLoading(false);
      return;
    }

    // 이메일 확인이 비활성화된 경우 바로 로그인 상태
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      router.push("/parent/home");
      router.refresh();
    } else {
      // 이메일 인증 필요
      setDone(true);
    }
  }

  if (done) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center px-5 md:max-w-[420px] md:mx-auto"
        style={{ background: "var(--hb-bg)" }}
      >
        <div className="text-center">
          <p className="text-5xl mb-4">📧</p>
          <h2 className="text-lg font-bold text-gray-900 mb-2">이메일을 확인해주세요</h2>
          <p className="text-sm text-gray-500 mb-6">
            {email} 로 인증 링크를 보냈어요.
            <br />링크를 클릭하면 로그인이 완료돼요.
          </p>
          <Link
            href="/login"
            className="block text-center py-3 rounded-xl font-bold text-white text-sm"
            style={{ background: "var(--hb-primary)" }}
          >
            로그인 화면으로 →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 md:max-w-[420px] md:mx-auto"
      style={{ background: "var(--hb-bg)" }}
    >
      <div className="text-center mb-8">
        <p className="text-4xl mb-3">🌿</p>
        <h1 className="text-xl font-bold text-gray-900">내친구 케이 가입</h1>
        <p className="text-sm mt-1" style={{ color: "var(--hb-muted)" }}>
          아이의 마음을 함께 돌봐요
        </p>
      </div>

      <form onSubmit={handleSignup} className="w-full flex flex-col gap-3">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">
            이름 (보호자)
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름을 입력하세요"
            maxLength={20}
            className="w-full rounded-xl px-4 py-3 text-sm border-2 border-transparent outline-none transition-colors"
            style={{ background: "white", boxShadow: "var(--hb-shadow)" }}
            onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
            onBlur={(e) => (e.target.style.borderColor = "transparent")}
          />
        </div>
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
          <label className="text-xs font-semibold text-gray-600 mb-1 block">
            비밀번호{" "}
            <span className="font-normal" style={{ color: "var(--hb-muted)" }}>
              (8자 이상)
            </span>
          </label>
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
          {loading ? "가입 중..." : "회원가입 완료 →"}
        </button>
      </form>

      <p className="mt-6 text-xs text-center" style={{ color: "var(--hb-muted)" }}>
        이미 계정이 있으신가요?{" "}
        <Link
          href="/login"
          className="underline font-semibold"
          style={{ color: "var(--hb-primary)" }}
        >
          로그인
        </Link>
      </p>
    </div>
  );
}
