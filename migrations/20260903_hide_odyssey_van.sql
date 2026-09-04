-- Hide Odyssey Van from public browsing.
--
-- Parent is Playhouse (not secret) and it has no children of its own, so this
-- is a self-contained flag flip: is_secret_effective inheritance neither
-- supplies it nor cascades from it. The trigger added in
-- 20260830_rehide_fuego_and_spartan_spaces.sql keeps is_secret_effective in sync.

UPDATE spaces
SET is_secret = true
WHERE id = 'f516681f-affe-4ea4-b886-1169b9b926ae';  -- Odyssey Van
