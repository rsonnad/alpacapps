# Adventurer 5M Pro AI Interface Spec

## Purpose

Define a build-ready specification for Claude to implement an AI-driven interface that helps users ideate, design, validate, and print 3D objects on a Flashforge Adventurer 5M Pro.

This spec prioritizes:

1. Strong "I don't know what to build" onboarding via AI Discovery Mode.
2. Reliable generation path from idea to printable model.
3. Deterministic print execution and monitoring for Adventurer 5M Pro.

---

## Product Vision

Build a "design copilot + print execution" app where AI behaves like:

- a product ideation partner (Discovery + Brainstorm),
- a CAD assistant (parametric model intent),
- a printability advisor (geometry/manufacturing checks),
- and a printer operator assistant (slice/send/monitor).

---

## Non-Goals (Initial Versions)

- Full freeform CAD editor in-browser.
- Unlimited style transfer / artistic mesh generation quality parity with pro CAD tools.
- Complex multi-printer fleet management.
- Automatic hardware modding / firmware control of printer internals.

---

## User Personas

- Beginner: no CAD skills, no clear idea of what to print.
- Hobbyist: has an idea, needs quick generation + print success.
- Practical maker: wants utility parts with dimensions/tolerances.

---

## Core UX Structure

Use a 5-stage workflow with clear stage gates:

1. Discovery (optional, triggered when user has no clear idea)
2. Brainstorm (concept candidates + tradeoffs)
3. Model Spec (constrained parametric description)
4. Validate + Slice (printability + slicing plan)
5. Print + Monitor (job lifecycle)

UI should support entering at Discovery or Brainstorm depending on user confidence.

---

## Stage 0: AI Discovery Mode (Critical)

### Trigger

Activate when user says things like:

- "I don't know what to build"
- "Give me ideas"
- "Surprise me"

or selects "No idea yet" in onboarding.

### Discovery Flow

#### Step 0.1 Category Selection

Show one-tap categories:

- Utility
- Art/Decor
- Toys/Games
- Gifts
- Organization
- Repair/Replacement
- Educational/STEM
- Seasonal/Holiday
- Surprise me

#### Step 0.2 Adaptive Questions

Ask 3-5 max questions (never more than 5), with chips + optional free text.

Examples:

- Utility: "What daily annoyance should this solve?"
- Repair: "What broke? Do you know rough dimensions?"
- Gift: "Who is it for and what are they into?"
- Art: "Style: minimalist, cute, abstract, fantasy?"

Rules:

- Always show progress: "Question 2 of 4".
- Stop early if confidence score is high enough.
- Ask at most 2 open-text questions.

#### Step 0.3 AI Idea Pack

Return 5 ranked ideas with:

- idea title,
- one-line value proposition,
- estimated print time,
- estimated filament usage,
- difficulty (easy/medium/hard),
- likely print risks,
- "best first print" recommendation badge.

#### Step 0.4 User Refinement Controls

Allow one-click refinement:

- Make simpler
- More creative
- Faster print
- Stronger
- Smaller

Then user clicks "Develop this idea".

---

## Stage 1: AI Brainstorm Mode

### Input

- user idea text (or selected discovery idea),
- optional sketch/photo reference,
- printer profile (Adventurer 5M Pro constraints),
- preference sliders:
  - strength vs speed,
  - aesthetics vs utility,
  - low material vs durability.

### Output

Generate 3 concept directions:

- Conservative (high print success),
- Balanced,
- Ambitious (more novel).

For each concept provide:

- name,
- intended use,
- estimated dimensions,
- expected material type suitability,
- print difficulty,
- print time/filament estimate,
- risk notes (supports, overhang, bed adhesion, weak walls).

User selects one concept and locks constraints.

---

## Stage 2: Model Specification Contract

AI should not jump directly to raw mesh generation. It must produce a structured model intent first.

### Structured Intent (JSON)

Required fields:

- `project_goal`
- `object_type`
- `dimensions_mm` (x, y, z)
- `key_features[]`
- `critical_constraints[]`
- `fit_tolerances_mm`
- `material_preference`
- `strength_profile` (low/medium/high)
- `aesthetic_style`
- `print_priority` (speed/quality/balance)

