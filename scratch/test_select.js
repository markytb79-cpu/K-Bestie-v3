const { selectQuestions } = require('../lib/mission/selectQuestions');
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
  const { data: children } = await supabase.from('child_profiles').select('id, name, grade').limit(1);
  if (!children || children.length === 0) {
    console.error("No child profiles found");
    return;
  }
  const child = children[0];
  console.log(`Running real selectQuestions utility test for child: ${child.name} (${child.grade})`);
  
  const m = String(child.grade).match(/\d+/);
  const grade = m ? parseInt(m[0], 10) : 4;
  
  const pickedIds = await selectQuestions(child.id, grade, "round1_day");
  console.log("Selected QIDs length:", pickedIds.length);
  console.log("QIDs:", pickedIds);
}

run();
