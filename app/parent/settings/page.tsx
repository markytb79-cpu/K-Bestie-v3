"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useStore } from "@/hooks/useStore";
import { createClient } from "@/lib/supabase/client";
import { DemoFrame } from "@/app/demo/components/DemoFrame";
import { RealParentNav } from "@/components/RealParentNav";
import { SkeletonBox } from "@/components/Skeleton";
import {
  setNotifSetting,
  clearStore,
  updateChild,
  removeChild,
  type StoreChild,
} from "@/lib/store";

const GRADES = ["1학년", "2학년", "3학년", "4학년", "5학년", "6학년"];
const INTERESTS = ["공룡", "우주", "동물", "그림", "음악", "스포츠", "요리", "게임", "과학", "책"];
// plans 테이블(tier 1/2/3) 기준 사용자용 이름 — 내부 tier 숫자는 화면에 노출하지 않는다.
// TODO: 정식 오픈 시 결제 연동으로 전환 필요 — 자세한 건 FUTURE_TODO.md 참고.
const CARE_PLANS: { tier: number; label: string }[] = [
  { tier: 1, label: "케어 스타트" },
  { tier: 2, label: "케어 인사이트" },
  { tier: 3, label: "케어 프리미엄" },
];

interface Question {
  id: string;
  question_text: string;
  status: "대기중" | "전달됨" | "중지됨";
  delivered_count: number;
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

  // 구성원 추가 폼 상태
  const [inviteEmail, setInviteEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
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

  // 수정 상태
  const [editChild, setEditChild] = useState<StoreChild | null>(null);
  const [editName, setEditName] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editInterests, setEditInterests] = useState<string[]>([]);
  const [editTier, setEditTier] = useState<number>(1);
  const [savingTier, setSavingTier] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 가입 신청 목록 및 로딩 상태
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [sentInvites, setSentInvites] = useState<any[]>([]);
  const [loadingSentInvites, setLoadingSentInvites] = useState(true);

  // 닉네임 수정 상태
  const [nicknameInput, setNicknameInput] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [nicknameSuccess, setNicknameSuccess] = useState(false);

  // 아코디언 토글 상태 (기본은 닫힘)
  const [activeMenu, setActiveMenu] = useState<"add_child" | "edit_child" | "family_members" | null>(null);