Optional:

- `reference_images[]`
- `assembly_parts[]`

This contract is handed to the geometry generator.

---

## Stage 3: Geometry + Printability Pipeline

### Pipeline Steps

1. Generate geometry from structured intent.
2. Mesh sanity checks (watertight/manifold/basic self-intersection checks).
3. Printability analysis:
   - bed fit (Adventurer 5M Pro build volume),
   - minimum wall thickness,
   - unsupported overhang risk,
   - tiny detail/nozzle compatibility risk.
4. Auto-repair pass (if needed).
5. Re-score printability and present findings.

### User Controls at This Stage

- scale (% and absolute mm),
- wall thickness presets,
- support preference (off/auto/strong),
- quality profile (draft/standard/fine).

---

## Stage 4: Slice + Print Orchestration

### Print Safety Principle

AI suggests. Backend enforces.

Never allow unsafe/invalid print starts due to generative output.

### Adventurer 5M Pro Integration Requirements

- Maintain printer profile presets:
  - nozzle diameter assumptions,
  - build volume limits,
  - material presets (PLA baseline first),
  - safe speed/temperature defaults.
- Produce deterministic slicing config from selected profile.
- Require passing validation checks before enabling "Start Print".

### Job Lifecycle

- queued
- preparing
- printing
- paused
- completed
- failed
- cancelled

Expose progress, ETA, and error states in UI.

---

## Information Architecture (Frontend)

Use top-level navigation:

1. Discover
2. Brainstorm
3. Model
4. Print
5. History

### Discover Screen

- category cards,
- adaptive question flow,
- idea pack list.

### Brainstorm Screen

- 3 concept cards,
- tradeoff table,
- "Develop this" CTA.

### Model Screen

- model preview,
- dimensions + tolerance controls,
- printability warnings and suggested fixes.

### Print Screen

- material/profile selection,
- slice summary (time/filament),
- queue/start/pause/cancel.

### History Screen

- previous projects,
- model versions,
- reprint,
- "iterate from this version".

---

## AI Orchestration Design

Use role-specialized AI prompts (or agents) instead of one monolithic prompt:

1. Discovery Agent: questioning + category fit + idea generation.
2. Brainstorm Agent: concept alternatives + tradeoff framing.
3. Spec Agent: convert user choice into strict structured intent JSON.
4. Validator Agent: printability review + fix suggestions.
5. Assistant Agent: troubleshooting and post-print iteration.

Guardrail rules:

- ask clarifying questions only when uncertainty impacts manufacturability.
- cap question count.
- always provide at least one low-risk recommendation.
- provide confidence score for each recommendation.

---

## Data Model (Initial)

### `projects`

- id
- user_id
- title
- category
- status
- created_at
- updated_at

### `discovery_sessions`

- id
- project_id
- category_selected
- questions_json
- answers_json
- confidence_score

### `idea_candidates`

- id
- project_id
- rank
- title
- summary
- difficulty
- estimated_time_min
- estimated_filament_g
- risk_notes_json
- selected (bool)

### `model_specs`

- id
- project_id
- version
- structured_intent_json
- dimensions_mm_json
- tolerance_mm
- material
- strength_profile

### `model_artifacts`

- id
- model_spec_id
- artifact_type (mesh/preview/slice)
- url
- metadata_json

### `print_jobs`

- id
- project_id
- model_spec_id
- printer_id
- status
- progress_pct
- eta_seconds
- error_message
- created_at
- updated_at

### `feedback_events`

- id
- project_id
- print_job_id
- outcome (success/partial/fail)
- fit_feedback
- quality_feedback
- notes

---

## API Contracts (Initial)

### `POST /api/discovery/start`

Input: `{ user_context?, printer_profile_id }`
Output: first category prompt + options

### `POST /api/discovery/answer`

Input: `{ session_id, question_id, answer }`
Output: next question OR ranked idea pack

### `POST /api/brainstorm/generate`

Input: `{ project_id, seed_idea, preferences }`
Output: 3 concept options with tradeoffs

