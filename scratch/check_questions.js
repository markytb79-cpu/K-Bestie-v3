const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Simple env file parser
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

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: questions, error } = await supabase
    .from('mission_questions')
    .select('*');
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log("Total Questions in DB:", questions.length);
  console.log(JSON.stringify(questions, null, 2));
}

run();
