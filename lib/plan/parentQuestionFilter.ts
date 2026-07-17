// 부모가 등록하는 "아이에게 물어봐줄 질문"이 아동 안전상 부적절한 목적(진단/비밀탐지/추궁/행동평가)인지
// 규칙(정규식) 기반으로 1차 판정한다. 오탐으로 정상적인 질문까지 막지 않도록,
// 신호가 명확한 카테고리(진단/비밀탐지/추궁)만 차단하고, 애매할 수 있는 행동평가는
// 완화 제안(suggest)에 그친다. LLM 판정은 이번 범위에서는 붙이지 않는다(키워드 우선).

export type QuestionFilterCategory =
  | "diagnosis"
  | "secret_probe"
  | "interrogation"
  | "behavior_eval";

export type QuestionFilterVerdict = "allow" | "block" | "suggest";

export interface QuestionFilterResult {
  verdict: QuestionFilterVerdict;
  category?: QuestionFilterCategory;
  reason?: string;
  suggestion?: string;
}

interface CategoryRule {
  category: QuestionFilterCategory;
  verdict: "block" | "suggest";
  pattern: RegExp;
  reason: string;
  suggestion: string;
}

const RULES: CategoryRule[] = [
  {
    category: "diagnosis",
    verdict: "block",
    // 임상 진단명/증상 라벨 — 케이는 의료 진단 도구가 아니므로 항상 차단.
    pattern: /(우울증|조울증|양극성|불안장애|공황장애|강박증|틱\s*장애|자폐(\s*스펙트럼)?|ADHD|에이디에이치디|과잉\s*행동|학습\s*장애|정신\s*질환|정신병|병이?\s*있는지|장애가?\s*있는지)/i,
    reason: "아이의 정신건강 상태를 진단·평가하려는 질문은 등록할 수 없어요. 케이는 진단 도구가 아니에요.",
    suggestion: "걱정되는 부분이 있다면 \"요즘 기분이 어때?\" 처럼 아이가 편하게 말할 수 있는 열린 질문으로 바꿔보는 건 어떨까요?",
  },
  {
    category: "secret_probe",
    verdict: "block",
    // 아이가 숨기는 것/일기/몰래 하는 일을 캐내려는 의도.
    pattern: /(몰래\s*(뭐|무엇|무슨)|숨기는\s*(거|게|것)|일기장?에?\s*(뭐|무슨).{0,10}(썼|적)|비밀.{0,10}(있|캐|확인)|캐물어|알아내|훔쳐보|감시)/,
    reason: "아이가 숨기는 것을 몰래 캐내려는 목적의 질문은 등록할 수 없어요. 아이와의 신뢰 관계를 해칠 수 있어요.",
    suggestion: "궁금한 게 있다면 아이에게 직접 다정하게 물어보시는 게 가장 좋아요. 케이에게는 관심사나 하루 일과처럼 편한 주제를 부탁해보세요.",
  },
  {
    category: "interrogation",
    verdict: "block",
    // 사실 여부를 추궁/취조하려는 의도.
    pattern: /(거짓말(했는지|인지|한거)|추궁|정말로?\s*그랬는지|사실대로\s*(말했는지|불게|캐))/,
    reason: "사실 여부를 추궁하는 질문은 등록할 수 없어요. 케이는 취조 도구가 아니에요.",
    suggestion: "확인하고 싶은 일이 있다면 아이와 직접 편하게 대화해보시는 걸 권해요.",
  },
  {
    category: "behavior_eval",
    verdict: "suggest",
    // 아이 행동을 점수 매기거나 감시하듯 평가하려는 의도 — 오탐 가능성이 있어 완화 제안만.
    pattern: /(몇\s*점(인지|짜리)|점수\s*매겨|평가해\s*줘|잘\s*들었는지\s*(확인|평가)|착하게\s*굴었는지|말\s*잘\s*들었는지\s*감시)/,
    reason: "아이의 행동을 점수 매기듯 평가하는 질문은 아이에게 부담이 될 수 있어요.",
    suggestion: "\"오늘 뭐 하고 놀았어?\" 처럼 결과를 평가하지 않는 질문으로 바꿔보는 건 어떨까요?",
  },
];

export function filterParentQuestion(text: string): QuestionFilterResult {
  const normalized = text.replace(/\s+/g, " ").trim();
  for (const rule of RULES) {
    if (rule.pattern.test(normalized)) {
      return {
        verdict: rule.verdict,
        category: rule.category,
        reason: rule.reason,
        suggestion: rule.suggestion,
      };
    }
  }
  return { verdict: "allow" };
}
