"Supabase와 Vercel 양쪽에 환경변수/시크릿을 등록하는 작업을 네가 직접 CLI로 해줘. 손으로 넣으면 JSON 키 줄바꿈 때문에 자꾸 깨지니 반드시 CLI로 처리해라. 순서는 이렇게 해라.

먼저 supabase CLI와 vercel CLI가 이 머신에 설치돼 있고 로그인/프로젝트 연결(supabase link, vercel link)이 돼 있는지 확인해라. 안 돼 있으면 어떤 명령을 내가 직접 쳐야 하는지(로그인 등 사람이 해야 하는 것만) 알려주고 거기서 멈춰라.

둘 다 준비돼 있으면, 아래 값들을 .env.local에서 그대로 읽어와서 CLI로 등록해라. 값은 .env.local에 있는 것과 100% 동일해야 한다.

Supabase Edge Function 시크릿 (supabase secrets set --env-file 방식 권장):

GOOGLE_CLOUD_PROJECT=k-bestie3
GOOGLE_CLOUD_LOCATION=global
GCP_VERTEX_SA_KEY_JSON (한 줄 JSON, .env.local 값 그대로)
GEMMA_API_KEY (.env.local 값 그대로)
BATCH_SECRET (.env.local 값 그대로)
Vercel 환경변수 (vercel env add, Production/Preview/Development 세 환경 모두):

GCP_VERTEX_SA_KEY_JSON
GOOGLE_CLOUD_PROJECT=k-bestie3
GOOGLE_CLOUD_LOCATION=global
등록 중 만든 임시 파일(supabase/.env.secrets 등)은 .gitignore에 반드시 포함시키고, 작업 후 정리해라.

등록이 끝나면 각 플랫폼에 실제로 어떤 변수가 등록됐는지 목록으로 확인(supabase secrets list, vercel env ls)해서 보고해라. 값 자체는 마스킹해라.

배포(deploy)는 하지 마라. 등록만 해라."