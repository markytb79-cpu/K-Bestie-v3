import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const userEmail = user.email?.trim().toLowerCase();

  if (!userEmail) {
    return NextResponse.json({ invite: null });
  }

  // target_user_id가 현재 유저 ID이거나, requester_email이 현재 유저 이메일인 pending owner_invite를 모두 가져옴
  const { data: requests, error: reqError } = await svc
    .from("family_join_requests")
    .select("*")
    .eq("direction", "owner_invite")
    .eq("status", "pending")
    .or(`target_user_id.eq.${user.id},requester_email.ilike.${userEmail}`)
    .order("created_at", { ascending: false });

  if (reqError) {
    return NextResponse.json({ error: reqError.message }, { status: 500 });
  }

  // target_user_id = user.id 이거나, (target_user_id is null 이고 email이 일치)인 첫 번째(가장 최근) 항목 필터링
  const invite = requests?.find(
    (r) =>
      r.target_user_id === user.id ||
      (r.target_user_id === null &&
        r.requester_email?.trim().toLowerCase() === userEmail)
  );

  if (!invite) {
    return NextResponse.json({ invite: null });
  }

  // familyName 조회
  const { data: family } = await svc
    .from("families")
    .select("name")
    .eq("id", invite.family_id)
    .maybeSingle();

  // inviterName 조회
  const { data: inviter } = await svc
    .from("parents")
    .select("name")
    .eq("id", invite.requester_user_id)
    .maybeSingle();

  // currentFamily 조회
  let currentFamily = null;
  const { data: member } = await svc
    .from("family_members")
    .select("family_id, families(id, name)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (member && member.family_id) {
    const familyId = member.family_id;
    const familyName = (member.families as any)?.name ?? "";

    // hasChildren
    const { count: childCount } = await svc
      .from("child_profiles")
      .select("*", { count: "exact", head: true })
      .eq("family_id", familyId);

    // otherGuardianCount
    const { count: guardianCount } = await svc
      .from("family_members")
      .select("*", { count: "exact", head: true })
      .eq("family_id", familyId)
      .neq("user_id", user.id);

    currentFamily = {
      id: familyId,
      name: familyName,
      hasChildren: (childCount ?? 0) > 0,
      otherGuardianCount: guardianCount ?? 0,
    };
  }

  return NextResponse.json({
    invite: {
      id: invite.id,
      familyName: family?.name ?? "알 수 없는 가족",
      inviterName: inviter?.name ?? "알 수 없는 보호자",
      createdAt: invite.created_at,
    },
    currentFamily,
  });
}
