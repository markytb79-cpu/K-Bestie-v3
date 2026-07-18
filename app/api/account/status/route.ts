import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: parent, error } = await supabase
      .from("parents")
      .select("account_status, withdrawn_at, purge_scheduled_at, restore_requested_at")
      .eq("id", user.id)
      .single();

    if (error || !parent) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(parent);
  } catch (err: any) {
    console.error("[Account Status Error]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
