-- Current resident emails (people with an active dwelling assignment)
-- Run in Supabase SQL Editor. Email lives on people; residents = person_id in active assignments.

SELECT
  p.first_name,
  p.last_name,
  p.email,
  p.phone
FROM people p
JOIN assignments a ON a.person_id = p.id
WHERE a.status = 'active'
  AND (a.type IS NULL OR a.type = 'dwelling')
  AND EXISTS (
    SELECT 1 FROM assignment_spaces asp
    JOIN spaces s ON s.id = asp.space_id
    WHERE asp.assignment_id = a.id
      AND (s.can_be_dwelling IS NOT TRUE OR s.can_be_dwelling IS NULL OR s.can_be_dwelling = true)
  )
GROUP BY p.id, p.first_name, p.last_name, p.email, p.phone
ORDER BY p.last_name, p.first_name;
