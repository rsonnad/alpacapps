-- Seed the admin review queue with the initial design pass over the 20 questions.
-- Idempotent: re-running refreshes wording but never resets a decision an admin
-- has already made, so this can ship alongside later edits.

CREATE OR REPLACE FUNCTION enm_seed_review_item(
  p_key TEXT, p_qnum INT, p_cat TEXT, p_title TEXT,
  p_finding TEXT, p_recommendation TEXT, p_sort INT
) RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM enm_quiz_review_items WHERE question_uid = p_key) THEN
    UPDATE enm_quiz_review_items
       SET title = p_title, finding = p_finding, recommendation = p_recommendation,
           category = p_cat, question_number = p_qnum, sort_order = p_sort, updated_at = now()
     WHERE question_uid = p_key AND status = 'pending';
  ELSE
    INSERT INTO enm_quiz_review_items
      (question_uid, question_number, category, title, finding, recommendation, sort_order, source)
    VALUES (p_key, p_qnum, p_cat, p_title, p_finding, p_recommendation, p_sort, 'seed');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ── Cross-cutting findings (question_number 0) ───────────────────────────────
SELECT enm_seed_review_item('x-self-vs-partner', 0, 'self-vs-partner',
  'Nothing tells the taker whose answer is being recorded',
  'After Q1 establishes couple-or-individual, 11 of the 20 questions switch to "we", "our", and "my partner" without ever re-stating who is answering. Two people in the same couple will answer Q5, Q6, Q9, Q15 and Q16 differently, and the stored session cannot tell which of them it represents. Q1 also admits single people, who then have no honest answer to any couple-framed question.',
  'Carry a persistent "Answering for: myself / my partner / both of us" indicator in the question header, set from Q1 and changeable. Rewrite couple-framed stems to lead with "you" and treat the partner as the object ("How would you feel if your partner..."). For the single path, branch to a track that drops the "we" questions entirely.', 10);

SELECT enm_seed_review_item('x-dead-options', 0, 'scoring',
  'Roughly a third of all answers score nothing',
  'Q3 (8 options), Q17 (3) and Q18 (4) score zero on every option. Q7 scores on only 1 of 4, Q13 on only 1 of 5, and Q14 on 2 of 6. A taker can answer five whole questions and move the result not at all, which makes the 20-question length hard to justify.',
  'Decide per question whether it is scoring or segmentation. Wire the scoring ones in (fears and safety needs are strong signal for Still Exploring vs Monogamish). For the pure segmentation ones, either move them after the result is shown or add a one-line "this helps us tailor your follow-up, it does not change your result".', 20);

SELECT enm_seed_review_item('x-already-enm', 0, 'coverage',
  'No path for people already practising ENM',
  'Every entry option in Q1 and Q2 assumes the taker has not started yet: curious, agreed to explore, partner said no, or single and pre-dating. Someone already open for years who wants to name their style has to misrepresent themselves at the first question, and the "Still Exploring" result will be wrong for them.',
  'Add "We are already non-monogamous and want to understand our style" to Q1, and an "already practising" band to Q2. That cohort is also the most likely to buy coaching, so it is worth a distinct result framing rather than the beginner roadmap.', 30);

SELECT enm_seed_review_item('x-polycule', 0, 'coverage',
  'The quiz cannot represent more than two people',
  'Q1 offers couple or individual only, and every later question says "my partner" in the singular. Existing triads, quads and polycules — precisely the audience for the Polyamory, Solo Poly and Relationship Anarchy results — have no way through.',
  'Allow "I have more than one partner already" at Q1 and switch the later stems to "a partner" rather than "my partner" when that is selected.', 40);

SELECT enm_seed_review_item('x-consent-path', 0, 'safety',
  'The undisclosed-partner path needs its own handling',
  'Q1 option 3 combines "my partner does not know" with "my partner said no" into one answer, and both route to the generic Still Exploring roadmap. On a quiz branded around *ethical* non-monogamy, the first of those describes a situation that is not yet consensual, and the second is a mono/poly impasse. They are different problems and neither is what the Still Exploring copy addresses.',
  'Split into two options. Route "does not know" to a result that names the disclosure conversation as the necessary first step, and route "said no" toward the Mono/Poly material. Neither should read as judgement, but neither should be answered with a generic on-ramp either.', 50);

SELECT enm_seed_review_item('x-length', 0, 'flow',
  'Twenty questions is long for a top-of-funnel quiz',
  'The email gate now sits at the end, so every taker who abandons before Q20 is lost entirely. Questions 17 and 18 (children, budget) sit late in the run and score nothing, so the most drop-off-prone stretch is also the least load-bearing.',
  'Cut to a ~12-question core that fully determines the result, and offer the rest as an optional "want a sharper read?" step after the email is captured. Failing that, move the unscored segmentation questions after the gate.', 60);

SELECT enm_seed_review_item('x-freetext', 0, 'coverage',
  '"Something else" collects nothing',
  'Q2, Q11 and Q13 end in a Something else / none of this is me option that scores zero and captures no text. The people choosing it are the ones the quiz models worst, and they are exactly the ones worth hearing from.',
  'Attach an optional one-line free-text box to every escape-hatch option and store it on the answer row.', 70);

SELECT enm_seed_review_item('x-budget-placement', 0, 'clarity',
  'The budget question reads as sales qualification',
  'Q18 asks what the taker can spend, unscored, before any offer has been made and before the email is even captured. In a free self-discovery quiz that lands as being priced rather than helped.',
  'Move it after the result and the email gate, and give it a reason: "so we can point you at options that fit". Or drop it and infer from what people click on the roadmap.', 80);

