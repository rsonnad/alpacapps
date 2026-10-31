-- Access regression for 20261101_bot_feedback.sql.
-- Run through the Management API as postgres. Rolls back; returns counts only.
BEGIN;

-- Row count of `q` as `r` with auth uid `uid`; -1 if denied.
CREATE FUNCTION pg_temp.count_as(r text, uid uuid, q text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN uid IS NULL THEN json_build_object('role', r)
         ELSE json_build_object('role', r, 'sub', uid) END::text, true);
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN
    EXECUTE q;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN n := -1;
  END;
  RESET ROLE;
  RETURN n;
END $$;

CREATE TEMP TABLE results (check_name text, expected bigint, actual bigint) ON COMMIT DROP;

INSERT INTO public.bot_feedback (message, type, source) VALUES ('regression row', 'bug', 'bot');

DO $$
DECLARE
  viewer uuid := (SELECT user_id FROM auth.identities WHERE provider = 'google'
                  AND lower(identity_data->>'email') = 'rahulioson@gmail.com' LIMIT 1);
  other uuid := (SELECT id FROM auth.users WHERE lower(email) NOT IN
                 ('rahulioson@gmail.com', 'sonia245g@gmail.com', 'hrsonnad@gmail.com')
                 ORDER BY created_at LIMIT 1);
  sel text := 'SELECT * FROM public.bot_feedback';
  upd text := $q$UPDATE public.bot_feedback SET status = 'read' WHERE message = 'regression row'$q$;
BEGIN
  INSERT INTO results VALUES
    ('anon cannot read', -1, pg_temp.count_as('anon', NULL, sel)),
    ('anon cannot insert', -1, pg_temp.count_as('anon', NULL, $q$INSERT INTO public.bot_feedback (message) VALUES ('x')$q$)),
    ('other signed-in user sees nothing', 0, pg_temp.count_as('authenticated', other, sel)),
    ('other signed-in user cannot set status', 0, pg_temp.count_as('authenticated', other, upd)),
    ('signed-in user cannot insert', -1, pg_temp.count_as('authenticated', other, $q$INSERT INTO public.bot_feedback (message) VALUES ('x')$q$)),
    ('viewer cannot change the message', -1, pg_temp.count_as('authenticated', viewer, $q$UPDATE public.bot_feedback SET message = 'y'$q$)),
    ('viewer cannot delete', -1, pg_temp.count_as('authenticated', viewer, 'DELETE FROM public.bot_feedback')),
    ('viewer sets status', 1, pg_temp.count_as('authenticated', viewer, upd));
  INSERT INTO results SELECT 'viewer reads every row', count(*), pg_temp.count_as('authenticated', viewer, sel)
    FROM public.bot_feedback;
END $$;

SELECT check_name, expected, actual, expected = actual AS ok FROM results ORDER BY 4, 1;
ROLLBACK;
