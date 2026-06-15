-- Run this once in Supabase → SQL Editor.

-- Client roster: each buyer client + their saved search criteria
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Published dossiers: the full selection, addressed by a short id used in /d/{id}
create table if not exists dossiers (
  id text primary key,
  client_id uuid references clients(id) on delete set null,
  title text default '',
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Lock the tables down. All access goes through the Vercel functions using the
-- service-role key (which bypasses RLS). No public/anon policies are created,
-- so the anon key cannot read or write these tables directly.
alter table clients  enable row level security;
alter table dossiers enable row level security;
