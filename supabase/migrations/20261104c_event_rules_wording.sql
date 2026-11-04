-- Event rules wording (2026-11-04): no alcohol at events, dogs in sight or tied in front,
-- parking off the wet grass and the host is responsible for parking problems.
UPDATE event_agreement_templates SET content = replace(content,
  '9. **No Alcohol or Meat Inside:** No alcohol or meat may be brought into the house or consumed inside.',
  '9. **No Alcohol; No Meat Inside:** No alcohol at the house or at events. No meat may be brought into the house or consumed inside.')
WHERE content LIKE '%No alcohol or meat may be brought into the house%';

UPDATE event_agreement_templates SET content = replace(content,
  '12. **No Animals:** No animals may be brought into the house or the backyard. $100 fee if this happens. Dogs can be tied in front yard but should not run free (neighbor dogs are aggressive).',
  '12. **No Animals:** No animals may be brought into the house or the backyard. Owners must keep their dogs in sight, or tie them in the front yard; dogs should not run free (neighbor dogs are aggressive). $100 fee for violations.')
WHERE content LIKE '%Dogs can be tied in front yard but should not run free%';

UPDATE event_agreement_templates SET content = replace(content,
  '5. **Parking Management:** Client agrees to manage parking to ensure no vehicles are parked in front of neighbors houses.',
  '5. **Parking Management:** Client agrees to manage parking to ensure no vehicles are parked in front of neighbors houses or on the wet grass. Client is responsible for any parking problems that happen.')
WHERE content LIKE '%ensure no vehicles are parked in front of neighbors houses. $150%';

UPDATE event_agreement_templates SET content = replace(content,
  'during the event to prevent parking on neighbors property' || chr(10),
  'during the event to prevent parking on neighbors property or on the wet grass' || chr(10))
WHERE position('during the event to prevent parking on neighbors property' || chr(10) in content) > 0;
