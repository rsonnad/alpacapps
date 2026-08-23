-- Sandbox credentials are environment secrets and must never be committed.
-- Configure them through the admin secret-management workflow instead.
UPDATE paypal_config SET
  sandbox_client_id = NULL,
  sandbox_client_secret = NULL,
  test_mode = false,
  updated_at = now()
WHERE id = 1;
