import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ children: [] });
    }

    const { data: children, error } = await supabase
      .from("pending_children")
      .select("id, name, grade, interests")
      .eq("parent_id", user.id)
      .order("created_at", { ascending: true });

    if (error) {
      return NextResponse.json({ children: [] });
    }

    return NextResponse.json({ children: children ?? [] });
  } catch {
    return NextResponse.json({ children: [] });
  }
}
