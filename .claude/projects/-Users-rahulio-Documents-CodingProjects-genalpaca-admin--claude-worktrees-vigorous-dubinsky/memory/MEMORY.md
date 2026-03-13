# Claude Code Memory — vigorous-dubinsky worktree

## 2026-03-02: work_assignment email template

- Updated `work_assignment` email template in DB (`email_templates.template_key = 'work_assignment'`)
- Added ✓ checkmarks on door code badges (green pill style), two marketing photos at email bottom
- Template uses brand wrapper (body-only content) — no header/footer duplication needed
- Send-email function requires both `apikey:` AND `Authorization: Bearer` headers with service role key to invoke from curl (anon key alone returns 401)
- Test email sent to rahulioson@gmail.com successfully; no file changes, DB-only update
