import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// matcher가 "/parent/:path*" 로 좁혀져 있어 이 미들웨어는 그 경로에서만 실행된다.
// 예전엔 거의 모든 경로(정적 파일 제외 전체)에서 매번 supabase.auth.getUser()로
// 네트워크 재검증을 했는데, 실제로 이 결과를 써서 리다이렉트하는 곳은 /parent/*
// 뿐이었다(자녀 페이지·API 라우트는 각자 자체적으로 auth.getUser()를 호출해 401
// 처리함). 즉 다른 경로에서의 검증은 전부 낭비였음 — matcher를 좁혀도 보호 범위는
// 동일하고, 불필요한 왕복만 사라진다.
export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options ?? {})
          );
        },
      },
    }
  );

  // 세션 토큰 갱신 (IMPORTANT: getUser()가 내부적으로 refresh 처리)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // /parent/* 미인증 접근 → /login 으로 리디렉션
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/parent/:path*"],
};
