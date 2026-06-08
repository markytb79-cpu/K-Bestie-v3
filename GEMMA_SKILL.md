---
name: gemma4-integration
description: Google AI Studio Gemini API를 통해 Gemma 4 모델(gemma-4-31b-it, gemma-4-26b-a4b-it)을 안전하고 효율적으로 호출하는 스킬. 무료 티어 RPM/RPD 제약 하에서 Thinking 모드, 멀티모달 이미지 입력, 256K 컨텍스트, 함수 호출을 활용해야 할 때 사용. 두 모델 모두 Thinking ON으로 운영하며 품질 요구에 따라 31B(premium)와 26B-A4B(standard)를 분배. API 키 클라이언트 노출 방지를 위해 Edge Function 프록시 패턴을 강제. 429 시 지수 백오프와 jitter, 503 시 모델 전환 폴백 로직 포함.
---
````markdown
---
name: gemma4-integration
description: "Google AI Studio Gemini API를 통해 Gemma 4 모델(gemma-4-31b-it, gemma-4-26b-a4b-it)을 안전하고 효율적으로 호출하는 스킬. 무료 티어 RPM/RPD 제약 하에서 멀티모달 이미지 입력, 256K 컨텍스트, 함수 호출을 활용해야 할 때 사용. Thinking OFF로 운영하며 품질 요구에 따라 31B(premium)와 26B-A4B(standard)를 분배. API 키 클라이언트 노출 방지를 위해 Edge Function 프록시 패턴을 강제. 429 시 지수 백오프와 jitter, 503 시 모델 전환 폴백 로직 포함. JSON 응답이 필요하면 프롬프트 스키마 강제 + extractJSON 파싱을 사용하고, responseMimeType은 절대 사용하지 않는다. 병렬 호출 시 반드시 Promise.allSettled를 사용한다. 이 파일이 500줄을 초과하면 .claude/skills/gemma4-integration/references/ 하위로 상세 코드를 분리하라."
---

# Gemma 4 Gemini API 통합 스킬

## 1. 사용 대상 모델 (Gemini API 한정)

Google AI Studio Gemini API에서 호출 가능한 Gemma 4 모델은 **두 개뿐**이다.

| 모델 ID | 아키텍처 | 활성 파라미터 | 컨텍스트 | 역할 |
|---|---|---|---|---|
| `gemma-4-31b-it` | Dense 30.7B | 30.7B | 256K | Premium (최고 품질 추론) |
| `gemma-4-26b-a4b-it` | MoE 25.2B | 3.8B (활성) | 256K | Standard (빠른 추론) |

E2B/E4B는 온디바이스 전용으로 Gemini API에서 호출 불가하다. 다른 모델(gemma-3, gemini-flash 등)은 사용하지 않는다.

## 2. SDK 선택 — 반드시 @google/genai 사용

```bash
npm install @google/genai
````

```typescript
// ✅ 올바른 import
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ❌ 절대 금지
// import { GoogleGenerativeAI } from "@google/generative-ai";  // 구버전 deprecated
// fetch("https://generativelanguage.googleapis.com/...")        // REST 직접 호출
```

REST 직접 호출은 `systemInstruction` 무시, 빈 응답, 예측 불가 동작이 보고되었다. 반드시 공식 SDK를 사용하라.

## 3. contents 파라미터 형식

`@google/genai` SDK는 `contents` 파라미터에 다양한 타입을 허용한다.

```typescript
// ✅ 텍스트 전용 — 문자열 직접 전달 (가장 간결)
contents: "분석해줘"

// ✅ 텍스트 전용 — 배열 형식 (명시적)
contents: [{ role: "user", parts: [{ text: "분석해줘" }] }]

