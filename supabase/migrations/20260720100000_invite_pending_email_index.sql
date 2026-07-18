-- 미가입 이메일 초대(target_user_id NULL) 포함, family_id+이메일 기준 중복 pending 초대 방지.
CREATE UNIQUE INDEX IF NOT EXISTS idx_fjr_owner_inv_pending_email
  ON family_join_requests (family_id, lower(requester_email))
  WHERE direction = 'owner_invite' AND status = 'pending';
