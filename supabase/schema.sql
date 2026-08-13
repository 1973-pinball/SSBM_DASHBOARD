-- SSBM Dashboard cloud sync schema.
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Stores only the flattened per-game metadata the app already keeps in IndexedDB —
-- never raw .slp replay files.

create table if not exists public.game_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null, -- app-side key: path|size|mtime
  data jsonb not null, -- the full GameRecord as stored locally
  played_at timestamptz, -- denormalized from data for range queries
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists game_records_played_at_idx
  on public.game_records (user_id, played_at desc);

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  my_codes text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Row-level security: every user sees exactly their own rows.
alter table public.game_records enable row level security;
alter table public.user_settings enable row level security;

create policy "own records select" on public.game_records
  for select using (auth.uid() = user_id);
create policy "own records insert" on public.game_records
  for insert with check (auth.uid() = user_id);
create policy "own records update" on public.game_records
  for update using (auth.uid() = user_id);
create policy "own records delete" on public.game_records
  for delete using (auth.uid() = user_id);

create policy "own settings select" on public.user_settings
  for select using (auth.uid() = user_id);
create policy "own settings insert" on public.user_settings
  for insert with check (auth.uid() = user_id);
create policy "own settings update" on public.user_settings
  for update using (auth.uid() = user_id);
create policy "own settings delete" on public.user_settings
  for delete using (auth.uid() = user_id);