  // 로그인 이메일 및 구성원 정보 로드
  useEffect(() => {
    setMounted(true);
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.email) setUserEmail(data.user.email);
    }).catch(() => {});

    fetch("/api/parents/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.parent?.name) {
          setNicknameInput(data.parent.name);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const id = localStorage.getItem("k_child_id");
    if (!id) return;

    fetch(`/api/parent/questions?childId=${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((qData) => setQuestions(qData?.questions ?? []))
      .catch(() => {});
  }, []);

  const loadFamilyMembers = async () => {
    if (!store.activeFamilyId) {
      setLoadingMembers(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const famRes = await fetch(`/api/families/${store.activeFamilyId}`);
      if (!famRes.ok) throw new Error("가족 정보 조회 실패");
      const { family } = await famRes.json();

      const myMember = family.family_members.find((m: any) => m.user_id === user.id);
      const owner = myMember?.role === "owner_parent";
      setIsOwner(owner);

      const { data: accounts, error: accErr } = await supabase
        .from("member_accounts")
        .select("id, username, display_name, role, must_change_password")
        .eq("family_id", store.activeFamilyId);

      if (accErr) throw accErr;

      const merged = family.family_members.map((m: any) => {
        const acc = accounts?.find((a: any) => a.id === m.user_id);
        const childProf = m.role === "child"
          ? family.child_profiles?.find((c: any) => c.member_id === m.id)
          : null;
        
        let dispName = "";
        if (m.role === "child") {
          dispName = childProf?.name || "";
        } else {
          dispName = acc ? (acc.display_name || "") : (m.parent_name || "");
        }

        return {
          memberId: m.id,
          userId: m.user_id,
          role: m.role,
          username: acc?.username || "",
          displayName: dispName || "구성원",
          mustChangePassword: acc?.must_change_password ?? false,
          isMe: m.user_id === user.id,
          childId: childProf?.id || "",
          grade: childProf?.grade || "",
          interests: childProf?.interests || [],
          tier: childProf?.tier ?? 1,
          parentEmail: m.parent_email || ""
        };
      });

      setFamilyMembers(merged);
    } catch (err) {
      console.error(err);
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
    } catch {} finally {
      setLoadingRequests(false);
    }
  };

  const loadSentInvites = async () => {
    if (!store.activeFamilyId || !isOwner) {
      setLoadingSentInvites(false);
      return;
    }
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/sent-invites?status=pending`);
      if (res.ok) {
        const data = await res.json();
        setSentInvites(data.invites ?? []);
      }
    } catch {} finally {
      setLoadingSentInvites(false);
    }
  };

  useEffect(() => {
    loadFamilyMembers();
  }, [store.activeFamilyId]);

  useEffect(() => {
    if (store.activeFamilyId && isOwner) {
      loadJoinRequests();
      loadSentInvites();
    } else {
      setLoadingRequests(false);
      setLoadingSentInvites(false);
    }
  }, [store.activeFamilyId, isOwner]);

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
        setAddError(data.error || "아이 추가에 실패했습니다.");
        return;
      }

      setAddName("");
      setAddUsername("");
      setAddPassword("");
      setAddChildInterests([]);
      setAddChildConsent(false);
      setActiveMenu(null);
      await loadFamilyMembers();
      
      const { syncChildrenFromDB } = await import("@/lib/store");
      await syncChildrenFromDB();
    } catch {
      setAddError("네트워크 에러가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleInviteParent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError(null);
    if (!inviteEmail.trim()) return;

    setAddLoading(true);
    try {
      const res = await fetch(`/api/families/${store.activeFamilyId}/invite-member`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || "초대에 실패했습니다.");
        return;
      }

      setInviteEmail("");
      alert("초대장을 전송했습니다!");
      await loadFamilyMembers();
      await loadSentInvites();
    } catch {
      setAddError("네트워크 에러가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleSaveNickname = async () => {
    if (!nicknameInput.trim() || nicknameInput.length > 30) return;
    setSavingNickname(true);
    setNicknameError(null);
    setNicknameSuccess(false);

    try {
      const res = await fetch("/api/parents/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nicknameInput.trim() }),
      });

      if (res.ok) {
        setNicknameSuccess(true);
        await loadFamilyMembers();
      } else {
        const data = await res.json().catch(() => null);
        setNicknameError(data?.error || "닉네임 변경에 실패했습니다.");
      }
    } catch {
      setNicknameError("네트워크 에러가 발생했습니다.");
    } finally {
      setSavingNickname(false);
    }
  };

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut().catch(() => {});
    clearStore();
    router.push("/login");
  };

  const toggleInterest = (item: string, isEdit: boolean) => {
    if (isEdit) {
      setEditInterests((prev) =>
        prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
      );
    } else {
      setAddChildInterests((prev) =>
        prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
      );
    }
  };

  if (!mounted) {
    return (
      <DemoFrame>
        <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
          <div className="shrink-0 flex items-center justify-center px-4 py-4" style={{ background: "#fafaf8" }}>
            <SkeletonBox className="w-20 h-6" />
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBox key={i} className="h-16" />
            ))}
            <SkeletonBox className="h-12 mt-3" />
          </div>
        </div>
      </DemoFrame>
    );
  }

  const menuToggle = (menu: "add_child" | "edit_child" | "family_members") => {
    setActiveMenu((prev) => (prev === menu ? null : menu));
    setAddError(null);
  };

  return (
    <DemoFrame>
      <div className="h-full flex flex-col overflow-hidden" style={{ background: "#f3f4f6" }}>
        {/* 헤더 */}
        <div
          className="shrink-0 flex items-center justify-center px-4 py-4"
          style={{ background: "#fafaf8" }}
        >
          <Link href="/parent/home" className="cursor-pointer">
            <Image
              src="/Images/logo/Logo.png"
              alt="내친구 케이"
              width={84}
              height={24}
              className="object-contain"
              priority
            />
          </Link>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {/* 1. 아이 추가 메뉴 카드 */}
          <div
            onClick={() => menuToggle("add_child")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                ➕
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>아이 추가</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>새로운 아이 계정을 추가해요</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "add_child" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "add_child" && (
              <div className="pt-3 border-t border-gray-100" onClick={(e) => e.stopPropagation()}>
                {isOwner ? (
                  <form onSubmit={handleAddChild} className="flex flex-col gap-3">
                    <input
                      type="text"
                      placeholder="아이 이름"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                      className="px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                    />
                    <input
                      type="text"
                      placeholder="아이디 (로그인용)"
                      value={addUsername}
                      onChange={(e) => setAddUsername(e.target.value)}
                      className="px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                    />
                    <input
                      type="password"
                      placeholder="비밀번호 (6자 이상)"
                      value={addPassword}
                      onChange={(e) => setAddPassword(e.target.value)}
                      className="px-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none bg-gray-50/50"
                    />
                    <div>
                      <p className="text-[10px] font-bold text-gray-500 mb-1 px-1">학년 선택</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {GRADES.map((g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => setAddChildGrade(g)}
                            className={`py-1.5 text-[10px] font-bold rounded-xl border ${
                              addChildGrade === g ? "bg-[#1a6b5a] text-white border-transparent" : "bg-white border-gray-200 text-gray-600"
                            }`}
                          >
                            {g}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold text-gray-500 mb-1 px-1">아이 관심사 선택</p>
                      <div className="flex flex-wrap gap-1.5">
                        {INTERESTS.map((interest) => {
                          const has = addChildInterests.includes(interest);
                          return (
                            <button
                              key={interest}
                              type="button"
                              onClick={() => toggleInterest(interest, false)}
                              className={`px-3 py-1 text-[10px] font-bold rounded-full border ${
                                has ? "bg-[#e8845a] text-white border-transparent" : "bg-white border-gray-200 text-gray-600"
                              }`}
                            >
                              {interest}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <label className="flex items-center gap-2 px-1 mt-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addChildConsent}
                        onChange={(e) => setAddChildConsent(e.target.checked)}
                        className="w-4 h-4 rounded text-[#1a6b5a]"
                      />
                      <span className="text-[10px] font-bold text-gray-500">법정대리인 개인정보 동의함</span>
                    </label>

                    {addError && <p className="text-xs text-red-500 px-1">{addError}</p>}
                    <button
                      type="submit"
                      disabled={addLoading}
                      className="w-full py-2.5 rounded-xl text-white text-xs font-bold active:scale-95 transition-transform"
                      style={{ background: "#1a6b5a" }}
                    >
                      {addLoading ? "아이 추가 중..." : "자녀 등록 완료"}
                    </button>
                  </form>
                ) : (
                  <p className="text-[10px] text-gray-400 text-center py-2">가족 오너 권한이 있는 보호자만 아이를 등록할 수 있습니다.</p>
                )}
              </div>
            )}
          </div>

          {/* 2. 아이 프로필 정보 등록 메뉴 카드 (자녀 프로필 수정 전용) */}
          <div
            onClick={() => menuToggle("edit_child")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                📝
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>아이 프로필 정보 등록</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>이름, 학년, 관심사, 요금제를 관리해요</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "edit_child" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "edit_child" && (
              <div className="pt-3 border-t border-gray-100 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                {/* 자녀 정보 수정 폼 */}
                {familyMembers.filter(m => m.role === "child").length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-3">등록된 자녀가 없습니다.</p>
                ) : (
                  <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                    <p className="text-[10px] font-bold text-gray-500">자녀 프로필 수정</p>
                    <div className="flex flex-col gap-2">
                      {familyMembers.filter(m => m.role === "child").map((m) => (
                        <div key={m.memberId} className="bg-white border border-gray-100 rounded-xl p-2.5 flex flex-col gap-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-gray-800">🧒 {m.displayName} ({m.grade})</span>
                            <button
                              onClick={() => {
                                setEditChild({
                                  id: m.childId,
                                  name: m.displayName,
                                  grade: m.grade,
                                  interests: m.interests
                                });
                                setEditName(m.displayName);
                                setEditGrade(m.grade);
                                setEditInterests(m.interests ?? []);
                                setEditTier(m.tier ?? 1);
                              }}
                              className="text-[10px] bg-[#f3f4f6] text-gray-600 font-bold px-2.5 py-1 rounded-lg cursor-pointer"
                            >
                              수정하기
                            </button>
                          </div>

                          {editChild && editChild.id === m.childId && (
                            <div className="mt-2 flex flex-col gap-3 pt-2.5 border-t border-dashed border-gray-100">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="px-3 py-1.5 text-xs border border-gray-200 rounded-xl bg-gray-50/50 outline-none"
                              />
                              <div>
                                <p className="text-[9px] text-gray-400 mb-1">학년</p>
                                <div className="grid grid-cols-3 gap-1">
                                  {GRADES.map((g) => (
                                    <button
                                      key={g}
                                      onClick={() => setEditGrade(g)}
                                      className={`py-1 text-[9px] font-bold border rounded-lg ${
                                        editGrade === g ? "bg-[#1a6b5a] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                                      }`}
                                    >
                                      {g}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div>
                                <p className="text-[9px] text-gray-400 mb-1">관심사</p>
                                <div className="flex flex-wrap gap-1">
                                  {INTERESTS.map((interest) => {
                                    const has = editInterests.includes(interest);
                                    return (
                                      <button
                                        key={interest}
                                        onClick={() => toggleInterest(interest, true)}
                                        className={`px-2.5 py-0.5 text-[9px] font-bold border rounded-full ${
                                          has ? "bg-[#e8845a] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                                        }`}
                                      >
                                        {interest}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>

                              <div>
                                <p className="text-[9px] text-gray-400 mb-1">요금제</p>
                                <div className="grid grid-cols-3 gap-1">
                                  {CARE_PLANS.map((p) => (
                                    <button
                                      key={p.tier}
                                      onClick={() => setEditTier(p.tier)}
                                      className={`py-1 text-[9px] font-bold border rounded-lg ${
                                        editTier === p.tier ? "bg-[#1a6b5a] text-white border-transparent" : "bg-white border-gray-200 text-gray-500"
                                      }`}
                                    >
                                      {p.label}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="flex gap-2 mt-1">
                                <button
                                  onClick={async () => {
                                    if (!editName.trim()) return;
                                    updateChild(editChild.id, {
                                      name: editName.trim(),
                                      grade: editGrade,
                                      interests: editInterests,
                                    });
                                    if (editTier !== (m.tier ?? 1)) {
                                      setSavingTier(true);
                                      try {
                                        await fetch(`/api/child/${editChild.id}`, {
                                          method: "PATCH",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ tier: editTier }),
                                        });
                                      } catch {} finally {
                                        setSavingTier(false);
                                      }
                                    }
                                    setEditChild(null);
                                    loadFamilyMembers();
                                  }}
                                  disabled={savingTier}
                                  className="flex-1 py-1.5 bg-[#1a6b5a] text-white text-[10px] font-bold rounded-lg cursor-pointer disabled:opacity-50"
                                >
                                  {savingTier ? "저장중" : "저장"}
                                </button>
                                <button
                                  onClick={() => setEditChild(null)}
                                  className="flex-1 py-1.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg cursor-pointer"
                                >
                                  취소
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 3. 가족 구성원 관리 메뉴 카드 (보호자 이름/알림/가족 구성원 목록) */}
          <div
            onClick={() => menuToggle("family_members")}
            className="bg-white rounded-2xl px-4 py-4 shadow-sm flex flex-col gap-3 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: "#f3f4f6" }}>
                👨‍👩‍👧
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold" style={{ color: "#1e1e2d" }}>가족 구성원 관리</p>
                <p className="text-[11px]" style={{ color: "#6b7280" }}>내 이름, 알림, 보호자 구성원을 관리해요</p>
              </div>
              <span className="text-sm" style={{ color: "#6b7280", transform: activeMenu === "family_members" ? "rotate(90deg)" : "none", transition: "transform 0.2s" }}>→</span>
            </div>

            {activeMenu === "family_members" && (
              <div className="pt-3 border-t border-gray-100 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
                {/* 닉네임 설정 */}
                <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                  <p className="text-[10px] font-bold text-gray-500">내 보호자 이름 수정</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={nicknameInput}
                      onChange={(e) => setNicknameInput(e.target.value)}
                      placeholder="예) 서아엄마"
                      className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-xl outline-none bg-white"
                    />
                    <button
                      onClick={handleSaveNickname}
                      disabled={savingNickname || !nicknameInput.trim()}
                      className="px-4 py-1.5 bg-[#1a6b5a] text-white text-xs font-bold rounded-xl disabled:opacity-50 cursor-pointer active:scale-95 transition-transform"
                    >
                      {savingNickname ? "저장중" : "변경"}
                    </button>
                  </div>
                  {nicknameSuccess && <p className="text-[10px] text-green-600 px-1">닉네임이 성공적으로 변경되었습니다.</p>}
                  {nicknameError && <p className="text-[10px] text-red-500 px-1">{nicknameError}</p>}
                </div>

                {/* 알림 설정 */}
                <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                  <p className="text-[10px] font-bold text-gray-500">알림 환경 설정</p>
                  <div className="flex flex-col gap-2.5">
                    <label className="flex items-center justify-between text-xs cursor-pointer">
                      <div>
                        <p className="font-bold text-gray-800">일일 리포트 도착 알림</p>
                        <p className="text-[10px] text-gray-400">자녀가 케이와 대화 후 일일 요약 분석 알림</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={reportAlert}
                        onChange={(e) => setNotifSetting("reportAlert", e.target.checked)}
                        className="w-4 h-4 rounded text-[#1a6b5a]"
                      />
                    </label>
                    <label className="flex items-center justify-between text-xs cursor-pointer">
                      <div>
                        <p className="font-bold text-gray-800">주간 종합 요약 알림</p>
                        <p className="text-[10px] text-gray-400">매주 일요일 자녀의 주간 종합 분석 알림</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={weeklySummary}
                        onChange={(e) => setNotifSetting("weeklySummary", e.target.checked)}
                        className="w-4 h-4 rounded text-[#1a6b5a]"
                      />
                    </label>
                  </div>
                </div>

                {/* 가족 구성원 보호자 리스트 */}
                <div className="flex flex-col gap-2 p-3 bg-gray-50/50 rounded-xl border border-gray-150">
                  <p className="text-[10px] font-bold text-gray-500">가족 구성원 보호자</p>
                  <div className="flex flex-col gap-1.5">
                    {familyMembers.filter(m => m.role !== "child").map((m) => (
                      <div key={m.memberId} className="flex justify-between items-center bg-white border border-gray-100 rounded-xl p-2.5">
                        <div>
                          <p className="text-xs font-bold text-gray-800">{m.displayName} ({m.role === "owner_parent" ? "오너" : "배우자"})</p>
                          <p className="text-[9px] text-gray-400">{m.parentEmail || m.username}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {isOwner && familyMembers.filter(m => m.role !== "child").length < 2 && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-[9px] text-gray-400 mb-1.5">보호자(배우자) 이메일 초대</p>
                      <form onSubmit={handleInviteParent} className="flex gap-2">
                        <input
                          type="email"
                          placeholder="spouse@example.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          className="flex-1 px-3 py-1.5 text-xs border border-gray-200 rounded-xl outline-none bg-white"
                        />
                        <button
                          type="submit"
                          className="px-4 py-1.5 bg-[#1a6b5a] text-white text-xs font-bold rounded-xl active:scale-95 transition-transform"
                        >
                          초대
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 로그아웃 */}
          <button
            onClick={handleLogout}
            className="w-full py-3.5 rounded-2xl bg-white border border-red-100 text-red-500 text-xs font-bold active:scale-[0.98] transition-transform cursor-pointer shadow-sm mt-3 shrink-0"
          >
            로그아웃
          </button>
        </div>

        <RealParentNav active="설정" />
      </div>
    </DemoFrame>
  );
}