// ✅ 멀티모달 (이미지 + 텍스트) — 배열 형식 필수
contents: [{
  role: "user",
  parts: [
    { inlineData: { mimeType: "image/jpeg", data: base64 } },
    { text: "이 이미지를 분석해줘" }
  ]
}]
```

**규칙:**

- 텍스트 전용: 문자열 직접 전달 허용
- 멀티모달 (이미지 포함): 배열 형식 필수, 이미지를 텍스트 앞에 배치
- FunctionCall/FunctionResponse: 반드시 Content[] 형식으로 role 명시

## 4. API 키 보안 (필수)

### ❌ 절대 금지

```bash
VITE_GEMINI_API_KEY=AIza...       # 빌드 시 클라이언트 번들에 노출
NEXT_PUBLIC_GEMINI_KEY=AIza...    # 동일하게 노출
```

`VITE_` 또는 `NEXT_PUBLIC_` 접두사 환경변수는 브라우저 번들에 평문 포함된다.

### ✅ 권장: Edge Function 프록시 패턴

```typescript
// supabase/functions/gemma-proxy/index.ts
import { GoogleGenAI } from "npm:@google/genai";

Deno.serve(async (req) => {
  const apiKey = Deno.env.get("GEMINI_API_KEY"); // 서버에만 존재
  const ai = new GoogleGenAI({ apiKey });

  const { model, contents, config } = await req.json();
  const result = await ai.models.generateContent({ model, contents, config });

  return Response.json(result);
});
```

프론트엔드는 Edge Function URL만 호출하고, API 키는 서버에만 보관한다.

## 5. 무료 티어 Rate Limit

|모델|RPM|RPD|TPM|
|---|---|---|---|
|`gemma-4-31b-it`|15|1,500|무제한 (사용자 계정 기준)|
|`gemma-4-26b-a4b-it`|15|1,500|무제한 (사용자 계정 기준)|

- 두 모델 quota는 **독립** → 합산 시 최대 30 RPM / 3,000 RPD 활용 가능
- 공식 문서는 “Specified rate limits are not guaranteed” 명시 — 본인 계정 한도는 `https://aistudio.google.com/rate-limit`에서 직접 확인
- RPD는 Pacific Time 자정 기준 리셋
- 무료 티어 입력 데이터는 Google 모델 학습에 사용됨 (섹션 12 참조)

## 6. 429 백오프 정책

429 응답 시 **동일 모델에 지수 백오프 + jitter**로 재시도한다. 모델 전환은 503에서만 수행한다.

```typescript
class ModelUnavailableError extends Error {}

async function callWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err.status === 429) {
        const retryDelay = parseRetryDelay(err) ?? Math.pow(2, attempt) * 1000;
        const jitter = Math.random() * 1000;
        const wait = retryDelay + 5000 + jitter; // 안전 마진 5초
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (err.status === 503) {
        throw new ModelUnavailableError(); // 상위에서 다른 모델로 전환
      }
      throw err;
    }
  }
  throw new Error("Max retry attempts exceeded");
}

function parseRetryDelay(err: any): number | null {
  const detail = err?.error?.details?.find((d: any) =>
    d["@type"]?.includes("RetryInfo")
  );
  if (!detail?.retryDelay) return null;
  return parseInt(detail.retryDelay.replace("s", "")) * 1000;
}
```

## 7. 모델 선택 전략 — Thinking OFF

**두 모델 모두 Thinking OFF**로 운영한다. 품질 요구 수준으로 분배한다.

|모델|Thinking|용도|응답 속도|
|---|---|---|---|
|`gemma-4-31b-it`|**OFF**|최고 품질 추론, 복잡한 다단계 분석, 긴 문서 심층 해석, 코드 리뷰, 전략 의사결정|느림|
|`gemma-4-26b-a4b-it`|**OFF**|빠른 추론이 필요한 대부분의 작업, 함수 호출, 중간 복잡도 분석, 챗봇 응답|빠름 (활성 3.8B)|

### 라우팅 휴리스틱

- 최고 품질이 필수 → `gemma-4-31b-it` (premium)
- 추론은 필요하지만 빨라야 함 → `gemma-4-26b-a4b-it` (standard, **대부분의 케이스**)
- 두 모델 quota 독립을 활용하여 라운드로빈 또는 작업 특성별 분배

