-- Promote exactly one existing administrator: the oldest active administrator is
-- the deterministic owner of user-management authority. Other administrators keep
-- their operational role. A brand-new installation creates super_admin directly.
WITH first_super_admin AS (
  SELECT id
  FROM underwriting_users
  WHERE role = 'admin' AND status = 'active'
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
UPDATE underwriting_users
SET role = 'super_admin', updated_at = now()
WHERE id = (SELECT id FROM first_super_admin)
  AND NOT EXISTS (
    SELECT 1 FROM underwriting_users WHERE role = 'super_admin'
  );

ALTER TABLE underwriting_users
  DROP CONSTRAINT IF EXISTS underwriting_users_role_check;

ALTER TABLE underwriting_users
  ADD CONSTRAINT underwriting_users_role_check
  CHECK (role IN ('super_admin', 'admin', 'staff'));
