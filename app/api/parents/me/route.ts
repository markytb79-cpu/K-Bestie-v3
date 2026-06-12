import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/parents/me
 * 로그인한 소셜 보호자의 프로필(parents 행) 반환.
 * Response: { parent: { id, email, name } }
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: parent, error } = await svc
    .from("parents")
    .select("id, email, name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!parent) return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });

  return NextResponse.json({ parent });
}

/**
 * PATCH /api/parents/me
 * 로그인한 보호자의 닉네임(parents.name) 수정.
 * Body: { name: string }
 * 검증: 비어있지 않음, 공백만 아님, 최대 30자
 * Response: { parent: { id, name } }
 */
export async function PATCH(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let name: string;
  try {
    ({ name } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name은 비워둘 수 없습니다." }, { status: 400 });
  }
  const trimmed = name.trim();
  if (trimmed.length > 30) {
    return NextResponse.json({ error: "닉네임은 30자를 초과할 수 없습니다." }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data: updated, error } = await svc
    .from("parents")
    .update({ name: trimmed })
    .eq("id", user.id)
    .select("id, name")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ parent: updated });
}
