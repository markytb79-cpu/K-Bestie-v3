import { NextResponse } from "next/server";
import { cookies, headers as nextHeaders } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(request: Request) {
  const { searchParams, origin: rawOrigin } = new URL(request.url);
  const headersList = await nextHeaders();

  // 포트포워딩·리버스프록시 환경에서 실제 외부 도메인 복원
  // 직접 접속 시에는 0.0.0.0만 localhost로 치환
  const forwardedHost = headersList.get("x-forwarded-host");
  const forwardedProto = headersList.get("x-forwarded-proto") ?? "https";
  let origin: string;
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0].trim();
    const proto = forwardedProto.split(",")[0].trim();
    origin = `${proto}://${host}`;
  } else {
    origin = rawOrigin.replace("//0.0.0.0", "//localhost");
  }

  console.log("[auth/callback] rawOrigin      :", rawOrigin);
  console.log("[auth/callback] x-forwarded-host :", forwardedHost);
  console.log("[auth/callback] x-forwarded-proto:", forwardedProto);
  console.log("[auth/callback] resolved origin  :", origin);

  const code = searchParams.get("code");
  const returnUrl = searchParams.get("returnUrl") || "/";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options: any }[]) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {
              // Server Component setAll ignore
            }
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${returnUrl}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
