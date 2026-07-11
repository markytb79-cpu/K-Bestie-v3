const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('.env.local', 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)$/);
  if (m) {
    env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  // 테스트용 자녀 ID (child_profiles 테이블의 첫 번째 자녀)
  const { data: children } = await supabase.from('child_profiles').select('id, name, grade').limit(1);
  if (!children || children.length === 0) {
    console.error("No child profiles found");
    return;
  }
  const child = children[0];
  console.log(`Testing with child: ${child.name} (id: ${child.id}, grade: ${child.grade})`);

  // 학년 파싱
  const m = String(child.grade).match(/\d+/);
  const grade = m ? parseInt(m[0], 10) : 4;
  const roundType = "round1_day";

  // 1. 후보 질문 로드
  const { data: candidatesRaw } = await supabase
    .from("mission_questions")
    .select("id, cycle_type, dashboard_area_tag, round_type, applicable_grades, question_text, is_active")
    .eq("is_active", true)
    .in("round_type", [roundType, "common"]);

  const candidates = candidatesRaw.filter((q) =>
    Array.isArray(q.applicable_grades) && q.applicable_grades.includes(grade)
  );

  console.log("\nCandidates applicable for grade:", candidates.length);
  candidates.forEach(c => console.log(`- [${c.cycle_type}] ${c.question_text}`));

  // 2. 출제 이력 로드
  const { data: historyRaw } = await supabase
    .from("mission_question_history")
    .select("question_id, asked_at")
    .eq("child_id", child.id);

  console.log("\nHistory items count:", historyRaw ? historyRaw.length : 0);
  if (historyRaw) {
    historyRaw.forEach(h => console.log(`- QID: ${h.question_id}, AskedAt: ${h.asked_at}`));
  }

  const lastAskedAt = new Map();
  for (const h of (historyRaw ?? [])) {
    const t = new Date(h.asked_at).getTime();
    const prev = lastAskedAt.get(h.question_id);
    if (prev === undefined || t > prev) lastAskedAt.set(h.question_id, t);
  }

  const now = Date.now();
  const daysSince = (ts) => (now - ts) / (1000 * 60 * 60 * 24);

  // 3. 주기 필터링
  const eligible = candidates.filter((q) => {
    const last = lastAskedAt.get(q.id);
    if (q.cycle_type === "onboarding") {
      return last === undefined;
    }
    if (q.cycle_type === "always") {
      return true;
    }
    if (last === undefined) return true;
    const CYCLE_INTERVAL_DAYS = { weekly: 7, monthly: 30, quarterly: 90 };
    return daysSince(last) >= CYCLE_INTERVAL_DAYS[q.cycle_type];
  });

  console.log("\nEligible after cycle filter:", eligible.length);
  eligible.forEach(e => console.log(`- [${e.cycle_type}] ${e.question_text}`));
}

run();
