-- Expose HAOS connection config to kiosks via anon-callable RPC.
-- Returns ha_base_url and ha_token from home_assistant_config (singleton row).
-- This removes the need to hardcode the HAOS token in frontend kiosk code.

create or replace function public.get_kiosk_haos_config()
returns json
language sql
security definer
stable
as $$
  select json_build_object(
    'base_url', ha_base_url,
    'token', ha_token
  )
  from public.home_assistant_config
  where id = 1;
$$;

-- Allow anon + authenticated to call this function
grant execute on function public.get_kiosk_haos_config() to anon, authenticated;
