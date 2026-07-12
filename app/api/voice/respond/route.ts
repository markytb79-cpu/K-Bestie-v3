import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { pickReaction } from "@/lib/freeChatReactions";

export const runtime = "nodejs";

// 자유대화는 LLM을 호출하지 않는다 — 앱 자체 규칙 기반 리액션 엔진(lib/freeChatReactions.ts)만 사용.
// 문장 풀/키워드 편집은 그 파일에서만 한다(이 파일은 로직 변경 불필요).
//
// (과거 이력: gemini-flash-lite-latest + FREE_CHAT_SYSTEM_PROMPT로 LLM 호출하던 구조였으나
//  반영적 경청 규칙 기반 엔진으로 전면 교체. 되돌릴 경우 git history의 이 파일 이전 버전 참고.)

interface HistoryTurn { role: "child" | "k"; text: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { history?: HistoryTurn[]; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history : [];
  if (history.length === 0) {
    return NextResponse.json({ error: "history required" }, { status: 400 });
  }

  const lastChild = [...history].reverse().find((t) => t.role === "child" && t.text?.trim());
  if (!lastChild) {
    return NextResponse.json({ error: "no child utterance in history" }, { status: 400 });
  }
  const lastK = [...history].reverse().find((t) => t.role === "k" && t.text?.trim());

  const reaction = pickReaction(lastChild.text.trim(), lastK?.text?.trim());

  if (reaction.flaggedForParent) {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    if (sessionId) {
      const service = createServiceClient();
      const { error: insertError } = await service.from("safety_events").insert({
        session_id: sessionId,
        subcategory: reaction.safetySubcategory,
        child_text: lastChild.text.trim(),
      });
      if (insertError) {
        console.error("[voice/respond] safety_events insert failed:", insertError.message);
      }
    } else {
      console.warn("[voice/respond] SAFETY FLAG without sessionId — not persisted. user:", user.id);
    }
  }

  return NextResponse.json({
    text: reaction.text,
    category: reaction.category,
    flaggedForParent: reaction.flaggedForParent,
  });
}
