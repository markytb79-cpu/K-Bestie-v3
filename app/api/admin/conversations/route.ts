import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const runtime = "nodejs";

const SESSION_LIMIT = 20;

// GET /api/admin/conversations?childId=xxx — 아이가 나눈 대화를 세션별 타임라인으로 반환.
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
    .select("id, started_at, ended_at, session_type, turn_count")
    .eq("child_id", childId)
    .order("started_at", { ascending: false })
    .limit(SESSION_LIMIT);

  if (sessionsError) {
    return NextResponse.json({ error: sessionsError.message }, { status: 500 });
  }

  const sessionIds = (sessions ?? []).map((s) => s.id);
  const messagesBySession: Record<string, unknown[]> = {};

  if (sessionIds.length > 0) {
    const { data: messages, error: messagesError } = await service
      .from("chat_messages")
      .select("session_id, role, content, mode, voice_mode, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json({ error: messagesError.message }, { status: 500 });
    }

    for (const m of messages ?? []) {
      (messagesBySession[m.session_id] ??= []).push(m);
    }
  }

  const result = (sessions ?? []).map((s) => ({
    ...s,
    messages: messagesBySession[s.id] ?? [],
  }));

  // 감사 로그 기록 (성공 여부에 관계없이 대화 조회 결과는 반환)
  try {
    const client = await createClient();
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError) {
      console.error("[conversations API] Failed to get user for audit log:", userError);
    } else if (user) {
      const { error: insertError } = await service.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: user.email || "",
        action: "view_conversations",
        child_id: childId,
      });
      if (insertError) {
        console.error("[conversations API] Failed to insert audit log:", insertError);
      }
    }
  } catch (auditError) {
    console.error("[conversations API] Audit log recording failed:", auditError);
  }

  return NextResponse.json({ sessions: result });
}

