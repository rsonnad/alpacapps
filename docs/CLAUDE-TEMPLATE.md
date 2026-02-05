# CLAUDE.md - [Your Project Name]

This file provides context for Claude (AI assistant) when working on this codebase.

> **IMPORTANT: You have direct database access!**
> Always run SQL migrations directly using `psql` - never ask the user to run SQL manually.

> **IMPORTANT: Push changes immediately!**
> This is a GitHub Pages site - changes only go live after pushing.
> Always `git push` as soon as changes are ready.

> **IMPORTANT: First-time setup!**
> If the Supabase CLI is not installed or linked, run:
> `npm install -g supabase && supabase login && supabase link --project-ref YOUR_REF`

## Project Overview

[Your project] is a [type of system] for [purpose]. It manages [core entities].

**Tech Stack:**
- Frontend: Vanilla HTML/CSS/JavaScript (no framework)
- Backend: Supabase (PostgreSQL + Storage + Auth)
- Hosting: GitHub Pages (static site)

**Live URLs:**
- Public view: https://USERNAME.github.io/REPO/
- Admin view: https://USERNAME.github.io/REPO/admin/

## Deployment

Push to main and it's live. No build step, no PR process.
**For Claude:** Always push changes immediately.

## Supabase Details

- Project ID: `YOUR_PROJECT_REF`
- URL: `https://YOUR_PROJECT_REF.supabase.co`
- Anon key is in `shared/supabase.js`

### Direct Database Access (for Claude)

```bash
psql "postgres://postgres.YOUR_REF:YOUR_PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" -c "SQL HERE"
```

### Supabase CLI Access (for Claude)

```bash
supabase functions deploy <function-name>
supabase functions logs <function-name>
supabase secrets set KEY=value
```

Run these directly. If CLI not installed, install and link first.

## External Services

### Email (Resend)
- API key stored as Supabase secret: `RESEND_API_KEY`

### SMS (Telnyx)
- Config in `telnyx_config` table
- Edge functions: `send-sms`, `telnyx-webhook` (deploy with `--no-verify-jwt`)

### Payments (Square)
- Config in `square_config` table
- Edge function: `process-square-payment`

### E-Signatures (SignWell)
- Config in `signwell_config` table
- Edge function: `signwell-webhook` (deploy with `--no-verify-jwt`)

## Conventions

1. Use toast notifications, not alert()
2. Filter archived items client-side
3. Don't expose personal info in public views
4. Client-side image compression for files > 500KB
