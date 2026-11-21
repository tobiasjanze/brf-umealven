-- Private rate-limit ledger for the password-help Edge Function.
create table if not exists public.password_help_requests (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.password_help_requests enable row level security;
revoke all on public.password_help_requests from anon, authenticated;
-- The Edge Function accesses this table using the server-side service-role key.

create index if not exists password_help_requests_created_at_idx
  on public.password_help_requests (created_at);
create index if not exists password_help_requests_email_hash_idx
  on public.password_help_requests (email_hash, created_at);
create index if not exists password_help_requests_ip_hash_idx
  on public.password_help_requests (ip_hash, created_at);