### `POST /api/spec/finalize`

Input: `{ project_id, selected_concept_id, user_overrides }`
Output: structured model intent JSON

### `POST /api/model/generate`

Input: `{ project_id, model_intent }`
Output: model artifact references + initial validation

### `POST /api/print/prepare`

Input: `{ project_id, model_spec_id, print_profile }`
Output: slicing estimate + validation report

### `POST /api/print/start`

Input: `{ project_id, prepared_job_id }`
Output: print job id + live status channel token

### `GET /api/print/:jobId/status`

Output: lifecycle status, progress, ETA, errors

---

## Prompting Requirements

### Discovery Prompt Principles

- Use plain language.
- Ask short, practical questions.
- Prioritize "first successful print" outcomes.
- Avoid technical jargon unless user asks.

### Brainstorm Prompt Principles

- Provide 3 genuinely different concepts, not cosmetic variants.
- State tradeoffs clearly.
- Include at least one "low-risk first print" option.

### Validation Prompt Principles

- Mention specific risk and fix action.
- Tie fixes to print success (e.g., "increase wall to 2.0mm").
- Use confidence scoring and reason codes.

---

## UX Microcopy Requirements

- Friendly, not patronizing.
- Action-oriented labels:
  - "Show me ideas"
  - "Ask me a few questions"
  - "Pick safest first print"
  - "Develop this idea"
  - "Fix printability issues"
- Always frame warnings with actionable next step.

---

## MVP Scope (Build First)

1. Discovery Mode with categories + adaptive Q&A + top 5 idea pack.
2. Brainstorm with 3 concept directions.
3. Structured intent generation and storage.
4. Basic model validation UX (even if geometry backend is limited).
5. Print preparation scaffold for Adventurer 5M Pro profile.
6. Print job status timeline and history.

Defer advanced geometry and full automation if needed, but keep interfaces and contracts stable.

---

## Suggested Build Phases

### Phase 1: Discovery + Brainstorm UX

- Build category selector and adaptive Q flow.
- Implement idea pack and refinement actions.

### Phase 2: Spec Contract + Data Persistence

- Add project/session/candidate/spec tables.
- Add APIs for discovery and brainstorm handoff.

### Phase 3: Model + Validation Stub

- Integrate initial model generation backend (or placeholder pipeline).
- Implement printability report schema and UI.

### Phase 4: Print Orchestration

- Implement profile-driven print prep and status polling.
- Add queue, cancel, pause hooks.

### Phase 5: Iteration Loop

- Capture post-print feedback.
- Suggest "v2" improvements from real outcomes.

---

## Acceptance Criteria

1. A user with no idea can reach a selected concept in <= 3 minutes.
2. Discovery asks <= 5 questions and exits early on high confidence.
3. Brainstorm always returns 3 concept directions with explicit tradeoffs.
4. Model pipeline stores structured intent JSON before any generation.
5. Print button remains disabled until validation checks pass.
6. Print job status is visible and updates in near real-time.
7. User can iterate from previous print with one click.

---

## Metrics to Track

- Discovery completion rate.
- Time from start to concept selection.
- Concept-to-print conversion rate.
- Print success rate (completed vs failed).
- Reprint/iteration rate.
- Most selected categories and idea patterns.

---

## Risks and Mitigations

- Risk: AI asks too many questions.
  - Mitigation: hard cap and confidence-based early exit.
- Risk: generated models fail frequently.
  - Mitigation: force low-risk defaults + validation gating.
- Risk: users get stuck in ideation loops.
  - Mitigation: "best first print" recommendation and decisive CTAs.
- Risk: printer-specific mismatch.
  - Mitigation: enforce Adventurer 5M Pro profile constraints centrally.

---

## Build Notes for Claude

- Implement Discovery Mode first. It is the highest leverage feature for adoption.
- Keep all AI outputs structured and versioned.
- Treat printability validation as a product feature, not a backend detail.
- Prefer conservative defaults that maximize first-print success.
- Preserve separation of concerns:
  - frontend flow orchestration,
  - AI reasoning and contracts,
  - deterministic print execution services.
