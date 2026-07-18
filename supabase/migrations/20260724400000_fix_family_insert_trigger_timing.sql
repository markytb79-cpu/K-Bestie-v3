-- 신규 가족 생성 시 (INSERT) 오너 추가 전에 trigger가 발생하여 트랜잭션이 실패하는 문제를 수정합니다.
-- families 테이블의 트리거를 DROP하고 INSERT를 제외한 UPDATE, DELETE에서만 작동하도록 변경합니다.

BEGIN;

DROP TRIGGER IF EXISTS trg_owner_succession_guard_families ON public.families;

CREATE CONSTRAINT TRIGGER trg_owner_succession_guard_families
AFTER UPDATE OR DELETE ON public.families
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.fn_check_owner_succession_guard();

COMMIT;
