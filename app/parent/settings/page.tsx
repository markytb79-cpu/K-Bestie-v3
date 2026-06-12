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
  const { reportAlert, weeklySummary } = store.notifSettings;

  const [mounted, setMounted] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // 구성원 관리 상태
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);

  // 구성원 추가 폼 상태 (아이/보호자 개별)
  const [showAddChildForm, setShowAddChildForm] = useState(false);
  const [showAddParentForm, setShowAddParentForm] = useState(false);
  const [addRole, setAddRole] = useState<"parent" | "child">("child");
  const [addName, setAddName] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  
  // 아이 추가 전용 상태
  const [addChildGrade, setAddChildGrade] = useState("1학년");
  const [addChildInterests, setAddChildInterests] = useState<string[]>([]);
  const [addChildConsent, setAddChildConsent] = useState(false);
  
  const [addError, setAddError] = useState<string | null>(null);
  const [addLoading, setAddLoading] = useState(false);

  // 비밀번호 초기화 상태
  const [resettingMember, setResettingMember] = useState<any | null>(null);
  const [newResetPassword, setNewResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  // 수정 시트 상태 (기존)
  const [editChild, setEditChild] = useState<StoreChild | null>(null);
  const [editName, setEditName] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 가입 신청 목록 및 로딩 상태
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);

  // 로그인 이메일 및 구성원 정보 로드
  useEffect(() => {
    setMounted(true);
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

  // 구성원 및 오너 권한 로드
  const loadFamilyMembers = async () => {
    if (!store.activeFamilyId) {
      setLoadingMembers(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. 가족 상세 정보 GET
      const famRes = await fetch(`/api/families/${store.activeFamilyId}`);
      if (!famRes.ok) throw new Error("가족 정보 조회 실패");
      const { family } = await famRes.json();

      // 2. 오너 판별
      const myMember = family.family_members.find((m: any) => m.user_id === user.id);
      const owner = myMember?.role === "owner_parent";
      setIsOwner(owner);

      // 3. member_accounts 직접 SELECT
      const { data: accounts, error: accErr } = await supabase
        .from("member_accounts")
        .select("id, username, display_name, role, must_change_password")
        .eq("family_id", store.activeFamilyId);

      if (accErr) throw accErr;

      // 4. 결합
      const merged = family.family_members.map((m: any) => {
        const acc = accounts?.find((a: any) => a.id === m.user_id);
        const childProf = m.role === "child"
          ? family.child_profiles?.find((c: any) => c.member_id === m.id)
          : null;
        
        let dispName = m.role === "child" 
          ? (childProf?.name || "") 
          : (acc?.display_name || "");

        if (!dispName && acc?.display_name) dispName = acc.display_name;

        return {
          memberId: m.id, // family_members.id
          userId: m.user_id, // auth.users.id
          role: m.role,
          username: acc?.username || "",
          displayName: dispName || "구성원",
          mustChangePassword: acc?.must_change_password ?? false,
          isMe: m.user_id === user.id,
          childId: childProf?.id || "",
          grade: childProf?.grade || "",
          interests: childProf?.interests || []
        };
      });

      setFamilyMembers(merged);
    } catch (err) {
      console.error("Failed to load family members:", err);
    } finally {
      setLoadingMembers(false);
    }
  };

  const loadJoinRequests = async () => {
    if (!store.activeFamilyId || !isOwner) {
      setLoadingRequests(false);
      return;
    }
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/join-requests?status=pending`);
      if (res.ok) {
        const data = await res.json();
        setJoinRequests(data.requests ?? []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingRequests(false);
    }
  };

  useEffect(() => {
    loadFamilyMembers();
  }, [store.activeFamilyId]);

  useEffect(() => {
    if (store.activeFamilyId && isOwner) {
      loadJoinRequests();
    } else {
      setLoadingRequests(false);
    }
  }, [store.activeFamilyId, isOwner]);

  const handleApproveRequest = async (requestId: string) => {
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/join-requests/${requestId}/approve`, {
        method: "POST"
      });
      if (res.ok) {
        setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
        await loadFamilyMembers();
      } else {
        const data = await res.json();
        alert(data.error || "승인 처리에 실패했습니다.");
      }
    } catch {
      alert("네트워크 에러가 발생했습니다.");
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/join-requests/${requestId}/reject`, {
        method: "POST"
      });
      if (res.ok) {
        setJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      } else {
        const data = await res.json();
        alert(data.error || "거절 처리에 실패했습니다.");
      }
    } catch {
      alert("네트워크 에러가 발생했습니다.");
    }
  };

  if (!mounted) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: "var(--hb-bg)" }}>
        <div className="w-8 h-8 rounded-full animate-pulse" style={{ background: "var(--hb-primary)" }} />
      </div>
    );
  }

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

  function toggleAddInterest(item: string) {
    setAddChildInterests((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    );
  }

  const handleAddChild = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    if (!addName.trim()) { setAddError("이름을 입력해주세요."); return; }
    if (!addUsername.trim()) { setAddError("아이디를 입력해주세요."); return; }
    if (addPassword.length < 6) { setAddError("비밀번호는 6자 이상이어야 합니다."); return; }
    if (addChildInterests.length === 0) { setAddError("관심사를 하나 이상 선택해주세요."); return; }
    if (!addChildConsent) { setAddError("법정대리인 동의가 필요합니다."); return; }

    setAddLoading(true);
    try {
      const body = {
        username: addUsername.trim(),
        password: addPassword,
        name: addName.trim(),
        grade: addChildGrade,
        interests: addChildInterests,
        guardian_consent: addChildConsent
      };

      const res = await fetch(`/api/families/${store.activeFamilyId}/children`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setAddError("이미 사용 중인 아이디입니다. 다른 아이디를 사용하세요.");
        } else {
          setAddError(data.error || "아이 추가에 실패했습니다.");
        }
        return;
      }

      setShowAddChildForm(false);
      await loadFamilyMembers();
      
      const { syncChildrenFromDB } = await import("@/lib/store");
      await syncChildrenFromDB();
    } catch (err) {
      setAddError("네트워크 에러가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleInviteParent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);

    if (!inviteEmail.trim()) { setAddError("이메일을 입력해주세요."); return; }

    setAddLoading(true);
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/invite-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 404) {
          setAddError("가입된 사용자가 아니에요");
        } else if (res.status === 403) {
          setAddError("보호자는 최대 2명까지예요");
        } else if (res.status === 409) {
          setAddError("이미 초대했거나 이미 구성원이에요");
        } else if (res.status === 400) {
          setAddError("본인은 초대할 수 없어요");
        } else {
          setAddError(data.error || "초대에 실패했습니다. 다시 시도해 주세요.");
        }
        return;
      }

      setShowAddParentForm(false);
      setInviteEmail("");
      alert("성공적으로 초대를 보냈습니다!");
      await loadFamilyMembers();
    } catch (err) {
      setAddError("네트워크 에러가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);
    setResetSuccess(false);

    if (newResetPassword.length < 6) {
      setResetError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setResetLoading(true);
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/members/${resettingMember.memberId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: newResetPassword })
      });

      const data = await res.json();
      if (!res.ok) {
        setResetError(data.error || "비밀번호 초기화에 실패했습니다.");
        return;
      }

      setResetSuccess(true);
      setNewResetPassword("");
      
      // 목록 갱신
      await loadFamilyMembers();

      setTimeout(() => {
        setResettingMember(null);
        setResetSuccess(false);
      }, 1500);
    } catch (err) {
      setResetError("네트워크 에러가 발생했습니다.");
    } finally {
      setResetLoading(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => {});
    clearStore();
    router.push("/login");
  };

  const TOGGLE_ITEMS = [
    { key: "reportAlert" as const,   label: "리포트 알림",   desc: "대화 후 리포트 도착 시",   on: reportAlert },
    { key: "weeklySummary" as const, label: "주간 요약",      desc: "매주 일요일 오전",         on: weeklySummary },
  ];

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
            {/* 우리 아이 관리 */}
            <div>
              <SectionHeader title="우리 아이" />
              <div className="bg-white rounded-2xl overflow-hidden mb-5" style={{ boxShadow: "var(--hb-shadow)" }}>
                {loadingMembers ? (
                  <p className="text-xs text-center py-6 text-gray-400">아이 정보를 불러오는 중...</p>
                ) : familyMembers.filter((m) => m.role === "child").length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <p className="text-3xl mb-1">🧒</p>
                    <p className="text-sm font-semibold text-gray-500">등록된 아이가 없어요</p>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                      아이 계정을 생성하여 케이와 대화를 시작해 보세요.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {familyMembers.filter((m) => m.role === "child").map((m) => (
                      <div
                        key={m.memberId}
                        className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                            style={{ background: "var(--hb-primary-light)" }}
                          >
                            🧒
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {m.displayName}
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1.5 bg-gray-100 text-gray-500">
                                {m.grade}
                              </span>
                            </p>
                            <p className="text-xs text-gray-400">아이디: {m.username}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => openEdit({
                              id: m.childId,
                              name: m.displayName,
                              grade: m.grade,
                              interests: m.interests
                            })}
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-gray-50 text-gray-600 active:scale-95 transition-all cursor-pointer hover:bg-gray-100"
                          >
                            수정
                          </button>
                          {isOwner && (
                            <button
                              onClick={() => {
                                setResettingMember(m);
                                setNewResetPassword("");
                                setResetError(null);
                                setResetSuccess(false);
                              }}
                              className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-red-50 text-red-600 active:scale-95 transition-all cursor-pointer hover:bg-red-100"
                            >
                              비밀번호 초기화
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {isOwner && (
                  <button
                    onClick={() => {
                      setAddError(null);
                      setAddName("");
                      setAddUsername("");
                      setAddPassword("");
                      setAddChildInterests([]);
                      setAddChildConsent(false);
                      setShowAddChildForm(true);
                    }}
                    className="flex items-center justify-center gap-2 px-4 py-3.5 w-full active:bg-gray-50 transition-colors border-t border-gray-100 text-sm font-semibold cursor-pointer"
                    style={{ color: "var(--hb-primary)" }}
                  >
                    <span className="text-lg">+</span>
                    아이 추가하기
                  </button>
                )}
              </div>
            </div>

            {/* 보호자 관리 */}
            <div>
              <SectionHeader title="보호자" />
              <div className="bg-white rounded-2xl overflow-hidden mb-5" style={{ boxShadow: "var(--hb-shadow)" }}>
                {loadingMembers ? (
                  <p className="text-xs text-center py-6 text-gray-400">보호자 정보를 불러오는 중...</p>
                ) : familyMembers.filter((m) => m.role !== "child").length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <p className="text-3xl mb-1">👩‍💼</p>
                    <p className="text-sm font-semibold text-gray-500">등록된 보호자가 없습니다</p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {familyMembers.filter((m) => m.role !== "child").map((m) => (
                      <div
                        key={m.memberId}
                        className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0"
                            style={{ background: "var(--hb-primary-light)" }}
                          >
                            👩‍💼
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-900">
                              {m.displayName}
                              {m.role === "owner_parent" ? (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1.5 bg-blue-100 text-blue-600">
                                  오너
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full ml-1.5 bg-purple-100 text-purple-600">
                                  배우자
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-400">아이디: {m.username}</p>
                          </div>
                        </div>
                        {!m.isMe && isOwner && (
                          <button
                            onClick={() => {
                              setResettingMember(m);
                              setNewResetPassword("");
                              setResetError(null);
                              setResetSuccess(false);
                            }}
                            className="text-xs font-semibold px-2.5 py-1.5 rounded-xl bg-red-50 text-red-600 active:scale-95 transition-all cursor-pointer hover:bg-red-100"
                          >
                            비밀번호 초기화
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isOwner && (
                  <>
                    <button
                      onClick={() => {
                        setAddError(null);
                        setInviteEmail("");
                        setShowAddParentForm(true);
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-3.5 w-full active:bg-gray-50 transition-colors border-t border-gray-100 text-sm font-semibold cursor-pointer"
                      style={{ color: "var(--hb-primary)" }}
                    >
                      <span className="text-lg">+</span>
                      보호자 초대하기
                    </button>
                    <p className="text-[11px] text-gray-400 text-center py-2 bg-gray-50/50 border-t border-gray-100">
                      배우자가 직접 신청할 수도, 여기서 이메일로 초대할 수도 있어요
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* 가족 구성원 승인 관리 */}
            {isOwner && (
              <div>
                <SectionHeader title="가족 구성원 승인 대기" />
                <div className="bg-white rounded-2xl overflow-hidden p-4 flex flex-col gap-3 mb-5" style={{ boxShadow: "var(--hb-shadow)" }}>
                  <p className="text-[11px] text-gray-400 leading-relaxed border-b border-gray-100 pb-2">
                    배우자가 가족 참여 신청을 보낸 경우 아래에 나타납니다. 승인하면 우리 가족으로 즉시 합류합니다.
                  </p>
                  {loadingRequests ? (
                    <p className="text-xs text-center py-4 text-gray-400">신청 정보를 불러오는 중...</p>
                  ) : joinRequests.length === 0 ? (
                    <p className="text-xs text-center py-4 text-gray-400">대기 중인 신청이 없어요</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {joinRequests.map((req) => (
                        <div key={req.id} className="flex items-center justify-between border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{req.requester_email}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              신청일시: {new Date(req.created_at).toLocaleString("ko-KR")}
                            </p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => handleApproveRequest(req.id)}
                              className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-bold active:scale-95 transition-transform hover:bg-blue-100"
                            >
                              승인
                            </button>
                            <button
                              onClick={() => handleRejectRequest(req.id)}
                              className="px-3 py-1.5 bg-gray-50 text-gray-500 rounded-xl text-xs font-bold active:scale-95 transition-transform hover:bg-gray-100"
                            >
                              거절
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

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

      {/* ── 우리 아이 추가 바텀 시트 ─────────────────────────────────────── */}
      {showAddChildForm && (
        <>
          {/* 오버레이 */}
          <div
            className="fixed inset-0 z-[110] bg-black/40"
            onClick={() => setShowAddChildForm(false)}
          />

          {/* 시트 */}
          <div
            className="fixed bottom-0 left-0 right-0 z-[120] bg-white rounded-t-3xl px-5 pt-5 pb-10 md:max-w-[420px] md:mx-auto md:left-1/2 md:-translate-x-1/2 max-h-[85vh] overflow-y-auto"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.12)" }}
          >
            {/* 시트 핸들 */}
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">아이 계정 추가 🧒</h2>
              <button onClick={() => setShowAddChildForm(false)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>

            <form onSubmit={handleAddChild} className="flex flex-col gap-4">
              {/* 이름 */}
              <div>
                <label className="block text-xs font-bold mb-1.5 text-gray-700">이름</label>
                <input
                  type="text"
                  required
                  placeholder="이름 입력 (예: 서준)"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  maxLength={10}
                  className="w-full px-4 py-3 rounded-2xl bg-gray-50 text-sm outline-none border-2 border-transparent transition-colors"
                  onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
                  onBlur={(e) => (e.target.style.borderColor = "transparent")}
                />
              </div>

              {/* 아이디 */}
              <div>
                <label className="block text-xs font-bold mb-1.5 text-gray-700">아이디</label>
                <input
                  type="text"
                  required
                  placeholder="영문·숫자·한글 2~20자"
                  value={addUsername}
                  onChange={(e) => setAddUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-gray-50 text-sm outline-none border-2 border-transparent transition-colors"
                  onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
                  onBlur={(e) => (e.target.style.borderColor = "transparent")}
                />
              </div>

              {/* 비밀번호 */}
              <div>
                <label className="block text-xs font-bold mb-1.5 text-gray-700">임시 비밀번호</label>
                <input
                  type="text"
                  required
                  placeholder="6자 이상의 비밀번호"
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
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
                      onClick={() => setAddChildGrade(g)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer"
                      style={
                        addChildGrade === g
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
                      onClick={() => toggleAddInterest(item)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer"
                      style={
                        addChildInterests.includes(item)
                          ? { background: "var(--hb-primary)", color: "#fff" }
                          : { background: "#F3F4F6", color: "#374151" }
                      }
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              {/* 법정대리인 동의 */}
              <div className="flex items-start gap-3 bg-gray-50 p-4 rounded-2xl border border-gray-100">
                <input
                  type="checkbox"
                  id="addChildConsent"
                  checked={addChildConsent}
                  onChange={(e) => setAddChildConsent(e.target.checked)}
                  className="w-4 h-4 accent-[var(--hb-primary)] rounded cursor-pointer mt-0.5"
                />
                <label htmlFor="addChildConsent" className="text-[11px] text-gray-600 leading-relaxed cursor-pointer select-none">
                  <span className="font-bold text-gray-800">[필수] 법정대리인 동의</span>
                  <br />본인은 자녀의 법정대리인으로서 자녀의 오디오 서비스 가입 및 개인정보 수집에 동의합니다.
                </label>
              </div>

              {addError && (
                <p className="text-xs text-red-500 bg-red-50 px-3 py-2.5 rounded-xl font-medium text-center">
                  {addError}
                </p>
              )}

              <button
                type="submit"
                disabled={addLoading}
                className="w-full py-3.5 rounded-2xl font-bold text-white transition-opacity disabled:opacity-40 mt-2 cursor-pointer"
                style={{ background: "var(--hb-primary)" }}
              >
                {addLoading ? "추가하는 중..." : "아이 계정 추가 완료"}
              </button>
            </form>
          </div>
        </>
      )}

      {/* ── 보호자 추가 바텀 시트 (이메일 초대) ─────────────────────────────── */}
      {showAddParentForm && (
        <>
          {/* 오버레이 */}
          <div
            className="fixed inset-0 z-[110] bg-black/40"
            onClick={() => setShowAddParentForm(false)}
          />

          {/* 시트 */}
          <div
            className="fixed bottom-0 left-0 right-0 z-[120] bg-white rounded-t-3xl px-5 pt-5 pb-10 md:max-w-[420px] md:mx-auto md:left-1/2 md:-translate-x-1/2 max-h-[85vh] overflow-y-auto"
            style={{ boxShadow: "0 -4px 32px rgba(0,0,0,0.12)" }}
          >
            {/* 시트 핸들 */}
            <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-gray-900">보호자 초대하기 👩‍💼</h2>
              <button onClick={() => setShowAddParentForm(false)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>

            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              이미 가입된 배우자(보호자)의 이메일 주소를 입력해 초대장을 보내세요. 배우자가 초대를 수락하면 즉시 가족으로 합류합니다.
            </p>

            <form onSubmit={handleInviteParent} className="flex flex-col gap-4">
              {/* 이메일 */}
              <div>
                <label className="block text-xs font-bold mb-1.5 text-gray-700">이메일 주소</label>
                <input
                  type="email"
                  required
                  placeholder="초대할 보호자의 이메일 (예: partner@example.com)"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-gray-50 text-sm outline-none border-2 border-transparent transition-colors"
                  onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
                  onBlur={(e) => (e.target.style.borderColor = "transparent")}
                />
              </div>

              {addError && (
                <p className="text-xs text-red-500 bg-red-50 px-3 py-2.5 rounded-xl font-medium text-center">
                  {addError}
                </p>
              )}

              <button
                type="submit"
                disabled={addLoading}
                className="w-full py-3.5 rounded-2xl font-bold text-white transition-opacity disabled:opacity-40 mt-2 cursor-pointer"
                style={{ background: "var(--hb-primary)" }}
              >
                {addLoading ? "초대장 보내는 중..." : "초대장 보내기 →"}
              </button>
            </form>
          </div>
        </>
      )}

      {/* ── 비밀번호 초기화 바텀 시트 ─────────────────────────────────── */}
      {resettingMember && (
        <>
          {/* 오버레이 */}
          <div
            className="fixed inset-0 z-[110] bg-black/40"
            onClick={() => setResettingMember(null)}
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
                {resettingMember.displayName} 비밀번호 초기화
              </h2>
              <button onClick={() => setResettingMember(null)} className="text-gray-400 text-xl leading-none">✕</button>
            </div>

            {resetSuccess ? (
              <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 text-center text-emerald-800">
                <p className="text-3xl mb-2">🎉</p>
                <p className="text-sm font-bold">비밀번호가 성공적으로 초기화되었습니다!</p>
                <p className="text-xs text-emerald-600 mt-1">이 구성원은 다음 로그인 시 다시 비밀번호 설정 질문을 받습니다.</p>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold mb-1.5 text-gray-700">새 임시 비밀번호</label>
                  <input
                    type="text"
                    required
                    placeholder="6자 이상의 새 비밀번호"
                    value={newResetPassword}
                    onChange={(e) => setNewResetPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-gray-50 text-sm outline-none border-2 border-transparent transition-colors"
                    onFocus={(e) => (e.target.style.borderColor = "var(--hb-primary)")}
                    onBlur={(e) => (e.target.style.borderColor = "transparent")}
                  />
                </div>

                {resetError && (
                  <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-xl text-center font-medium">
                    {resetError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={resetLoading || newResetPassword.length < 6}
                  className="w-full py-3.5 rounded-2xl font-bold text-white transition-opacity disabled:opacity-40 cursor-pointer"
                  style={{ background: "var(--hb-primary)" }}
                >
                  {resetLoading ? "초기화하는 중..." : "임시 비밀번호로 초기화 완료"}
                </button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  );
}
