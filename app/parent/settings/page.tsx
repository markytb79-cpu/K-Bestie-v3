"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ParentTabBar from "@/components/ParentTabBar";
import { BackArrow, ChevronRight } from "@/components/ParentIcons";
import { useStore } from "@/hooks/useStore";
import {
  setNotifSetting,
  clearStore,
  updateChild,
  removeChild,
  type StoreChild,
} from "@/lib/store";
import { createClient } from "@/lib/supabase/client";

const GRADES = ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"];
const INTERESTS = ["공룡", "우주", "동물", "그림", "음악", "스포츠", "요리", "게임", "과학", "책"];

interface Question {
  id: string;
  question_text: string;
  status: "대기중" | "전달됨" | "중지됨";
  delivered_count: number;
}

const STATUS_STYLES: Record<string, { bg: string; color: string }> = {
  "전달됨": { bg: "#DCFCE7", color: "#15803D" },
  "대기중": { bg: "#F3F4F6", color: "#6B7280" },
  "중지됨": { bg: "#FEF2F2", color: "#DC2626" },
};

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-xs font-bold px-1 mb-2" style={{ color: "var(--hb-muted)" }}>{title}</p>
  );
}

export default function ParentSettingsPage() {
  const router = useRouter();
  const store = useStore();
  const { reportAlert, emotionAlert, weeklySummary } = store.notifSettings;

  const [questions, setQuestions] = useState<Question[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // 수정 시트 상태
  const [editChild, setEditChild] = useState<StoreChild | null>(null);
  const [editName, setEditName] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 로그인 이메일 로드
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const id = localStorage.getItem("k_child_id");
    if (!id) return;

    fetch(`/api/parent/questions?childId=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((qData) => setQuestions(qData?.questions ?? []))
      .catch(() => {});
  }, []);

  function openEdit(child: StoreChild) {
    setEditChild(child);
    setEditName(child.name);
    setEditGrade(child.grade);
    setEditInterests(child.interests ?? []);
    setConfirmDelete(false);
  }

  function closeEdit() {
    setEditChild(null);
    setConfirmDelete(false);
  }

  function handleSave() {
    if (!editChild || !editName.trim() || !editGrade) return;
    updateChild(editChild.id, {
      name: editName.trim(),
      grade: editGrade,
      interests: editInterests,
    });
    closeEdit();
  }

  function handleDelete() {
    if (!editChild) return;
    removeChild(editChild.id);
    closeEdit();
  }

  function toggleEditInterest(item: string) {
    setEditInterests((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  }

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => {});
    clearStore();
    router.push("/login");
  };

  const TOGGLE_ITEMS = [
    { key: "reportAlert" as const,   label: "리포트 알림",   desc: "대화 후 리포트 도착 시",   on: reportAlert },
    { key: "emotionAlert" as const,  label: "감정 위험 알림", desc: "주의 신호 감지 시 즉시",   on: emotionAlert },
    { key: "weeklySummary" as const, label: "주간 요약",      desc: "매주 일요일 오전",         on: weeklySummary },
  ];

  const storeChildren = store.children;

  return (
    <div
      className="min-h-dvh pb-[72px] lg:pb-12 lg:pl-[240px] w-full transition-all"
      style={{ background: "var(--hb-bg)" }}
    >
      <div className="bg-white px-5 pt-12 pb-4 flex items-center gap-3">
        <Link href="/parent/home" style={{ color: "var(--hb-primary)" }}><BackArrow /></Link>
        <h1 className="text-[17px] font-bold text-gray-900">설정 ⚙️</h1>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4">
        {/* 2열 반응형 그리드 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          
          {/* 왼쪽 열 */}
          <div className="flex flex-col gap-5">
            {/* 자녀 관리 */}
            <div>
              <SectionHeader title="자녀 관리" />
              <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--hb-shadow)" }}>
                {storeChildren.map((child, i) => (
                  <button
                    key={child.id}
                    onClick={() => openEdit(child)}
                    className="flex items-center gap-3 px-4 py-3.5 w-full text-left active:bg-gray-50 transition-colors"
                    style={{ borderBottom: i < storeChildren.length - 1 ? "1px solid #F3F4F6" : "none" }}
                  >
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                      style={{ background: "var(--hb-primary-light)" }}
                    >
                      🧒
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-gray-900">{child.name}</p>
                      <p className="text-xs" style={{ color: "var(--hb-muted)" }}>{child.grade}</p>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full mr-1" style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}>
                      수정
                    </span>
                    <ChevronRight />
                  </button>
                ))}

                <Link
                  href="/onboarding"
                  className="flex items-center gap-3 px-4 py-3.5 w-full active:bg-gray-50 transition-colors"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                    style={{ border: "2px dashed #D1D5DB", color: "#9CA3AF" }}
                  >
                    +
                  </div>
                  <p className="text-sm font-semibold" style={{ color: "var(--hb-muted)" }}>자녀 추가하기</p>
                </Link>
              </div>
            </div>

            {/* 부모 질문 관리 */}
            <div>
              <SectionHeader title="부모 질문 관리" />
              <div className="bg-white rounded-2xl p-4" style={{ boxShadow: "var(--hb-shadow)" }}>
                {questions.length === 0 ? (
                  <p className="text-sm text-center py-2" style={{ color: "var(--hb-muted)" }}>등록된 질문이 없어요</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {questions.slice(0, 3).map((q) => {
                      const style = STATUS_STYLES[q.status] ?? STATUS_STYLES["대기중"];
                      return (
                        <div key={q.id} className="flex items-start gap-3 border-b border-gray-50 pb-2 last:border-0 last:pb-0">
                          <p className="text-sm font-semibold text-gray-700 flex-1 leading-snug">{q.question_text}</p>
                          <span
                            className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
                            style={{ background: style.bg, color: style.color }}
                          >
                            {q.status === "대기중" ? "대기 중" : q.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Link
                  href="/parent/guide"
                  className="mt-3 block text-center text-xs font-bold py-2.5 rounded-xl transition-opacity active:opacity-85"
                  style={{ background: "var(--hb-primary-light)", color: "var(--hb-primary)" }}
                >
                  질문 추가/관리하기 →
                </Link>
              </div>
            </div>
          </div>

          {/* 오른쪽 열 */}
          <div className="flex flex-col gap-5">
            {/* 알림 설정 */}
            <div>
              <SectionHeader title="대화 알림" />
              <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--hb-shadow)" }}>
                {TOGGLE_ITEMS.map((item, i, arr) => (
                  <button
                    key={item.key}
                    onClick={() => setNotifSetting(item.key, !item.on)}
                    className="flex items-center justify-between px-4 py-3.5 w-full text-left active:bg-gray-50 transition-colors"
                    style={{ borderBottom: i < arr.length - 1 ? "1px solid #F3F4F6" : "none" }}
                  >
                    <div>
                      <p className="text-sm font-bold text-gray-900">{item.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--hb-muted)" }}>{item.desc}</p>
                    </div>
                    <div
                      className="w-11 h-6 rounded-full flex items-center px-0.5 shrink-0 transition-colors duration-200"
                      style={{ background: item.on ? "var(--hb-primary)" : "#D1D5DB" }}
                    >
                      <div
                        className="w-5 h-5 bg-white rounded-full shadow-sm transition-all duration-200"
                        style={{ marginLeft: item.on ? "auto" : "0" }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 계정 정보 */}
            <div>
              <SectionHeader title="계정" />
              <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: "var(--hb-shadow)" }}>
                <div
                  className="flex items-center justify-between px-4 py-3.5"
                  style={{ borderBottom: "1px solid #F3F4F6" }}
                >
                  <p className="text-sm font-medium text-gray-700">이메일</p>
                  <p className="text-sm font-semibold" style={{ color: "var(--hb-muted)" }}>
                    {userEmail ?? "로딩 중..."}
                  </p>
                </div>
                <div className="flex items-center justify-between px-4 py-3.5">
                  <p className="text-sm font-medium text-gray-700">플랜</p>
                  <p className="text-sm font-semibold" style={{ color: "var(--hb-muted)" }}>무료</p>
                </div>
              </div>
            </div>

            {/* 로그아웃 */}
            <div className="mt-2">
              <button
                onClick={handleLogout}
                className="w-full py-3.5 rounded-2xl text-sm font-bold border transition-opacity active:opacity-70"
                style={{ borderColor: "rgba(239,68,68,0.25)", color: "#DC2626", background: "rgba(239,68,68,0.04)" }}
              >
                로그아웃
              </button>
              <p className="text-center text-[10px] mt-2 font-medium" style={{ color: "#9CA3AF" }}>
                로그아웃해도 아이·대화 데이터는 유지됩니다
              </p>
            </div> {/* 로그아웃 div 닫기 */}
          </div> {/* 오른쪽 열 div 닫기 */}
        </div> {/* grid div 닫기 */}

        <p className="text-center text-xs py-6 mt-4" style={{ color: "var(--hb-muted)" }}>
          내친구 케이 v3.0
        </p>
      </div> {/* max-w-4xl mx-auto px-4 py-4 div 닫기 */}

      <ParentTabBar />

      {/* ── 아이 수정 바텀 시트 ─────────────────────────────────────── */}
      {editChild && (
        <>
          {/* 오버레이 */}
          <div
            className="fixed inset-0 z-[110] bg-black/40"
            onClick={closeEdit}
          />

          {/* 시트 */}
          <div
            className="fixed bottom-0 left-0 right-0 z-[120] bg-white rounded-t-3xl px-5 pt-5 pb-10 md:max-w-[420px] md:mx-auto md:left-1/2 md:-translate-x-1/2"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.12)" }}
          >
            {/* 시트 핸들 */}
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">
                {editChild.name} 수정
              </h2>
              <button onClick={closeEdit} className="text-gray-400 text-xl leading-none">✕</button>
            </div>

            {!confirmDelete ? (
              <div className="flex flex-col gap-4">
                {/* 이름 */}
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-gray-700">이름</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={10}
                    className="w-full px-4 py-3 rounded-2xl bg-gray-50 text-sm outline-none border-2 border-transparent transition-colors"
                    onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
                    onBlur={(e) => (e.target.style.borderColor = "transparent")}
                  />
                </div>

                {/* 학년 */}
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-gray-700">학년</label>
                  <div className="flex gap-2 flex-wrap">
                    {GRADES.map((g) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => setEditGrade(g)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                        style={
                          editGrade === g
                            ? { background: "var(--hb-primary)", color: "#fff" }
                            : { background: "#F3F4F6", color: "#374151" }
                        }
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 관심사 */}
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-gray-700">관심사</label>
                  <div className="flex gap-2 flex-wrap">
                    {INTERESTS.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleEditInterest(item)}
                        className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
                        style={
                          editInterests.includes(item)
                            ? { background: "var(--hb-primary)", color: "#fff" }
                            : { background: "#F3F4F6", color: "#374151" }
                        }
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 버튼 */}
                <button
                  onClick={handleSave}
                  disabled={!editName.trim() || !editGrade}
                  className="w-full py-3.5 rounded-2xl font-bold text-white transition-opacity disabled:opacity-40"
                  style={{ background: "var(--hb-primary)" }}
                >
                  저장 완료
                </button>

                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full py-2.5 text-sm font-medium"
                  style={{ color: "#DC2626" }}
                >
                  🗑 이 아이 삭제
                </button>
              </div>
            ) : (
              /* 삭제 확인 */
              <div className="flex flex-col gap-3">
                <div
                  className="rounded-2xl p-4 text-center"
                  style={{ background: "#FEF2F2", border: "1.5px solid #FECACA" }}
                >
                  <p className="text-2xl mb-2">⚠️</p>
                  <p className="text-sm font-bold text-gray-900 mb-1">
                    {editChild.name} 아이를 삭제할까요?
                  </p>
                  <p className="text-xs text-gray-500">
                    삭제 후에는 되돌릴 수 없어요. 대화·미션 데이터도 함께 사라져요.
                  </p>
                </div>
                <button
                  onClick={handleDelete}
                  className="w-full py-3.5 rounded-2xl font-bold text-white"
                  style={{ background: "#DC2626" }}
                >
                  삭제 확인
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="w-full py-2.5 rounded-2xl text-sm font-semibold border border-gray-200 text-gray-600"
                >
                  취소
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
