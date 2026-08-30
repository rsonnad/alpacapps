-- sonos-health-schema.sql — telemetry table for scripts/sonos-health.py
--
-- Companion to public.network_config_snapshots (nightly CONFIG history).
-- This table holds frequent SYMPTOM samples so a dropout can be correlated
-- with kernel state, RF conditions, and how many zones were grouped at the time.
--
-- Apply once:
--   psql "$DATABASE_URL" -f scripts/sonos-health-schema.sql
-- or paste into the Supabase SQL editor.

create table if not exists public.sonos_health_samples (
  id                            uuid primary key default gen_random_uuid(),
  sampled_at                    timestamptz not null default now(),

  -- Kernel tripwire. The 2026-08-30 incident was snooping=1 / querier=0 with
  -- udm_boot_service missing, undetected for 10 hours.
  kernel_multicast_snooping     int,
  kernel_multicast_querier      int,
  udm_boot_service              text,
  udm_uptime_seconds            bigint,

  -- Rule evaluation against SONOSAUTOMATION.md
  rules_ok                      boolean not null default true,
  rule_violations               text[] not null default array[]::text[],

  -- Rollups for cheap charting
  speakers_online               int,
  speakers_over_retry_threshold int,
  max_retry_pct                 numeric(5,1),
  worst_speaker                 text,
  zone_count                    int,
  grouped_zone_count            int,
  largest_group_size            int,

  -- Per-speaker records, AP channel map, thresholds in force
  detail                        jsonb not null default '{}'::jsonb,

  alerted                       boolean not null default false,
  created_by                    text,
  created_at                    timestamptz not null default now()
);

create index if not exists sonos_health_samples_sampled_at_idx
  on public.sonos_health_samples (sampled_at desc);

-- Partial index: violation history is the common forensic query.
create index if not exists sonos_health_samples_bad_idx
  on public.sonos_health_samples (sampled_at desc) where rules_ok = false;

comment on table public.sonos_health_samples is
  'Sonos/network symptom telemetry sampled every 15 min from Alpuca. Config history lives in network_config_snapshots.';


-- ---------------------------------------------------------------- queries

-- Current state
--   select sampled_at, rules_ok, rule_violations, max_retry_pct, worst_speaker
--   from public.sonos_health_samples order by sampled_at desc limit 1;

-- Every window where rules were violated, most recent first
--   select sampled_at, kernel_multicast_snooping, kernel_multicast_querier,
--          udm_boot_service, rule_violations
--   from public.sonos_health_samples
--   where rules_ok = false order by sampled_at desc limit 50;

-- Did a reboot break persistence? Uptime resets to near zero; check what the
-- kernel looked like right after.
--   select sampled_at, udm_uptime_seconds, kernel_multicast_snooping, udm_boot_service
--   from public.sonos_health_samples
--   where udm_uptime_seconds < 1800 order by sampled_at desc;

-- Retry rate per speaker over the last day (feeds the channel-rebalance decision)
--   select sampled_at,
--          sp->>'room' as room, sp->>'channel' as ch,
--          (sp->>'retry_pct')::numeric as retry_pct, sp->>'ap' as ap
--   from public.sonos_health_samples,
--        lateral jsonb_array_elements(detail->'speakers') sp
--   where sampled_at > now() - interval '1 day'
--     and sp->>'retry_pct' is not null
--   order by sampled_at desc, retry_pct desc;

-- Does retry rate get worse as more zones are grouped? This is the question
-- that decides whether the ch1 congestion still matters post-multicast-fix.
--   select largest_group_size,
--          count(*) as samples,
--          round(avg(max_retry_pct), 1) as avg_worst_retry
--   from public.sonos_health_samples
--   where largest_group_size is not null and max_retry_pct is not null
--   group by largest_group_size order by largest_group_size;
