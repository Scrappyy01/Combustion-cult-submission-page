-- Run this in the Supabase SQL Editor (Project > SQL Editor > New query)

create table if not exists public.submissions (
  id bigint generated always as identity primary key,
  name text not null,
  handle text not null,
  email text not null,
  country text not null,
  category text not null,
  description text not null,
  media_urls text[] not null default '{}',
  consent boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.submissions enable row level security;

-- Allow the anon (public) key used by the form to insert new rows only.
create policy "Allow public inserts"
  on public.submissions
  for insert
  to anon
  with check (true);
