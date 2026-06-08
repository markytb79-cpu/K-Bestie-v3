// 서준이 기준 더미 데이터 — 실제 DB 연동 전 모든 화면에서 공유

// 알림 뱃지 숫자 단일 소스 (읽지 않은 알림 수)
export const DEMO_NOTIFICATION_BADGE = 2;

export const DEMO_CHILD = {
  id: "demo-child-seojun",
  name: "서준",
  grade: "4학년",
  avatar: "🧒",
  moodScore: 7,
  moodSummary:
    "친구와 사소한 다툼이 있었지만 잘 풀어낸 하루였어요. 체육 시간을 가장 좋아했어요.",
  chatCount: 2,
  lastChatMinutes: 35,
  emotionTags: ["즐거움", "약간의 짜증", "뿌듯함", "호기심"],
  bestMoment:
    "체육 시간 피구에서 마지막까지 살아남아 친구들에게 박수를 받았어요.",
  metrics: [
    { label: "감정 변화", value: "7점", icon: "💜", active: true },
    { label: "교우 관계", value: "대기 중", icon: "👥", active: false },
    { label: "학교 스트레스", value: "대기 중", icon: "📚", active: false },
    { label: "에너지", value: "대기 중", icon: "⚡", active: false },
  ],
};

export const DEMO_CHILD2 = {
  id: "demo-child-jiyu",
  name: "지유",
  grade: "3학년",
  avatar: "👧",
};

export const DEMO_MISSIONS = [
  {
    id: 1,
    title: "케이와 하교 후 인사하기",
    desc: "마이크를 눌러 학교 얘기를 들려줘",
    completed: true,
    emoji: "👋",
  },
  {
    id: 2,
    title: "물 한 컵 마시고 5분 스트레칭",
    desc: "몸을 가볍게 풀어보자",
    completed: true,
    emoji: "💧",
  },
  {
    id: 3,
    title: "오늘 고마웠던 사람 떠올리기",
    desc: "마음 속으로만 생각해도 돼",
    completed: false,
    emoji: "💛",
  },
  {
    id: 4,
    title: "잠들기 전 케이와 1분 대화",
    desc: "짧아도 괜찮아, 오늘 하루 어땠는지 말해봐",
    completed: false,
    emoji: "🌙",
  },
  {
    id: 5,
    title: "오늘 기분 별점 남기기",
    desc: "오늘 기분을 별점으로 표현해봐",
    completed: false,
    emoji: "⭐",
  },
];

export const DEMO_NOTIFICATIONS = [
  {
    id: 1,
    level: "safe" as const,
    dotColor: "#22C55E",
    title: "오늘 리포트가 도착했어요",
    body: "서준이의 오늘 감정 점수: 7/10. 친구 관계에서 긍정적인 변화가 보여요.",
    time: "35분 전",
  },
  {
    id: 2,
    level: "warning" as const,
    dotColor: "#F59E0B",
    title: "친구 관계 신호 감지",
    body: "오늘 대화에서 친구와의 갈등이 언급됐어요. 자연스럽게 물어봐 주세요.",
    time: "1시간 전",
  },
  {
    id: 3,
    level: "danger" as const,
    dotColor: "#EF4444",
    title: "주의가 필요한 신호예요",
    body: "'아무것도 하기 싫다'는 표현이 반복됐어요. 따뜻한 관심이 필요한 시점이에요.",
    time: "어제",
    hasExpertCTA: true,
  },
];

export const DEMO_PARENT_QUESTIONS = [
  {
    id: 1,
    text: "오늘 학교에서 제일 재밌었던 게 뭐야?",
    status: "전달됨" as const,
    count: 2,
    time: "1시간 전",
  },
  {
    id: 2,
    text: "오늘 힘든 일 있었어?",
    status: "대기 중" as const,
    count: 0,
    time: null,
  },
  {
    id: 3,
    text: "친구랑 사이좋게 지냈어?",
    status: "중지됨" as const,
    count: 1,
    time: "어제",
  },
];

export const DEMO_EXPERTS = [
  {
    id: 1,
    name: "자살예방상담전화",
    number: "1393",
    badge: "긴급",
    badgeColor: "#EF4444",
    badgeBg: "#FEF2F2",
    emoji: "🚨",
    hours: "24시간",
  },
  {
    id: 2,
    name: "정신건강위기상담전화",
    number: "1577-0199",
    badge: "긴급",
    badgeColor: "#EF4444",
    badgeBg: "#FEF2F2",
    emoji: "🏥",
    hours: "24시간",
  },
  {
    id: 3,
    name: "아동학대 신고",
    number: "112",
    badge: "긴급",
    badgeColor: "#EF4444",
    badgeBg: "#FEF2F2",
    emoji: "🚔",
    hours: "24시간",
  },
  {
    id: 4,
    name: "청소년상담 1388",
    number: "1388",
    badge: "주의",
    badgeColor: "#D97706",
    badgeBg: "#FFFBEB",
    emoji: "🧑‍🎓",
    hours: "24시간",
  },
  {
    id: 5,
    name: "Wee센터",
    number: null,
    badge: "일반",
    badgeColor: "#6B7280",
    badgeBg: "#F9FAFB",
    emoji: "🏫",
    hours: "평일 09:00–18:00",
    url: "https://wee.go.kr",
  },
  {
    id: 6,
    name: "한국아동보호전문기관",
    number: "1577-1391",
    badge: "일반",
    badgeColor: "#6B7280",
    badgeBg: "#F9FAFB",
    emoji: "🧒",
    hours: null,
    url: "https://korea1391.go.kr",
  },
  {
    id: 7,
    name: "한국청소년상담복지개발원",
    number: "051-662-3174",
    badge: "일반",
    badgeColor: "#6B7280",
    badgeBg: "#F9FAFB",
    emoji: "🏛️",
    hours: null,
    url: "https://kyci.or.kr",
  },
];

export const DEMO_GUIDE = {
  todayMessage:
    "오늘 체육 시간 어떤 게 제일 신났는지 슬쩍 물어봐 주세요. 아이가 자랑스러워하는 순간을 함께 나눌 수 있어요.",
  tip: "아이의 대답에 즉각 반응하지 말고 3초 여유를 두고 듣는 것이 효과적이에요.",
};
