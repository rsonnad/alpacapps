-- Photo AI Submissions — tracks photos analyzed by PAI via the Photo AI tab
create table if not exists photo_ai_submissions (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid references app_users(id),
  photo_url text not null,
  media_id uuid references media(id),
  prompt text,
  category text, -- work_task, marketing, social_media, alpaca, receipt, document, other
  action_taken text,
  summary text,
  task_id uuid references tasks(id),
  ai_response jsonb,
  created_at timestamptz default now()
);

-- Index for user history lookup
create index if not exists idx_photo_ai_submissions_user
  on photo_ai_submissions(app_user_id, created_at desc);

-- Add AI columns to media table (if not already present)
alter table media add column if not exists ai_tags text[] default '{}';
alter table media add column if not exists ai_caption text;

-- RLS: users can read their own submissions
alter table photo_ai_submissions enable row level security;

create policy "Users can read own photo_ai_submissions"
  on photo_ai_submissions for select
  using (app_user_id = auth.uid()::uuid or exists (
    select 1 from app_users where id = app_user_id and auth_user_id = auth.uid()
  ));

create policy "Service role can insert photo_ai_submissions"
  on photo_ai_submissions for insert
  with check (true);