SELECT enm_seed_review_item('x-typos', 0, 'copy',
  'Six copy defects across the question set',
  'Q9 option 1 reads "With can date separately" (should be "We"). Q11 has "Ive" without an apostrophe and a double space in "the  standard". Q13 option 0 has a leading space before "Losing". Q3 option 4 and Q17 also carry stray leading or double spaces.',
  'Fix all six in quiz-data.js. Low effort, and they are visible to every taker.', 90);

-- ── Per-question findings ────────────────────────────────────────────────────
SELECT enm_seed_review_item('q1-split', 1, 'coverage',
  'Q1: one option hides two very different situations',
  '"I am in a relationship but my partner does not know or said no" merges an undisclosed exploration with a refused one. They need different results and different first steps.',
  'Split into two options and map them separately. See the consent-path item for the routing.', 100);

SELECT enm_seed_review_item('q2-pronoun', 2, 'self-vs-partner',
  'Q2: mixes "I" and "we" inside one option list',
  'Option 0 is "Purely curious, completely clueless" (first person singular) while options 1-3 are all "we". Whichever the taker picks, half the list did not apply to them.',
  'Rewrite the whole list in one voice — second person singular reads best — and let the couple context come from Q1.', 110);

SELECT enm_seed_review_item('q2-wentbadly', 2, 'coverage',
  'Q2: "we tried something once, it went badly" asks no follow-up',
  'This is the highest-signal answer in the question and the quiz does nothing with it beyond scoring Still Exploring. What went badly — jealousy, a broken agreement, a bad third party — changes the advice completely.',
  'Add a one-question branch when this is selected, or at minimum a free-text box.', 120);

SELECT enm_seed_review_item('q3-unscored', 3, 'scoring',
  'Q3: eight options, none of which affect anything',
  'Every option in "What brought you to this?" maps to result 0, and the multi-select cap is 8 out of 8 options, so it is not even a forced-choice. It is the third question a taker sees and it is inert.',
  'Either score it — "our sex life has gone quiet" and "we have had a few experiences and want more" point at different styles — or move it after the result as a context question.', 130);

SELECT enm_seed_review_item('q4-onthside', 4, 'scoring',
  'Q4: "dating separately, on the side" scores nothing',
  'Dating separately with a partner''s knowledge is close to the definition of an open relationship, but this option maps to 0 while the other six all score. It reads like an oversight rather than a decision. "On the side" also carries an affair connotation that the rest of the quiz carefully avoids.',
  'Score it toward Open Relationship and reword to "each of us dating other people, openly".', 140);

SELECT enm_seed_review_item('q5-couple-only', 5, 'self-vs-partner',
  'Q5: no valid answer for a single taker',
  'All three options are "together as a couple" / "each separately" / "a mix". Someone who chose "I am single" at Q1 is four questions in with nothing that fits. The same problem recurs at Q6, Q9, Q15 and Q16.',
  'Branch the single path, or add a neutral third-person framing ("with a partner, together" / "independently") that works either way.', 150);

SELECT enm_seed_review_item('q7-orientation', 7, 'clarity',
  'Q7: conflates orientation with a kink dynamic, and only one option scores',
  'Options 0, 1 and 3 all score zero; only "one of us wants our partner with a particular gender while we watch" does anything. That option is a voyeur/hotwife dynamic, not an orientation, so the question is really asking two unrelated things under one stem. "We are both straight" also assumes two cis people.',
  'Split into a genuine orientation question (scored or explicitly contextual) and fold the watching dynamic into Q10 where it belongs.', 160);

SELECT enm_seed_review_item('q8-model', 8, 'copy',
  'Q8 is the strongest question in the set — use it as the template',
  'It gives a concrete scene, asks for a gut reaction rather than a preference, and every option scores. The rest of the quiz asks people to self-classify in the abstract, which is much harder to answer honestly.',
  'Rewrite the weaker abstract questions (Q2, Q12, Q16) in this scene-first style.', 170);

SELECT enm_seed_review_item('q10-shame', 10, 'safety',
  'Q10: the cuckolding option is worded as self-deprecation',
  '"Submission & the ''I''m not enough for you'' feeling" frames the kink through inadequacy. For someone tentatively exploring it, seeing their interest described that way on first contact is more likely to close them down than open them up. The question is also gated on a conditional — "if the idea appeals" — but everyone is forced to answer.',
  'Reword around power exchange and consensual humiliation as the erotic mechanic, and add a genuine "this does not apply to me" that skips cleanly.', 180);

SELECT enm_seed_review_item('q13-fears', 13, 'scoring',
  'Q13: the fear question barely functions',
  'Four of the five fears score nothing. Losing a partner, not coping emotionally, outside judgement and permanent change are the four most common blockers in this space, and the quiz records them without using them.',
  'Score them. Fear of losing the partner and fear of not coping both point at Still Exploring or Monogamish over Polyamory; fear of judgement points at discretion-first formats. This is the cheapest accuracy win available.', 190);

SELECT enm_seed_review_item('q17-children', 17, 'clarity',
  'Q17: asks about children at home, uses it for nothing, explains nothing',
  'All three options score zero and the taker is given no reason for the question. Asking about children inside a sexuality quiz without a stated purpose is the point where a cautious person closes the tab.',
  'Say why it is being asked ("so the logistics advice fits your household") or remove it.', 200);

SELECT enm_seed_review_item('q19-regular', 19, 'scoring',
  'Q19: "a real, regular part of life" scores nothing',
  'The other three frequency options all score, but the one describing sustained, integrated non-monogamy maps to 0 — even though it is the clearest Polyamory or Open Relationship signal in the question.',
  'Score it toward Polyamory and Open Relationship.', 210);

DROP FUNCTION IF EXISTS enm_seed_review_item(TEXT, INT, TEXT, TEXT, TEXT, TEXT, INT);
