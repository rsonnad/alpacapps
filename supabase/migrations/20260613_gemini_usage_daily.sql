-- Gemini AI cost tracking — daily per-project/per-model token usage + estimated cost.
-- Populated by the gemini-cost-sync edge function, which pulls token counts from
-- Google Cloud Monitoring (catches ALL Gemini keys/projects, not just app-side calls).
-- Applied live via Management API on 2026-06-13; this file is the version-controlled record.

create table if not exists public.gemini_usage_daily (
  usage_date date not null,
  gcp_project text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(12,4) not null default 0,
  synced_at timestamptz not null default now(),
  primary key (usage_date, gcp_project, model)
);

alter table public.gemini_usage_daily enable row level security;

-- Read-only to all clients (mirrors api_usage_log); writes happen via service role.
drop policy if exists gemini_usage_daily_select on public.gemini_usage_daily;
create policy gemini_usage_daily_select on public.gemini_usage_daily for select using (true);

create index if not exists idx_gemini_usage_daily_date on public.gemini_usage_daily (usage_date desc);

comment on table public.gemini_usage_daily is
  'Daily Gemini API token usage + estimated cost per GCP project/model. Synced from Cloud Monitoring by the gemini-cost-sync edge function.';