```typescript
const MODELS = ["gemma-4-26b-a4b-it", "gemma-4-31b-it"] as const;
type GemmaModel = typeof MODELS[number];

function selectModel(quality: "premium" | "standard"): GemmaModel {
  return quality === "premium" ? "gemma-4-31b-it" : "gemma-4-26b-a4b-it";
}
```

## 8. 클라이언트 측 Throttling

RPM 15 한도에 대응하는 안전 마진 throttle을 모델별로 운영한다.

```typescript
class RateLimiter {
  private queue: number[] = [];
  private readonly maxPerMinute = 14; // 15에서 안전 마진 1

  async acquire(): Promise<void> {
    const now = Date.now();
    this.queue = this.queue.filter((t) => now - t < 60_000);
    if (this.queue.length >= this.maxPerMinute) {
      const wait = 60_000 - (now - this.queue[0]) + 100;
      await new Promise((r) => setTimeout(r, wait));
      return this.acquire();
    }
    this.queue.push(now);
  }
}

// 모델별 인스턴스 (quota 독립이므로 각각 관리)
const limiters: Record<GemmaModel, RateLimiter> = {
  "gemma-4-31b-it": new RateLimiter(),
  "gemma-4-26b-a4b-it": new RateLimiter(),
};
```

## 9. JSON 응답 처리 (필수)

### ❌ 절대 금지

```typescript
// responseMimeType 사용 금지 — silent hang, 타임아웃 발생
config: {
  responseMimeType: "application/json"  // ❌ 사용하지 마라
}
```

### ✅ 프롬프트로 JSON 스키마 강제 + extractJSON 파싱

```typescript
// 프롬프트 끝에 JSON 강제 지시 추가
const prompt = `분석 내용...

