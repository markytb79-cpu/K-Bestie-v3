"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import ParentTabBar from "@/components/ParentTabBar";
import { ChevronRight } from "@/components/ParentIcons";
import { useStore } from "@/hooks/useStore";
import { createClient } from "@/lib/supabase/client";

function BellSvg() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

interface Report {
  id: string;
  summary_line: string;
  mood_score: number;
  emotion_tags: string[];
  parent_guide: string;
  created_at: string;
  session: { turn_count: number; started_at: string } | null;
}

function moodEmoji(score: number) {
  if (score <= 3) return "😢";
  if (score <= 5) return "😔";
  if (score <= 7) return "😊";
  if (score <= 9) return "😄";
  return "🌟";
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "방금 전";
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d === 1) return "어제";
  return `${d}일 전`;
}

export default function ParentHomePage() {
  const store = useStore();
  const children = store.children;
  const unreadCount = store.notifications.filter((n) => !n.read).length;

  const [mounted, setMounted] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [latestReport, setLatestReport] = useState<Report | null>(null);
  const [reportCount, setReportCount] = useState(0);
  const [reportLoading, setReportLoading] = useState(false);

  // 가족 관리 상태
  const [famName, setFamName] = useState("");
  const [creatingFam, setCreatingFam] = useState(false);
  const [editingFam, setEditingFam] = useState(false);
  const [newFamName, setNewFamName] = useState("");

  // 합류 신청 관련 상태
  const [joinRequestStatus, setJoinRequestStatus] = useState<"loading" | "none" | "pending">("loading");
  const [viewState, setViewState] = useState<"select" | "create_family" | "join_family">("select");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState<any[]>([]);

  const activeChild = children[activeIdx] ?? null;

  const checkJoinRequest = async () => {
    if (store.activeFamilyId) {
      setJoinRequestStatus("none");
      return;
    }
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setJoinRequestStatus("none");
        return;
      }
      
      const { data, error } = await supabase
          .from("family_join_requests")
          .select("id, status")
          .eq("requester_user_id", user.id)
          .eq("status", "pending")
          .maybeSingle();

      if (data) {
        setJoinRequestStatus("pending");
      } else {
        setJoinRequestStatus("none");
      }
    } catch (err) {
      console.error(err);
      setJoinRequestStatus("none");
    }
  };

  const loadIncomingRequests = async () => {
    if (store.activeFamilyId) return;
    try {
      const res = await fetch("/api/family-join-requests/incoming");
      if (res.ok) {
        const data = await res.json();
        setIncomingRequests(data.invites ?? []);
      }
    } catch (err) {
      console.error("Failed to load incoming requests:", err);
    }
  };

  const handleAcceptInvite = async (requestId: string) => {
    try {
      const res = await fetch(`/api/family-join-requests/${requestId}/accept`, {
        method: "POST"
      });
      if (res.ok) {
        const { syncChildrenFromDB } = await import("@/lib/store");
        await syncChildrenFromDB();
      } else {
        const data = await res.json();
        alert(data.error || "초대 수락에 실패했습니다.");
      }
    } catch {
      alert("네트워크 에러가 발생했습니다.");
    }
  };

  const handleDeclineInvite = async (requestId: string) => {
    try {
      const res = await fetch(`/api/family-join-requests/${requestId}/decline`, {
        method: "POST"
      });
      if (res.ok) {
        await loadIncomingRequests();
      } else {
        const data = await res.json();
        alert(data.error || "초대 거절에 실패했습니다.");
      }
    } catch {
      alert("네트워크 에러가 발생했습니다.");
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !store.activeFamilyId) {
      checkJoinRequest();
      loadIncomingRequests();
    } else if (store.activeFamilyId) {
      setJoinRequestStatus("none");
    }
  }, [mounted, store.activeFamilyId]);

  // 대기 상태인 경우 5초 간격 폴링
  useEffect(() => {
    if (joinRequestStatus !== "pending" || store.activeFamilyId) return;

    const interval = setInterval(async () => {
      const { syncChildrenFromDB } = await import("@/lib/store");
      await syncChildrenFromDB();
    }, 5000);

    return () => clearInterval(interval);
  }, [joinRequestStatus, store.activeFamilyId]);

  const handleJoinRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ownerEmail.trim()) return;
    setJoinError(null);
    setJoining(true);

    try {
      const res = await fetch("/api/family-join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_email: ownerEmail.trim() }),
      });

      const data = await res.json();
      if (res.ok) {
        setJoinRequestStatus("pending");
      } else {
        if (res.status === 404) {
          setJoinError("해당 이메일로 만든 가족을 찾을 수 없어요");
        } else if (res.status === 403) {
          setJoinError("이미 보호자가 2명이라 신청할 수 없어요");
        } else if (res.status === 409) {
          setJoinError("이미 신청했거나 구성원이에요");
        } else {
          setJoinError(data.error || "신청에 실패했습니다. 이메일을 확인해 주세요.");
        }
      }
    } catch {
      setJoinError("네트워크 에러가 발생했습니다.");
    } finally {
      setJoining(false);
    }
  };

  // activeIdx 범위 보정 (아이 삭제 후)
  useEffect(() => {
    if (children.length > 0 && activeIdx >= children.length) {
      setActiveIdx(children.length - 1);
    }
  }, [children.length, activeIdx]);

  useEffect(() => {
    if (!activeChild) {
      setLatestReport(null);
      setReportCount(0);
      setReportLoading(false);
      return;
    }

    setLatestReport(null);
    setReportCount(0);
    setReportLoading(true);

    fetch(`/api/parent/reports?childId=${encodeURIComponent(activeChild.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const reports: Report[] = data?.reports ?? [];
        if (reports.length > 0) {
          setLatestReport(reports[0]);
          setReportCount(reports.length);
        }
      })
      .catch(() => {})
      .finally(() => setReportLoading(false));
  }, [activeChild?.id]);

  if (!mounted) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--hb-bg)" }}>
        <div className="w-8 h-8 rounded-full animate-pulse" style={{ background: "var(--hb-primary)" }} />
      </div>
    );
  }

  const header = (
    <div className="bg-white px-5 pt-12 pb-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-1.5">
          {editingFam ? (
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!newFamName.trim()) return;
              try {
                const res = await fetch(`/api/families/${store.activeFamilyId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: newFamName.trim() }),
                });
                if (res.ok) {
                  const { syncChildrenFromDB } = await import("@/lib/store");
                  await syncChildrenFromDB();
                  setEditingFam(false);
                }
              } catch {}
            }} className="flex items-center gap-1.5">
              <input
                type="text"
                value={newFamName}
                onChange={(e) => setNewFamName(e.target.value)}
                className="px-2 py-0.5 border border-gray-200 rounded-lg text-xs outline-none bg-gray-50"
                maxLength={20}
              />
              <button type="submit" className="text-xs font-semibold text-blue-600">저장</button>
              <button type="button" onClick={() => setEditingFam(false)} className="text-xs font-semibold text-gray-500">취소</button>
            </form>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-bold" style={{ color: "var(--hb-primary)" }}>{store.familyName ?? "가족 만들기"}</p>
              {store.activeFamilyId && (
                <button onClick={() => { setEditingFam(true); setNewFamName(store.familyName ?? ""); }} className="text-[10px] text-gray-400 hover:text-gray-600 underline">수정</button>
              )}
            </div>
          )}
        </div>
        <h1 className="text-[17px] font-bold text-gray-900 mt-0.5">안녕하세요, 보호자님 👋</h1>
      </div>
      <Link href="/parent/notifications" className="relative p-2 -mr-1">
        <BellSvg />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {Math.min(unreadCount, 9)}
          </span>
        )}
      </Link>
    </div>
  );

  // 가족 없음 → 로딩, 버튼 선택, 가족 만들기, 참여하기, 승인 대기 화면 분기
  if (!store.activeFamilyId) {
    // 1. 로딩 상태
    if (joinRequestStatus === "loading") {
      return (
        <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--hb-bg)" }}>
          <div className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--hb-primary) var(--hb-primary) transparent transparent" }} />
        </div>
      );
    }

    // 2. 승인 대기 상태
    if (joinRequestStatus === "pending") {
      return (
        <div className="min-h-dvh pb-[72px] lg:pb-10 lg:pl-[240px] w-full" style={{ background: "var(--hb-bg)" }}>
          <div className="bg-white px-5 pt-12 pb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>내친구 케이</p>
              <h1 className="text-[17px] font-bold text-gray-900 mt-0.5">안녕하세요, 보호자님 👋</h1>
            </div>
          </div>
          <div className="max-w-md mx-auto px-5 py-14 flex flex-col items-center text-center gap-6">
            <p className="text-5xl">⏳</p>
            <div>
              <p className="text-base font-bold text-gray-800">가입 신청 대기 중</p>
              <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "var(--hb-muted)" }}>
                신청이 접수됐어요. 오너의 승인을 기다려주세요.
              </p>
            </div>
            <div className="w-full flex flex-col gap-2.5">
              <button
                onClick={async () => {
                  const { syncChildrenFromDB } = await import("@/lib/store");
                  await syncChildrenFromDB();
                  await checkJoinRequest();
                }}
                className="w-full py-3.5 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform"
                style={{ background: "var(--hb-primary)" }}
              >
                새로고침
              </button>
            </div>
          </div>
          <ParentTabBar />
        </div>
      );
    }

    // 3. 가족도 없고 신청도 없는 경우
    return (
      <div className="min-h-dvh pb-[72px] lg:pb-10 lg:pl-[240px] w-full" style={{ background: "var(--hb-bg)" }}>
        <div className="bg-white px-5 pt-12 pb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>내친구 케이</p>
            <h1 className="text-[17px] font-bold text-gray-900 mt-0.5">안녕하세요, 보호자님 👋</h1>
          </div>
        </div>

        {viewState === "select" && (
          <div className="max-w-md mx-auto px-5 py-10 flex flex-col items-center text-center gap-6">
            <p className="text-5xl">🏡</p>
            <div>
              <p className="text-base font-bold text-gray-800">반가워요! 어떻게 시작할까요?</p>
              <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "var(--hb-muted)" }}>
                가족을 새로 만들거나, 이미 만들어진 가족에 참여할 수 있습니다.
              </p>
            </div>

            {/* 내 앞으로 온 가족 초대 카드 (방식 2) */}
            {incomingRequests.length > 0 && (
              <div className="w-full text-left bg-white rounded-2xl p-4 border border-indigo-100 shadow-sm flex flex-col gap-2.5 mb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-lg">✉️</span>
                  <p className="text-xs font-bold text-gray-900">내 앞으로 온 가족 초대</p>
                </div>
                
                <div className="flex flex-col gap-2">
                  {incomingRequests.map((req) => (
                    <div key={req.id} className="bg-indigo-50/30 rounded-xl p-3 border border-indigo-50 flex items-center justify-between gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-gray-800 truncate">
                          {req.family_name ? `${req.family_name}에 초대됨` : "가족에 초대받음"}
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5 truncate">보낸이: {req.invited_by_email}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleAcceptInvite(req.id)}
                            className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[11px] font-bold transition-colors cursor-pointer active:scale-95"
                          >
                            수락
                          </button>
                          <button
                            onClick={() => handleDeclineInvite(req.id)}
                            className="px-2.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg text-[11px] font-bold transition-colors cursor-pointer active:scale-95"
                          >
                            거절
                          </button>
                        </div>
                        <span className="text-[9px] text-gray-400">수락: 가족에 합류 / 거절: 초대 취소</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="w-full flex flex-col gap-4">
              <div className="flex flex-col gap-1 w-full text-left">
                <button
                  onClick={() => setViewState("create_family")}
                  className="w-full py-4 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-transform text-center"
                  style={{ background: "var(--hb-primary)" }}
                >
                  가족 만들기
                </button>
                <p className="text-[10px] text-gray-400 pl-1">내가 직접 가족 그룹을 새로 만들고 자녀를 관리해요.</p>
              </div>

              <div className="flex flex-col gap-1 w-full text-left">
                <button
                  onClick={() => {
                    setViewState("join_family");
                    setJoinError(null);
                    setOwnerEmail("");
                  }}
                  className="w-full py-4 rounded-2xl font-bold text-sm bg-white border border-gray-200 text-gray-700 active:scale-[0.98] transition-transform text-center"
                  style={{ boxShadow: "var(--hb-shadow)" }}
                >
                  가족 구성원으로 참여하기
                </button>
                <p className="text-[10px] text-gray-400 pl-1">배우자가 이미 만든 가족에 참여 신청을 보내요.</p>
              </div>
            </div>
          </div>
        )}

        {viewState === "create_family" && (
          <div className="max-w-md mx-auto px-5 py-14 flex flex-col items-center text-center gap-6">
            <p className="text-5xl">🛠️</p>
            <div>
              <p className="text-base font-bold text-gray-800">새로운 가족 만들기</p>
              <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "var(--hb-muted)" }}>
                가족 그룹을 만들고 아이를 등록해 보세요.
              </p>
            </div>
            <form onSubmit={async (e) => {
              e.preventDefault();
              if (!famName.trim()) return;
              setCreatingFam(true);
              try {
                const res = await fetch("/api/families", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: famName.trim() }),
                });
                if (res.ok) {
                  const { syncChildrenFromDB } = await import("@/lib/store");
                  await syncChildrenFromDB();
                }
              } catch (err) {
                console.error(err);
              } finally {
                setCreatingFam(false);
              }
            }} className="w-full flex flex-col gap-3">
              <input
                type="text"
                placeholder="예) 서준이네 가족"
                value={famName}
                onChange={(e) => setFamName(e.target.value)}
                className="w-full rounded-2xl px-4 py-3.5 text-sm border border-gray-200 outline-none transition-colors bg-white"
                style={{ boxShadow: "var(--hb-shadow)" }}
              />
              <button
                type="submit"
                disabled={creatingFam || !famName.trim()}
                className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
                style={{ background: "var(--hb-primary)" }}
              >
                {creatingFam ? "가족 만드는 중..." : "가족 만들기 →"}
              </button>
              <button
                type="button"
                onClick={() => setViewState("select")}
                className="text-xs font-semibold text-gray-500 hover:underline mt-2"
              >
                뒤로 가기
              </button>
            </form>
          </div>
        )}

        {viewState === "join_family" && (
          <div className="max-w-md mx-auto px-5 py-14 flex flex-col items-center text-center gap-6">
            <p className="text-5xl">🤝</p>
            <div>
              <p className="text-base font-bold text-gray-800">가족 구성원으로 참여하기</p>
              <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "var(--hb-muted)" }}>
                이미 가족을 만든 오너(배우자)의 이메일 주소를 입력해 참여 신청을 보내세요.
              </p>
            </div>
            <form onSubmit={handleJoinRequestSubmit} className="w-full flex flex-col gap-3">
              <input
                type="email"
                placeholder="오너의 이메일 주소 (예: owner@example.com)"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                className="w-full rounded-2xl px-4 py-3.5 text-sm border border-gray-200 outline-none transition-colors bg-white text-left"
                style={{ boxShadow: "var(--hb-shadow)" }}
                required
              />
              {joinError && (
                <p className="text-xs font-semibold text-red-500 text-left px-1 mt-0.5">{joinError}</p>
              )}
              <button
                type="submit"
                disabled={joining || !ownerEmail.trim()}
                className="w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
                style={{ background: "var(--hb-primary)" }}
              >
                {joining ? "신청하는 중..." : "신청하기 →"}
              </button>
              <button
                type="button"
                onClick={() => setViewState("select")}
                className="text-xs font-semibold text-gray-500 hover:underline mt-2"
              >
                뒤로 가기
              </button>
            </form>
          </div>
        )}

        <ParentTabBar />
      </div>
    );
  }

  // 아이 없음 → 빈 상태
  if (children.length === 0) {
    return (
      <div className="min-h-dvh pb-[72px] lg:pb-10 lg:pl-[240px] w-full" style={{ background: "var(--hb-bg)" }}>
        {header}
        <div className="max-w-3xl mx-auto px-4 py-14 flex flex-col items-center text-center gap-4">
          <p className="text-5xl">👶</p>
          <div>
            <p className="text-base font-bold text-gray-800">아직 등록된 아이가 없어요</p>
            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: "var(--hb-muted)" }}>
              아이를 추가해 케이와 대화를 시작해보세요
            </p>
          </div>
          <Link
            href="/onboarding"
            className="mt-2 px-6 py-3 rounded-full text-sm font-bold text-white shadow-sm active:scale-95 transition-transform"
            style={{ background: "var(--hb-primary)" }}
          >
            아이 추가하기
          </Link>
        </div>
        <ParentTabBar />
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-[72px] lg:pb-12 lg:pl-[240px] w-full transition-all" style={{ background: "var(--hb-bg)" }}>
      {header}

      <div className="max-w-6xl mx-auto px-4 py-4">
        {/* 프로필 스위처 및 오늘 메타 정보 */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
          <div className="flex items-center gap-4 overflow-x-auto py-1">
            {children.map((child, idx) => (
              <button
                key={child.id}
                onClick={() => setActiveIdx(idx)}
                className="flex flex-col items-center gap-1.5 shrink-0 group focus:outline-none"
              >
                <div
                  className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-2xl transition-all group-active:scale-95"
                  style={{
                    border: activeIdx === idx ? "2.5px solid #5B5BD6" : "2px solid #E5E7EB",
                    background: activeIdx === idx ? "#EDEDFC" : "#F9FAFB",
                    boxShadow: activeIdx === idx ? "0 4px 12px rgba(91,91,214,0.15)" : "none",
                  }}
                >
                  🧒
                </div>
                <span
                  className="text-xs font-semibold"
                  style={{ color: activeIdx === idx ? "#5B5BD6" : "#9CA3AF" }}
                >
                  {child.name}
                </span>
              </button>
            ))}

            <Link href="/onboarding" className="flex flex-col items-center gap-1.5 shrink-0">
              <div
                className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-xl active:scale-95 transition-transform"
                style={{ border: "2px dashed #D1D5DB", background: "#F9FAFB", color: "#9CA3AF" }}
              >
                +
              </div>
              <span className="text-xs" style={{ color: "#9CA3AF" }}>추가</span>
            </Link>
          </div>

          {activeChild && (
            <div className="flex flex-wrap items-center gap-3 px-1 md:px-0 text-xs text-gray-500 font-semibold md:self-center border-t md:border-t-0 pt-3 md:pt-0">
              {latestReport ? (
                <>
                  <span className="flex items-center gap-1.5 bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full">
                    <span>💬</span> 오늘 대화 {latestReport.session?.turn_count ?? 0}회
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                  <span className="flex items-center gap-1.5 bg-gray-50 text-gray-600 px-3 py-1.5 rounded-full">
                    <span>⏱️</span> 마지막 대화: {formatRelative(latestReport.created_at)}
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5 bg-gray-50 text-gray-400 px-3 py-1.5 rounded-full">
                    <span>💬</span> 오늘 대화 0회
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
                  <span className="flex items-center gap-1.5 bg-gray-50 text-gray-400 px-3 py-1.5 rounded-full">
                    <span>⏱️</span> 대화 기록 없음
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* 메인 반응형 그리드 시스템 */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* 왼쪽 컬럼: 이해 -> 안심 -> 대화 흐름 */}
          <div className="lg:col-span-8 flex flex-col gap-5">
            
            {/* 1. 이해 블록 (오늘 한 줄 요약 + 오늘의 핵심 키워드) */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 transition-all duration-300 hover:shadow-md">
              <div className="flex items-center gap-2 mb-5">
                <span className="text-base bg-indigo-50 p-1.5 rounded-xl">💡</span>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">이해하기</h3>
              </div>
              
              {/* ① 오늘 한 줄 요약 */}
              <div className="mb-6">
                {reportLoading ? (
                  <div className="py-8 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--hb-primary) var(--hb-primary) transparent transparent" }} />
                  </div>
                ) : latestReport ? (
                  <div className="flex items-start gap-4">
                    <span className="text-4xl md:text-5xl shrink-0 leading-none filter drop-shadow-sm select-none">
                      {moodEmoji(latestReport.mood_score)}
                    </span>
                    <div>
                      <p className="text-lg md:text-xl font-bold text-gray-955 leading-relaxed tracking-tight">
                        "{latestReport.summary_line}"
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4 py-4 px-4 bg-gray-50/50 rounded-2xl border border-dashed border-gray-100">
                    <span className="text-4xl shrink-0 leading-none">📝</span>
                    <p className="text-sm font-semibold text-gray-400 leading-relaxed mt-1">
                      아직 오늘 대화가 없어요. 아이가 케이와 대화하면 여기에 하루 요약이 나타나요.
                    </p>
                  </div>
                )}
              </div>

              {/* ② 오늘의 핵심 키워드 */}
              <div className="pt-5 border-t border-gray-50">
                <p className="text-xs font-bold text-gray-400 mb-3">오늘의 감정 키워드</p>
                {reportLoading ? (
                  <div className="h-6 w-32 bg-gray-100 animate-pulse rounded-full" />
                ) : latestReport && latestReport.emotion_tags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {latestReport.emotion_tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105 duration-200"
                        style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 font-medium">
                    대화가 완료되면 오늘의 감정 키워드가 해시태그로 표시됩니다 🏷️
                  </p>
                )}
              </div>
            </div>

            {/* 2. 대화 블록 (오늘 대화거리) */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 transition-all duration-300 hover:shadow-md">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-base bg-amber-50 p-1.5 rounded-xl">💬</span>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">대화하기</h3>
              </div>
              
              <div>
                {reportLoading ? (
                  <div className="space-y-3">
                    <div className="h-10 bg-gray-50 animate-pulse rounded-2xl" />
                    <div className="h-10 bg-gray-50 animate-pulse rounded-2xl" />
                  </div>
                ) : latestReport && latestReport.parent_guide ? (
                  <div>
                    <p className="text-xs font-bold text-gray-400 mb-3">오늘 아이에게 슬쩍 물어보세요</p>
                    <div className="flex flex-col gap-3">
                      {latestReport.parent_guide
                        .split(/[.\n]/)
                        .map((s) => s.trim())
                        .filter((s) => s.length > 5)
                        .slice(0, 3)
                        .map((sentence, idx) => (
                          <div key={idx} className="flex items-start gap-3.5 p-4 rounded-2xl bg-indigo-50/30 border border-indigo-100/30 transition-all hover:bg-indigo-50/50 duration-200">
                            <span className="text-lg shrink-0 mt-0.5">💬</span>
                            <p className="text-sm font-semibold text-gray-700 leading-relaxed">
                              {sentence}
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3.5 p-4.5 rounded-2xl border border-dashed border-gray-200">
                    <span className="text-xl shrink-0 mt-0.5">💬</span>
                    <p className="text-xs font-semibold text-gray-400 leading-relaxed">
                      아이와 나눌 대화 꿀팁 질문이 생성될 예정이에요 💬
                    </p>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* 오른쪽 컬럼: 퀵 메뉴 */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            {/* 리포트 바로가기 */}
            <Link
              href="/parent/report"
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-all hover:shadow-md duration-200 border border-gray-100"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl">📊</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">전체 대화 리포트</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>
                    {reportCount > 0 ? `${reportCount}개의 리포트가 있어요` : "지난 대화 기록을 확인해요"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold" style={{ color: "var(--hb-primary)" }}>보기</span>
                <span style={{ color: "var(--hb-primary)" }}><ChevronRight color="currentColor" /></span>
              </div>
            </Link>

            {/* 오늘의 대화 가이드 카드 */}
            <Link
              href="/parent/guide"
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-all hover:shadow-md duration-200 border border-gray-100"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl">📖</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">오늘의 대화 가이드</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>아이와 더 자연스럽게 대화하기</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold" style={{ color: "var(--hb-primary)" }}>보기</span>
                <span style={{ color: "var(--hb-primary)" }}><ChevronRight color="currentColor" /></span>
              </div>
            </Link>



            {/* 전문가와 연결하기 카드 (딤 처리 및 준비 중 배지) */}
            <div
              className="relative overflow-hidden flex items-center justify-between bg-gray-50/50 border border-gray-100 rounded-2xl p-5 opacity-60 cursor-not-allowed select-none"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl grayscale">🔗</span>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-gray-500">전문가와 연결하기</p>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-gray-200 text-gray-600 rounded-full">
                      서비스 준비 중
                    </span>
                  </div>
                  <p className="text-xs mt-1 text-gray-400">아이의 마음을 전문가와 함께 진단 (곧 만나요)</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 text-gray-400 text-xs font-semibold">
                <span>대기</span>
              </div>
            </div>

          </div>

        </div>
      </div>



      <ParentTabBar />
    </div>
  );

}
