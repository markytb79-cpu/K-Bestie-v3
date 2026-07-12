-- 초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 SQL Editor에서 직접 실행할 것
-- 실행 완료 시 이 파일 하단에 [APPLIED YYYY-MM-DD] 표시를 추가할 것.
--
-- 배경: parents.tier는 가족 소유자(부모) 1행 단위 컬럼이라, 한 가정의 자녀 여럿이
-- 항상 같은 tier를 공유하게 되는 구조적 문제가 있었음 (예: 서아/서현이 같은 부모를
-- 공유 → 항상 동일 tier). 이 서비스는 "아이 1명당 요금제 1개"가 요구사항이므로,
-- tier는 아이 실체인 child_profiles에 있어야 함.
--
-- 기존 13개 승인 테이블 중 child_profiles에 컬럼 1개만 추가 (신규 테이블 없음).
-- 기존 서아/서현 등 모든 아이의 현재 설정은 백필로 보존됨(값 유실 없음).

-- ================================================================
-- 1) child_profiles.tier 컬럼 추가 (기본값 1 = Care Start)
-- ================================================================
ALTER TABLE child_profiles
  ADD COLUMN tier INT NOT NULL DEFAULT 1 REFERENCES plans(tier);

-- ================================================================
-- 2) 백필: 각 아이가 속한 가정의 "오너 부모" tier 값으로 초기화
--    (지금까지 사실상 가족 단위로 적용되던 값을 아이 단위 컬럼으로 그대로 이관)
--    WHERE 조건: 반드시 해당 child_profiles.family_id 와 매칭되는
--    family_members(role='owner_parent') 를 통해서만 갱신 — 다른 가정/다른
--    아이 행은 매칭되지 않으므로 영향 없음.
-- ================================================================
UPDATE child_profiles cp
SET tier = p.tier
FROM family_members fm
JOIN parents p ON p.id = fm.user_id
WHERE fm.family_id = cp.family_id
  AND fm.role = 'owner_parent'
  AND fm.user_id IS NOT NULL;

-- ================================================================
-- 3) 검증 쿼리 (실행 후 확인용 — SELECT만, DDL 아님)
-- ================================================================
-- SELECT cp.id, cp.name, cp.family_id, cp.tier
-- FROM child_profiles cp
-- ORDER BY cp.family_id, cp.name;

-- 서아/서현 확인:
-- SELECT name, tier FROM child_profiles
-- WHERE id IN ('11814f28-5900-4a7b-af3c-30e8c05c547a', '85bdca6c-87a1-404a-b623-e6835df1e306');
-- (마이그레이션 직후에는 둘 다 tier=1로 나오는 것이 정상 — 오너 부모 tier가 1이었기 때문.
--  서현을 tier=3으로 올리는 작업은 20260712400000_ash160202_tier_fix.sql 에서 별도 진행)
