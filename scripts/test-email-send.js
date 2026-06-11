#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  });
}

const url = envVars['NEXT_PUBLIC_SUPABASE_URL'];
const key = envVars['SUPABASE_SERVICE_ROLE_KEY'];

if (!url || !key) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 없습니다.');
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error('ERROR: 초대할 이메일을 인자로 입력해주세요.');
  console.error('예: node scripts/test-email-send.js test@example.com');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(url, key, { auth: { persistSession: false } });

async function testInvite() {
  console.log(`Supabase Auth 초대 메일 발송 테스트 시작: ${email}`);
  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: 'http://localhost:3000/auth/setup-password'
  });

  if (error) {
    throw error;
  }

  console.log('초대 결과:', JSON.stringify(data, null, 2));
  console.log('\n✓ 초대 성공! 메일함(스팸함 포함)을 확인해보세요.');
}

testInvite().catch(err => {
  console.error('\n✗ 초대 실패:', err.message);
  process.exit(1);
});
