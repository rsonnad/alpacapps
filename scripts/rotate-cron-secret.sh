#!/bin/bash
# rotate-cron-secret.sh — create/rotate the pg_cron X-Cron-Secret and (first run) apply
# supabase/migrations/20261017_cron_post_secret.sql. Never prints the secret.
#
# Writes the same random value to Vault 'schedule_cron_secret' (read by public.cron_post)
# and the edge secret SCHEDULE_CRON_SECRET (read by requireCronOrRoles / sonos / nest).
# Usage: ./scripts/rotate-cron-secret.sh            (rotate + apply migration)
#        ./scripts/rotate-cron-secret.sh --no-migration
set -euo pipefail
cd "$(dirname "$0")/.."
export BW_SESSION=$(cat ~/.bw-session)
MGMT_TOKEN=$(~/bin/bw-read 'Supabase — AlpacApps Project' 'Management API Token')
API=https://api.supabase.com/v1/projects/aphrrfprbixmhissnjfn
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT; umask 077
export NEWSEC=$(openssl rand -hex 32)
q() { python3 -c "import json,sys;print(json.dumps({'query':sys.stdin.read()}))" > "$TMP/q.json"
      curl -sS -X POST "$API/database/query" -H "Authorization: Bearer $MGMT_TOKEN" -H 'Content-Type: application/json' --data-binary @"$TMP/q.json"; echo; }
python3 -c "import os;print(\"\"\"do \$\$ begin
  if exists (select 1 from vault.secrets where name='schedule_cron_secret') then
    perform vault.update_secret((select id from vault.secrets where name='schedule_cron_secret'), '%s');
  else
    perform vault.create_secret('%s', 'schedule_cron_secret', 'pg_cron X-Cron-Secret; must equal edge secret SCHEDULE_CRON_SECRET');
  end if; end \$\$;\"\"\" % (os.environ['NEWSEC'], os.environ['NEWSEC']))" | q > /dev/null && echo "vault: updated"
python3 -c "import json,os;print(json.dumps([{'name':'SCHEDULE_CRON_SECRET','value':os.environ['NEWSEC']}]))" > "$TMP/s.json"
echo "edge secret: HTTP $(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/secrets" -H "Authorization: Bearer $MGMT_TOKEN" -H 'Content-Type: application/json' --data-binary @"$TMP/s.json")"
if [ "${1:-}" != "--no-migration" ]; then
  echo -n "migration: "; q < supabase/migrations/20261017_cron_post_secret.sql
fi
echo -n "jobs on cron_post: "; echo "select count(*) from cron.job where command like '%public.cron_post(%';" | q
