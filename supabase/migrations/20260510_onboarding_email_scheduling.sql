-- Add columns to track scheduled onboarding email
ALTER TABLE rental_applications
  ADD COLUMN IF NOT EXISTS onboarding_email_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_email_sent_at timestamptz;

-- Cron: fire daily at 9:00 AM Central (14:00 UTC) to send due onboarding emails
SELECT cron.schedule(
  'send-onboarding-emails',
  '0 14 * * *',  -- 14:00 UTC = 9:00 AM Central (CDT)
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/send-onboarding-email',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
