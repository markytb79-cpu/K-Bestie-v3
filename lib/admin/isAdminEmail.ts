// 관리자 화이트리스트 판정 — middleware.ts(Edge 런타임)와 app/api/admin/**/route.ts가 공유하는
// 순수 함수. Node 전용 의존성(createClient 등)을 여기 두면 middleware.ts가 그걸 그대로 번들에
// 끌어들여 Edge Runtime 경고/위험이 생기므로, Node 전용 로직은 requireAdmin.ts로 분리했다.
// ADMIN_EMAILS는 콤마 구분 환경변수. 공백/대소문자 오탐을 막기 위해 항상 trim().toLowerCase()로 정규화한다.
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const whitelist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return whitelist.includes(email.trim().toLowerCase());
}
