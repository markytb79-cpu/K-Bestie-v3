import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LIVE_VOICE_NAMES } from "@/lib/plan/liveVoices";
import { stampRetention, restoreRetention } from "@/lib/plan/retentionStamp";
import type { Tier } from "@/lib/plan/retention";

import { requireChildAccess } from "@/lib/auth/requireChildAccess";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authCheck = await requireChildAccess(supabase, user.id, id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { data, error } = await supabase
      .from("child_profiles")
      .select("id, name, grade, interests, tier, live_voice_name")
      .eq("id", id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "아이 정보를 찾을 수 없어요" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "서버 오류" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authCheck = await requireChildAccess(supabase, user.id, id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    name?: string;
    grade?: string;
    interests?: string[];
    liveVoiceName?: string;
    tier?: number;
    withdrawConsent?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  // 법정대리인 동의 철회 — RLS(child_profiles_update)가 이미 owner_parent/parent만 허용하므로
  // 여기서 별도 role 체크는 하지 않는다. 철회 시 guardian_consent를 false로 되돌리고
  // 철회 시각을 남긴다(재동의 시에는 children/members 등록 플로우를 다시 타야 하므로 별도 API 없음).
  if (body.withdrawConsent === true) {
    updateData.guardian_consent = false;
    updateData.guardian_consent_withdrawn_at = new Date().toISOString();
  }
  if (body.name?.trim()) updateData.name = body.name.trim();
  if (body.grade) updateData.grade = body.grade;
  if (Array.isArray(body.interests)) updateData.interests = body.interests;
  if (body.liveVoiceName) {
    if (!LIVE_VOICE_NAMES.includes(body.liveVoiceName)) {
      return NextResponse.json({ error: "지원하지 않는 목소리입니다" }, { status: 400 });
    }
    updateData.live_voice_name = body.liveVoiceName;
  }
  if (body.tier !== undefined) {
    if (![1, 2, 3].includes(body.tier)) {
      return NextResponse.json({ error: "지원하지 않는 요금제입니다" }, { status: 400 });
    }
    updateData.tier = body.tier;
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "수정할 항목 없음" }, { status: 400 });
  }

  // 소유권 확인은 전용 SELECT로 선수행(TOCTOU 안전) — 아래 update()의 rowcount/에러 유무로
  // 소유권을 추론하지 않는다. .update().eq('id', id)는 소유 아닌 id에도 에러 없이 0 rows로
  // 조용히 성공하므로, 반드시 이 SELECT 결과(행 존재 여부)만으로 판정한다.
  const { data: existing, error: fetchErr } = await supabase
    .from("child_profiles")
    .select("id, tier")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "아이 정보를 찾을 수 없어요" }, { status: 403 });
  }

  try {
    const { error } = await supabase
      .from("child_profiles")
      .update(updateData)
      .eq("id", id);

    if (error) throw error;

    // tier 변경 시 유효 보존기간 재계산 스탬프/복구 — 소유권은 위에서 이미 확인 완료.
    // activePackCount는 결제 시스템이 없어 항상 0(향후 확장팩 결제 연동 시 실제 값으로 교체).
    if (body.tier !== undefined && body.tier !== (existing.tier as Tier)) {
      const oldTier = existing.tier as Tier;
      const newTier = body.tier as Tier;
      if (newTier < oldTier) {
        await stampRetention(id, newTier, 0);
      } else if (newTier > oldTier) {
        await restoreRetention(id, newTier, 0);
      }
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "업데이트 실패" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const authCheck = await requireChildAccess(supabase, user.id, id);
  if (!authCheck.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { error } = await supabase
      .from("child_profiles")
      .delete()
      .eq("id", id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}
