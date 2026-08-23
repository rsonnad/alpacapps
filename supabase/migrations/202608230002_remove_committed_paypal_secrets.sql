-- Remove sandbox credentials that were previously embedded in migration
-- history. Production credentials must be configured out-of-band.
UPDATE paypal_config
SET sandbox_client_id = NULL,
    sandbox_client_secret = NULL,
    test_mode = false,
    updated_at = now()
WHERE id = 1;
