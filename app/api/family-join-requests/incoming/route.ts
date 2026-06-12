import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/family-join-requests/incoming
 *
 * 초대받은 사용자(배우자)가 자신 앞으로 온 owner_invite pending 목록 조회.
 *
 * Response: { invites: [{ id, family_id, family_name, invited_by_email, status, created_at }] }
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();

  const { data, error } = await svc
    .from("family_join_requests")
    .select(`
      id,
      family_id,
      requester_user_id,
      requester_email,
      status,
      created_at,
      families(name)
    `)
    .eq("target_user_id", user.id)
    .eq("direction", "owner_invite")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const invites = (data ?? []).map((row) => ({
    id: row.id,
    family_id: row.family_id,
    family_name: (row.families as unknown as { name: string } | null)?.name ?? "",
    invited_by_email: row.requester_email,
    status: row.status,
    created_at: row.created_at,
  }));

  return NextResponse.json({ invites });
}
