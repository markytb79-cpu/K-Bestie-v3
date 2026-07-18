import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

const EVENT_LIMIT = 200;

// GET /api/admin/safety-events?childId=xxx — chat_sessions을 거쳐 아이의 safety_events를 조회.
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const childId = req.nextUrl.searchParams.get("childId");
  if (!childId) {
    return NextResponse.json({ error: "childId required" }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: sessions, error: sessionsError } = await service
    .from("chat_sessions")
    .select("id")
    .eq("child_id", childId);

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const sessionIds = (sessions ?? []).map((s) => s.id);
  let events: unknown[] = [];

  if (sessionIds.length > 0) {
    const { data: fetchedEvents, error } = await service
      .from("safety_events")
      .select("id, session_id, subcategory, child_text, created_at, viewed_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: false })
      .limit(EVENT_LIMIT);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    events = fetchedEvents ?? [];
  }

  // 감사 로그 기록 (성공 여부에 관계없이 조회 결과는 반환)
  try {
    const client = await createClient();
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError) {
      console.error("[safety-events API] Failed to get user for audit log:", userError);
    } else if (user) {
      const { error: insertError } = await service.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: user.email || "",
        action: "view_safety_events",
        child_id: childId,
      });
      if (insertError) {
        console.error("[safety-events API] Failed to insert audit log:", insertError);
      }
    }
  } catch (auditError) {
    console.error("[safety-events API] Audit log recording failed:", auditError);
  }

  return NextResponse.json({ events });
}

