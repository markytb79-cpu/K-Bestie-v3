"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import ParentTabBar from "@/components/ParentTabBar";
import { ChevronRight } from "@/components/ParentIcons";
import { useStore } from "@/hooks/useStore";

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
  session: { turn_count: number } | null;
}

export default function ParentHomePage() {
  const store = useStore();
  const children = store.children;
  const unreadCount = store.notifications.filter((n) => !n.read).length;

  const [activeIdx, setActiveIdx] = useState(0);
  const [latestReport, setLatestReport] = useState<Report | null>(null);
  const [reportCount, setReportCount] = useState(0);
  const [reportLoading, setReportLoading] = useState(false);

  // 가족 관리 상태
  const [famName, setFamName] = useState("");
  const [creatingFam, setCreatingFam] = useState(false);
  const [editingFam, setEditingFam] = useState(false);
  const [newFamName, setNewFamName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviting, setInviting] = useState(false);

  const activeChild = children[activeIdx] ?? null;

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

  // 가족 없음 → 빈 상태
  if (!store.activeFamilyId) {
    return (
      <div className="min-h-dvh pb-[72px] lg:pb-10 lg:pl-[240px] w-full" style={{ background: "var(--hb-bg)" }}>
        <div className="bg-white px-5 pt-12 pb-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--hb-muted)" }}>내친구 케이</p>
            <h1 className="text-[17px] font-bold text-gray-900 mt-0.5">안녕하세요, 보호자님 👋</h1>
          </div>
        </div>
        <div className="max-w-md mx-auto px-5 py-14 flex flex-col items-center text-center gap-6">
          <p className="text-5xl">🏡</p>
          <div>
            <p className="text-base font-bold text-gray-800">아직 가족 그룹이 없어요</p>
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
          </form>
        </div>
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
        {/* 프로필 스위처 */}
        <div className="flex items-center gap-4 px-1 mb-6 overflow-x-auto py-1">
          {children.map((child, idx) => (
            <button
              key={child.id}
              onClick={() => setActiveIdx(idx)}
              className="flex flex-col items-center gap-1.5 shrink-0 group"
            >
              <div
                className="w-[56px] h-[56px] rounded-full flex items-center justify-center text-2xl transition-all group-active:scale-95"
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
              className="w-[56px] h-[56px] rounded-full flex items-center justify-center text-xl active:scale-95 transition-transform"
              style={{ border: "2px dashed #D1D5DB", background: "#F9FAFB", color: "#9CA3AF" }}
            >
              +
            </div>
            <span className="text-xs" style={{ color: "#9CA3AF" }}>추가</span>
          </Link>
        </div>

        {/* 메인 반응형 그리드 시스템 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-5">
          
          {/* 왼쪽 또는 메인 열: 오늘의 기록 카드 */}
          <div className="lg:col-span-7 flex flex-col gap-4">
            <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "var(--hb-shadow)" }}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--hb-muted)" }}>오늘의 기록</p>
                  <h2 className="text-[17px] font-bold text-gray-900">
                    {activeChild!.name}이의 오늘
                  </h2>
                </div>
                {latestReport ? (
                  <div className="flex items-baseline gap-0.5 px-3.5 py-1.5 rounded-full" style={{ background: "#DCFCE7" }}>
                    <span className="text-sm font-bold" style={{ color: "#15803D" }}>{latestReport.mood_score}</span>
                    <span className="text-xs" style={{ color: "#4ADE80" }}>/10</span>
                  </div>
                ) : (
                  <span className="text-xs px-3 py-1.5 rounded-full" style={{ background: "#F3F4F6", color: "#9CA3AF" }}>
                    대기 중
                  </span>
                )}
              </div>

              {reportLoading ? (
                <div className="py-8 flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--hb-primary) var(--hb-primary) transparent transparent" }} />
                </div>
              ) : latestReport ? (
                <>
                  <p className="text-sm leading-relaxed text-gray-600 mb-4">{latestReport.summary_line}</p>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
                      <span>💬</span>
                      <span>대화 {latestReport.session?.turn_count ?? 0}회</span>
                    </span>
                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--hb-muted)" }}>
                      <span>📊</span>
                      <span>리포트 {reportCount}개</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {latestReport.emotion_tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-3 py-1 rounded-full text-xs font-semibold"
                        style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm font-semibold text-gray-500">아직 대화 기록이 없어요</p>
                  <p className="text-xs mt-1.5 max-w-xs mx-auto leading-relaxed" style={{ color: "var(--hb-muted)" }}>
                    {activeChild!.name}이가 케이와 대화하면 여기에 리포트가 표시됩니다.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 오른쪽 또는 서브 열: 메뉴 및 바로가기 카드들 */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* 리포트 바로가기 */}
            <Link
              href="/parent/report"
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-opacity hover:shadow-md duration-200"
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
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-opacity hover:shadow-md duration-200"
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

            {/* 부모 초대하기 카드 */}
            <button
              onClick={() => { setShowInviteModal(true); setInviteUrl(""); setInviteEmail(""); }}
              className="flex items-center justify-between w-full bg-white rounded-2xl p-5 text-left active:opacity-75 transition-opacity hover:shadow-md duration-200"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl">✉️</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">부모 초대하기</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>다른 보호자를 초대해 함께 돌봐요</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold" style={{ color: "var(--hb-primary)" }}>초대</span>
                <span style={{ color: "var(--hb-primary)" }}><ChevronRight color="currentColor" /></span>
              </div>
            </button>

            {/* 전문가와 연결하기 카드 */}
            <Link
              href="/parent/expert"
              className="flex items-center justify-between bg-white rounded-2xl p-5 active:opacity-75 transition-opacity hover:shadow-md duration-200"
              style={{ boxShadow: "var(--hb-shadow)" }}
            >
              <div className="flex items-center gap-3.5">
                <span className="text-2xl">🔗</span>
                <div>
                  <p className="text-sm font-bold text-gray-900">전문가와 연결하기</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>아이의 마음을 전문가와 함께 진단</p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span className="text-xs font-semibold" style={{ color: "var(--hb-primary)" }}>보기</span>
                <span style={{ color: "var(--hb-primary)" }}><ChevronRight color="currentColor" /></span>
              </div>
            </Link>
          </div>

        </div>
      </div>

      {/* 부모 초대 모달 */}
      {showInviteModal && (
        <>
          <div className="fixed inset-0 z-[110] bg-black/40" onClick={() => setShowInviteModal(false)} />
          <div
            className="fixed bottom-0 left-0 right-0 z-[120] bg-white rounded-t-3xl px-5 pt-5 pb-10 md:max-w-[420px] md:mx-auto md:left-1/2 md:-translate-x-1/2"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.12)" }}
          >
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">보호자 초대하기 ✉️</h2>
              <button onClick={() => setShowInviteModal(false)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>
            
            {!inviteUrl ? (
              <form onSubmit={async (e) => {
                e.preventDefault();
                if (!inviteEmail.trim()) return;
                setInviting(true);
                try {
                  const res = await fetch(`/api/families/${store.activeFamilyId}/invite-parent`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email: inviteEmail.trim() }),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setInviteUrl(data.invite_url);
                  } else {
                    alert("초대에 실패했습니다. 이메일을 확인해 주세요.");
                  }
                } catch {
                  alert("에러가 발생했습니다. 다시 시도해 주세요.");
                } finally {
                  setInviting(false);
                }
              }} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-gray-700">초대할 보호자 이메일</label>
                  <input
                    type="email"
                    required
                    placeholder="example@email.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-gray-50 text-sm outline-none border-2 border-transparent transition-colors"
                    onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
                    onBlur={(e) => (e.target.style.borderColor = "transparent")}
                  />
                </div>
                <button
                  type="submit"
                  disabled={inviting || !inviteEmail.trim()}
                  className="w-full py-3.5 rounded-2xl font-bold text-white transition-opacity disabled:opacity-40"
                  style={{ background: "var(--hb-primary)" }}
                >
                  {inviting ? "링크 생성 중..." : "초대 링크 생성 →"}
                </button>
              </form>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
                  <p className="text-sm font-semibold text-green-800">초대 링크가 생성되었습니다!</p>
                  <p className="text-xs text-green-600 mt-1">아래 링크를 복사하여 상대 보호자에게 전달하세요.</p>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-xs break-all font-mono">
                  {inviteUrl}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteUrl);
                    alert("초대 링크가 복사되었습니다!");
                  }}
                  className="w-full py-3.5 rounded-2xl font-bold text-white"
                  style={{ background: "var(--hb-primary)" }}
                >
                  초대 링크 복사
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <ParentTabBar />
    </div>
  );

}
