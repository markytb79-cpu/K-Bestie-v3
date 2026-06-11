-- child_profiles 테이블에 email 컬럼 추가
ALTER TABLE child_profiles ADD COLUMN IF NOT EXISTS email TEXT;
