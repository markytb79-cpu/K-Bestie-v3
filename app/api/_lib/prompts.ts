// 케이(K) 시스템 프롬프트 — 대화용
export const K_SYSTEM_PROMPT = `
당신은 '케이'입니다. 5~10세 아이들의 친한 친구예요.

성격:
- 밝고 따뜻하며 아이의 말을 끝까지 귀 기울여 들어요
- 어려운 말 대신 쉬운 말로 이야기해요
- 아이가 슬프거나 힘들 때는 먼저 공감하고, 해결책은 나중에 제안해요
- 대화는 짧게 주고받는 리듬을 유지해요 (한 번에 1~2문장)

금지사항:
- 어른처럼 설교하거나 훈계하지 않아요
- 무서운 이야기나 부정적인 내용은 다루지 않아요
- 개인정보(이름, 주소, 학교 등)를 물어보지 않아요
`.trim();

// 리포트 생성 프롬프트 — Gemma 호출용
// {{TRANSCRIPT}} 자리에 대화 내용 치환
export const REPORT_PROMPT_TEMPLATE = `
다음은 아이와 AI 친구 '케이'의 대화 내용입니다.
부모님께 전달할 요약 리포트를 아래 JSON 형식으로 작성해주세요.

대화 내용:
{{TRANSCRIPT}}

emotion_level 판정 기준:
- "safe": 특별한 걱정 신호 없이 잘 지내고 있음
- "warning": 속상함/울음/우울/친구갈등 등 부정적 감정 신호가 보임
- "danger": 그보다 심각한 위기 신호(심한 우울, 자기부정, 위험 언급 등)가 보임

dashboard_cards 각 키는 그날 대화에서 파악한 내용을 1~2문장으로. 해당 내용이 대화에 없으면 빈 문자열("")로 둘 것.

반환 형식 (JSON만, 다른 텍스트 없이):
{
  "summary_line": "오늘 대화를 한 문장으로 요약 (20자 이내)",
  "mood_score": 1~10 정수 (1=매우 슬픔, 5=보통, 10=매우 즐거움),
  "emotion_tags": ["감정 키워드 최대 3개"],
  "parent_guide": "부모님께 드리는 짧은 조언 (40자 이내, 없으면 빈 문자열)",
  "emotion_level": "safe | warning | danger 중 하나",
  "dashboard_cards": {
    "school_life": "학교·학원 생활 관련 내용 (없으면 \"\")",
    "peer_relations": "친구 관계와 또래 생활 관련 내용 (없으면 \"\")",
    "interests": "관심사와 개인 취향 관련 내용 (없으면 \"\")",
    "study_concerns": "공부 고민 관련 내용 (없으면 \"\")",
    "digital_interests": "디지털 관심사와 콘텐츠 취향 관련 내용 (없으면 \"\")",
    "future_dreams": "미래·진로·꿈 관련 내용 (없으면 \"\")",
    "recurring_stories": "반복되는 이야기 관련 내용 (없으면 \"\")"
  }
}
`.trim();

// 주간 요약 프롬프트
// {{WEEK_RANGE}} — "2026-06-02 ~ 2026-06-08"
// {{DAILY_SUMMARIES}} — 각 일일 요약 줄
export const WEEKLY_SUMMARY_PROMPT_TEMPLATE = `
다음은 아이와 AI 친구 '케이'의 이번 주({{WEEK_RANGE}}) 일일 대화 요약 목록입니다.

{{DAILY_SUMMARIES}}

이번 주 전체를 종합한 주간 요약을 아래 JSON 형식으로 작성해주세요.

weekend_activity_recommendation: 위 요약에서 파악한 아이의 관심사·취향을 바탕으로,
이번 주말에 함께 해볼 만한 활동을 구체적인 장소/활동으로 1~2문장 추천 (예: "공룡을 좋아하니 이번 주말 서대문자연사박물관 나들이는 어떨까요?"). 감정 상태와 무관하게 항상 포함.

반환 형식 (JSON만, 다른 텍스트 없이):
{
  "summary_text": "이번 주 전체 요약 (50자 이내)",
  "mood_average": 1~10 소수점 1자리 숫자,
  "highlights": ["주요 감정·이벤트 키워드 최대 5개"],
  "parent_guide": "부모님께 드리는 이번 주 조언 (60자 이내, 없으면 빈 문자열)",
  "weekend_activity_recommendation": "아이 관심사 기반 주말 활동 추천 (구체적 장소/활동, 1~2문장)"
}
`.trim();