[중요] 반드시 아래 JSON 형식으로만 응답하세요.
마크다운, 설명, 인사말 없이 순수 JSON 객체만 출력하세요.
응답의 첫 글자는 반드시 { 이어야 합니다.

출력 형식:
{
  "key1": "value1",
  "key2": ["item1", "item2"]
}`;

// 응답 파싱 함수
function extractJSON(text: string): any {
  // 1차: 코드 블록에서 추출
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch {}
  }

  // 2차: {} 패턴 추출
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }

  // 3차: [] 패턴 추출
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try { return JSON.parse(arrayMatch[0]); } catch {}
  }

  console.error("[extractJSON] 파싱 실패. 원문(500자):", text.substring(0, 500));
  throw new Error("No valid JSON in response");
}
```

**핵심 규칙:**

- 프롬프트에 반드시 구체적 JSON 스키마 예시를 포함하라
- "첫 글자는 반드시 {"를 명시하라
- 스키마의 키 이름을 정확히 지정하라 — 지정하지 않으면 Gemma가 매번 다른 키를 생성한다
- `responseMimeType: "application/json"`은 어떤 상황에서도 사용하지 마라

## 10. 병렬 처리 — Promise.allSettled 필수

여러 건을 동시에 처리할 때는 반드시 `Promise.allSettled`를 사용한다.

```typescript
// ✅ 안전 — 하나 실패해도 나머지 정상
const results = await Promise.allSettled(
  items.map(item => callGemma(buildPrompt(item), systemInstruction))
);

const parsed = results.map((r, i) =>
  r.status === "fulfilled"
    ? { success: true, data: extractJSON(r.value) }
    : { success: false, error: r.reason?.message, itemId: items[i].id }
);

const failed = parsed.filter(p => !p.success).length;
if (failed > 0) console.warn(`${failed}건 실패`);

// ❌ 위험 — 하나 실패하면 전체 실패
// const results = await Promise.all(...)
```

## 11. 멀티모달 이미지 입력

공식 모델 카드: “place image and/or audio content **before** the text in your prompt”.

```typescript
import { readFile } from "node:fs/promises";

async function fileToBase64(path: string): Promise<string> {
  const buf = await readFile(path);
  return buf.toString("base64");
}

const imageBase64 = await fileToBase64("./screenshot.jpg");

const result = await ai.models.generateContent({
  model: "gemma-4-26b-a4b-it",
  contents: [{
    role: "user",
    parts: [
      { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
      { text: "이 이미지를 분석해줘" },
    ],
  }],
  config: {
    systemInstruction: "당신은 정밀한 이미지 분석 전문가입니다.",
    temperature: 1.0,
    topP: 0.95,
    topK: 64,
  },
});
```

### 이미지 토큰 budget

지원 값: 70, 140, 280, 560, 1120

- OCR · 문서 파싱 · 작은 글자 읽기 → **1120** 권장
- 일반 이미지 이해 → **280~560**
- 분류 · 캡셔닝 → **70~280**

### 제약사항

- **오디오는 31B/26B-A4B 미지원** (E2B/E4B 전용)
- 영상은 프레임 시퀀스로 처리, 최대 60초 (1fps 기준)

## 12. 무료 티어 데이터 학습 사용 경고

> ⚠️ **무료 티어로 처리되는 모든 입력 데이터는 Google의 모델 학습에 사용될 수 있다.** 사내 코드, 고객 PII, 영업 정보는 반드시 Tier 1 이상 유료 플랜으로 전환 후 사용하라.

|티어|학습 데이터 사용|한도|
|---|---|---|
|Free|**사용함**|RPM 15 / RPD 1,500|
|Tier 1|사용 안 함|$250 billing cap|
|Tier 2|사용 안 함|$2,000 billing cap|
|Tier 3|사용 안 함|$20,000+|

## 13. 256K 컨텍스트 윈도우 활용

두 모델 모두 **256K 토큰** (입출력 합산) 지원. 장문 RAG, 긴 문서 분석, 멀티턴 대화에 활용 가능.

### 주의사항

- 입력이 길수록 첫 토큰 지연(TTFT) 증가
- 256K 가까운 입력은 Edge Function 150초 타임아웃 초과 위험 → 섹션 15의 스트리밍 패턴 사용

## 14. 공식 샘플링 파라미터

공식 모델 카드는 모든 use case에 대해 다음 표준값을 권장한다.

```typescript
config: {
  temperature: 1.0,
  topP: 0.95,
  topK: 64,
}
```

특수한 결정성이 필요한 경우(예: 코드 생성에서 temperature 0.2)에만 별도 조정하고, 기본값으로 위 표준을 사용한다.

## 15. Edge Function 타임아웃 대응

|플랜|초기 응답 한도|Background task|
|---|---|---|
|Supabase Free|150초|미지원|
|Supabase Pro|150초 (초기 응답)|최대 400초|

### 시간 계산 공식

```
총 최악 시간 = TIMEOUT_MS × RETRY_DELAYS 수 × MODELS 수

예시: 30초 × 3회 × 2모델 = 180초 → 150초 초과 ❌
수정: 30초 × 3회 × 1모델 + 30초 × 1회 × 1모델 = 120초 → OK ✅
```

병렬 처리 시:

```
총 시간 = (후보 수 ÷ 병렬 수) × 1건 최악 시간
예시: 6후보 ÷ 3병렬 = 2배치 × 30초 = 60초 → OK ✅
```

### 스트리밍으로 타임아웃 회피

긴 입력 조합은 150초 초과 위험이 있으므로 **스트리밍**으로 idle timeout을 리셋한다.

```typescript
// supabase/functions/gemma-stream/index.ts
import { GoogleGenAI } from "npm:@google/genai";

Deno.serve(async (req) => {
  const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY") });
  const { model, contents, config } = await req.json();

  const stream = await ai.models.generateContentStream({ model, contents, config });

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"));
      }
      controller.close();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
});
```

## 16. 환경변수 설정

```bash
# Supabase Edge Function (Secrets) — 서버 전용
npx supabase secrets set GEMINI_API_KEY="your_google_api_key" --project-ref YOUR_PROJECT_REF
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your_service_role_key" --project-ref YOUR_PROJECT_REF
```

프론트엔드에는 API 키를 두지 않는다. Edge Function 프록시를 경유한다 (섹션 4 참조).

## 17. 통합 호출 예시

```typescript
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function callGemma(
  prompt: string,
  quality: "premium" | "standard" = "standard",
  systemPersona: string = "당신은 정확하고 신중한 한국어 전문가입니다."
) {
  const primary = selectModel(quality);
  const fallback: GemmaModel =
    primary === "gemma-4-31b-it" ? "gemma-4-26b-a4b-it" : "gemma-4-31b-it";

  const callOnce = async (model: GemmaModel) => {
    await limiters[model].acquire();
    return await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: systemPersona,
        temperature: 1.0,
        topP: 0.95,
        topK: 64,
      },
    });
  };

  try {
    return await callWithBackoff(() => callOnce(primary));
  } catch (err) {
    if (err instanceof ModelUnavailableError) {
      console.warn(`${primary} 503 → ${fallback}로 폴백`);
      return await callWithBackoff(() => callOnce(fallback));
    }
    throw err;
  }
}
```

## 체크리스트

- [ ] `@google/genai` 사용, 구버전 SDK 및 REST 직접 호출 금지
- [ ] API 키는 서버 측 환경변수에만 보관, `VITE_`/`NEXT_PUBLIC_` 접두사 사용 금지
- [ ] Edge Function 프록시 경유 패턴 적용
- [ ] 작업 품질 요구에 따라 31B(premium) / 26B-A4B(standard) 분배
- [ ] 429 시 동일 모델 지수 백오프 + jitter, 503 시에만 모델 전환
- [ ] 모델별 RateLimiter 인스턴스로 RPM 14 이하 throttle
- [ ] **JSON 응답: responseMimeType 절대 금지, 프롬프트 스키마 강제 + extractJSON 파싱**
- [ ] **병렬 처리: Promise.allSettled만 사용, Promise.all 금지**
- [ ] 이미지는 텍스트 앞에 배치, 토큰 budget 작업별 조정
- [ ] 샘플링 파라미터: temperature 1.0 / topP 0.95 / topK 64
- [ ] 민감 데이터 처리 시 Tier 1 유료 플랜 사용
- [ ] 긴 응답은 스트리밍으로 Edge Function 150초 타임아웃 회피
- [ ] 총 최악 시간이 Edge Function 한도(150초) 이내인지 계산
- [ ] Supabase 테이블 생성 시 GRANT ALL ON public.테이블명 TO anon, authenticated 포함

## References

- Gemma 4 공식 모델 카드: [https://ai.google.dev/gemma/docs/core/model_card_4](https://ai.google.dev/gemma/docs/core/model_card_4)
- Gemma on Gemini API 가이드: [https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)
- Gemini API Rate Limits: [https://ai.google.dev/gemini-api/docs/rate-limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- 본인 계정 한도 확인: [https://aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit)
- API 키 발급: [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- `@google/genai` SDK: [https://www.npmjs.com/package/@google/genai](https://www.npmjs.com/package/@google/genai)
- `@google/genai` contents 파라미터 타입: [https://www.npmjs.com/package/@google/genai#how-to-structure-contents-argument-for-generatecontent](https://www.npmjs.com/package/@google/genai#how-to-structure-contents-argument-for-generatecontent)
- 429 처리 가이드 (Google Cloud Blog): [https://cloud.google.com/blog/products/ai-machine-learning/learn-how-to-handle-429-resource-exhaustion-errors-in-your-llms](https://cloud.google.com/blog/products/ai-machine-learning/learn-how-to-handle-429-resource-exhaustion-errors-in-your-llms)
- Supabase Edge Function Limits: [https://supabase.com/docs/guides/functions/limits](https://supabase.com/docs/guides/functions/limits)
