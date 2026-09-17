-- ============================================================
--  Equilibrium — database schema
--  Paste this whole file into Supabase → SQL Editor → Run.
--  Safe to run twice.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- questions ----------
create table if not exists public.questions (
  id           text primary key,
  subject      text not null check (subject in ('micro','macro')),
  unit         int  not null check (unit between 1 and 6),
  topic        text not null default '',
  difficulty   text not null default 'medium' check (difficulty in ('easy','medium','hard')),
  stem         text not null,
  choices      jsonb not null,
  answer       int  not null default 0,
  explanation  text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists questions_subject_unit_idx on public.questions (subject, unit);

-- ---------- materials (lessons) ----------
create table if not exists public.materials (
  id          text primary key,
  subject     text not null check (subject in ('micro','macro')),
  unit        int  not null check (unit between 1 and 6),
  kind        text not null default 'note' check (kind in ('note','formula','link')),
  title       text not null,
  body        text not null default '',
  url         text not null default '',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists materials_subject_unit_idx on public.materials (subject, unit);

-- ---------- finished practice sets and mocks ----------
create table if not exists public.sessions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  subject     text not null,
  unit        int  not null default 0,
  mode        text not null default 'practice',
  total       int  not null,
  correct     int  not null,
  secs        int  not null default 0,
  answers     jsonb not null default '[]'::jsonb
);
create index if not exists sessions_created_idx on public.sessions (created_at desc);

-- ---------- one row of site settings ----------
create table if not exists public.settings (
  id     int primary key default 1,
  bands  jsonb not null default '{
    "micro": {"five":73,"four":57,"three":44,"two":31},
    "macro": {"five":71,"four":55,"three":43,"two":32}
  }'::jsonb,
  check (id = 1)
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
--  Row level security
--  Visitors may read lessons, questions and settings, and may file a
--  result. Only a signed-in admin may write content or read results.
-- ============================================================

alter table public.questions enable row level security;
alter table public.materials enable row level security;
alter table public.sessions  enable row level security;
alter table public.settings  enable row level security;

drop policy if exists "questions readable"      on public.questions;
drop policy if exists "questions admin writes"  on public.questions;
drop policy if exists "materials readable"      on public.materials;
drop policy if exists "materials admin writes"  on public.materials;
drop policy if exists "sessions anyone inserts" on public.sessions;
drop policy if exists "sessions admin reads"    on public.sessions;
drop policy if exists "sessions admin deletes"  on public.sessions;
drop policy if exists "settings readable"       on public.settings;
drop policy if exists "settings admin writes"   on public.settings;

create policy "questions readable"     on public.questions for select using (true);
create policy "questions admin writes" on public.questions for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "materials readable"     on public.materials for select using (true);
create policy "materials admin writes" on public.materials for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create policy "sessions anyone inserts" on public.sessions for insert with check (true);
create policy "sessions admin reads"    on public.sessions for select using (auth.role() = 'authenticated');
create policy "sessions admin deletes"  on public.sessions for delete using (auth.role() = 'authenticated');

create policy "settings readable"     on public.settings for select using (true);
create policy "settings admin writes" on public.settings for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Existing databases: add the topic column without touching the data.
alter table public.questions add column if not exists topic text not null default '';


-- ============================================================
--  Students, admins and synced progress  (run this block once)
-- ============================================================

-- Only the people listed here may edit content or read results.
-- Add yourself: insert the id shown in Authentication -> Users.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  added_at   timestamptz not null default now()
);
alter table public.admins enable row level security;
drop policy if exists "admins readable by admins" on public.admins;
create policy "admins readable by admins" on public.admins for select
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.admins a where a.user_id = auth.uid()) $$;

-- Each student's own progress travels with their account.
create table if not exists public.progress (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.progress enable row level security;
drop policy if exists "progress own row" on public.progress;
create policy "progress own row" on public.progress for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Writing content is now restricted to admins, not to anyone signed in.
drop policy if exists "questions admin writes"  on public.questions;
drop policy if exists "materials admin writes"  on public.materials;
drop policy if exists "settings admin writes"   on public.settings;
drop policy if exists "sessions admin reads"    on public.sessions;
drop policy if exists "sessions admin deletes"  on public.sessions;

create policy "questions admin writes" on public.questions for all
  using (public.is_admin()) with check (public.is_admin());
create policy "materials admin writes" on public.materials for all
  using (public.is_admin()) with check (public.is_admin());
create policy "settings admin writes"  on public.settings  for all
  using (public.is_admin()) with check (public.is_admin());
create policy "sessions admin reads"   on public.sessions  for select using (public.is_admin());
create policy "sessions admin deletes" on public.sessions  for delete using (public.is_admin());
