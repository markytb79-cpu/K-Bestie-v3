"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

interface InvitationInfo {
  family_id: string;
  family_name: string;
  invited_email: string;
  role: string;
  expires_at: string;
}

export default function InviteAcceptPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteInfo, setInviteInfo] = useState<InvitationInfo | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("token");
      if (t) {
        setToken(t);
      } else {
        setError("초대 토큰이 올바르지 않습니다.");
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!token) return;

    const supabase = createClient();

    // 1. 세션 확인 및 현재 유저 이메일 조회
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setCurrentUserEmail(session.user.email ?? null);
      }
    });

    // 2. 초대 토큰 유효성 검사
    fetch(`/api/invitations/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "초대 링크를 가져오는 데 실패했습니다.");
        }
        return res.json();
      })
      .then((data) => {
        setInviteInfo(data);
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [token]);

  const handleAccept = async () => {
    if (!token) return;
    setAccepting(true);
    try {
      const res = await fetch(`/api/invitations/${token}`, {
        method: "POST",
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "초대 수락에 실패했습니다.");
      }
      // 성공 시 부모 홈으로 이동
      router.push("/parent/home");
      router.refresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-gray-50">
        <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--hb-primary) var(--hb-primary) transparent transparent" }} />
        <p className="text-xs text-gray-500 mt-3">초대 정보를 확인하고 있습니다...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-dvh flex flex-col items-center justify-center px-5 py-8 w-full"
        style={{ background: "linear-gradient(160deg, #FEE2E2 0%, #FFF1F2 100%)" }}
      >
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center" style={{ boxShadow: "var(--hb-shadow)" }}>
          <p className="text-6xl mb-4">⚠️</p>
          <h1 className="text-xl font-bold text-gray-900">초대를 진행할 수 없습니다</h1>
          <p className="text-sm mt-3 text-red-600 leading-relaxed bg-red-50 rounded-xl py-3 px-4">
            {error}
          </p>
          <button
            onClick={() => router.push("/")}
            className="mt-6 w-full py-3.5 rounded-xl font-bold text-white text-sm active:scale-[0.98] transition-transform"
            style={{ background: "var(--hb-primary)" }}
          >
            홈으로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  const isEmailMismatch =
    inviteInfo && currentUserEmail && inviteInfo.invited_email.toLowerCase() !== currentUserEmail.toLowerCase();

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-8 w-full"
      style={{ background: "linear-gradient(160deg, #EEF2FF 0%, #F0FDF4 100%)" }}
    >
      <div className="max-w-md w-full bg-white rounded-3xl p-8" style={{ boxShadow: "var(--hb-shadow)" }}>
        <div className="text-center mb-6">
          <p className="text-5xl mb-3">✉️</p>
          <h1 className="text-2xl font-bold text-gray-900">가족 초대장</h1>
          <p className="text-sm text-gray-500 mt-1">
            부모 보호자로 가입하여 함께 활동을 확인하세요.
          </p>
        </div>

        {inviteInfo && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100/50">
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-gray-400">초대된 가족</span>
                <span className="text-sm font-bold text-gray-900 bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full">
                  {inviteInfo.family_name}
                </span>
              </div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-gray-400">초대 대상</span>
                <span className="text-sm text-gray-700 font-medium">{inviteInfo.invited_email}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-gray-400">부여되는 역할</span>
                <span className="text-sm text-gray-700 font-medium">
                  {inviteInfo.role === "admin" ? "관리자 (주 보호자)" : "부 보호자"}
                </span>
              </div>
            </div>

            {currentUserEmail ? (
              <>
                {isEmailMismatch && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-800 leading-relaxed">
                    ⚠️ <strong>계정 이메일 불일치 알림</strong>
                    <br />
                    초대된 이메일(<strong>{inviteInfo.invited_email}</strong>)과 현재 로그인된 계정(
                    <strong>{currentUserEmail}</strong>)이 다릅니다. 이 계정으로 초대를 수락하시겠습니까?
                  </div>
                )}

                <button
                  onClick={handleAccept}
                  disabled={accepting}
                  className="w-full py-4 rounded-xl font-bold text-white text-sm bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg shadow-emerald-100 active:scale-[0.98] transition-transform disabled:opacity-50 mt-4"
                >
                  {accepting ? "초대 수락하는 중..." : "초대 수락하고 가입하기"}
                </button>
              </>
            ) : (
              <div className="space-y-3 mt-6">
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 text-xs text-indigo-800 leading-relaxed text-center font-medium">
                  💡 초대를 수락하기 위해 먼저 로그인이 필요합니다.
                </div>
                <button
                  onClick={() => router.push(`/login?returnUrl=${encodeURIComponent(`/invite/accept?token=${token}`)}`)}
                  className="w-full py-4 rounded-xl font-bold text-white text-sm active:scale-[0.98] transition-transform text-center block"
                  style={{ background: "var(--hb-primary)" }}
                >
                  로그인하러 가기
                </button>
                <div className="text-center mt-3">
                  <span className="text-xs text-gray-400">아직 계정이 없으신가요? </span>
                  <Link
                    href="/signup"
                    className="text-xs font-semibold underline"
                    style={{ color: "var(--hb-primary)" }}
                  >
                    회원가입
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
