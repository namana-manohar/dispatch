-- Run this once in the Supabase SQL editor (Database → SQL Editor → New query → paste → Run).
-- One row per user holding the whole app state (clients, today's drops, settings).

create table if not exists public.dispatch_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dispatch_state enable row level security;

-- Each user can only read and write their own row.
drop policy if exists "own state: select" on public.dispatch_state;
create policy "own state: select" on public.dispatch_state
  for select using (auth.uid() = user_id);

drop policy if exists "own state: insert" on public.dispatch_state;
create policy "own state: insert" on public.dispatch_state
  for insert with check (auth.uid() = user_id);

drop policy if exists "own state: update" on public.dispatch_state;
create policy "own state: update" on public.dispatch_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
