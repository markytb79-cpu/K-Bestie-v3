import { createClient } from "@supabase/supabase-js";
import pkg from "@next/env";
import fs from "fs";
import path from "path";

const { loadEnvConfig } = pkg;
loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL 및 SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false }
});

const isWrite = process.argv.includes("--write") || process.env.WRITE_DB === "true";

async function main() {
  const jsonPath = path.join(process.cwd(), "data/questions/question-bank-v2.0.json");
  if (!fs.existsSync(jsonPath)) {
    console.error("시드 데이터 파일이 존재하지 않습니다:", jsonPath);
    process.exit(1);
  }

  const rawData = fs.readFileSync(jsonPath, "utf8");
  const questions = JSON.parse(rawData);

  if (!isWrite) {
    console.log("=== DRY-RUN MODE ===");
    console.log("기본값은 dry-run 모드입니다. DB에 데이터를 쓰지 않고 출력만 합니다.");
    console.log("실제 DB 삽입을 진행하려면 '--write' 인수 또는 WRITE_DB=true 환경변수를 지정하세요.\n");
  }

  console.log(`${questions.length}개의 질문 뱅크 데이터를 처리하는 중...`);

  for (const q of questions) {
    const is_active = (q.clinical_status || "PENDING_REVIEW") === "APPROVED";

    if (!isWrite) {
      console.log(`[Dry-Run] mission_questions 추가 예정: group_code=${q.group_code}, text="${q.question_text}", clinical_status="${q.clinical_status || "PENDING_REVIEW"}", is_active=${is_active}`);
      if (q.variants && q.variants.length > 0) {
        for (const v of q.variants) {
          console.log(`  ㄴ [Dry-Run] question_variants 추가 예정: tone=${v.tone}, text="${v.question_text}", clinical_status="${q.clinical_status || "PENDING_REVIEW"}", is_active=${is_active}`);
        }
      }
      continue;
    }

    // 1. mission_questions 에 데이터 삽입
    const { data: mqData, error: mqError } = await supabase
      .from("mission_questions")
      .insert({
        question_text: q.question_text,
        applicable_grades: q.applicable_grades,
        cycle_type: q.cycle_type,
        dashboard_area_tag: q.dashboard_area_tag,
        round_type: q.round_type,
        is_active: is_active,
        clinical_status: q.clinical_status || "PENDING_REVIEW",
        conversation_stage: q.conversation_stage,
        question_intent: q.question_intent,
        question_bank_version: q.question_bank_version
      })
      .select("id")
      .single();

    if (mqError) {
      console.error(`질문 삽입 실패 [${q.group_code}]:`, mqError.message);
      continue;
    }

    const questionId = mqData.id;
    console.log(`질문 삽입 성공: ${q.group_code} -> ID: ${questionId}`);

    // 2. question_variants 에 변형 데이터 삽입
    if (q.variants && q.variants.length > 0) {
      const variantsToInsert = q.variants.map((v: any, index: number) => ({
        question_group_id: questionId,
        question_text: v.question_text,
        variant_type: v.variant_type,
        tone: v.tone,
        requires_context: v.requires_context || false,
        repeat_cooldown_days: v.repeat_cooldown_days || 0,
        clinical_status: q.clinical_status || "PENDING_REVIEW",
        is_active: is_active,
        sort_order: index
      }));

      const { error: vError } = await supabase
        .from("question_variants")
        .insert(variantsToInsert);

      if (vError) {
        console.error(`  ㄴ 변형(Variants) 삽입 실패:`, vError.message);
      } else {
        console.log(`  ㄴ 변형 ${q.variants.length}개 삽입 성공`);
      }
    }
  }

  console.log(isWrite ? "시드 임포트가 완료되었습니다." : "Dry-run 시뮬레이션이 완료되었습니다.");
}

// 직접 실행 시에만 main() 실행하도록 실행가드 구성
const isDirectRun = require.main === module || (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename));

if (isDirectRun) {
  main().catch((err) => {
    console.error("오류 발생:", err);
    process.exit(1);
  });
}
