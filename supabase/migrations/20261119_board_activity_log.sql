-- BRF Umeälven: beständig aktivitetslogg
-- Kör hela filen i Supabase SQL Editor.
create table if not exists public.board_activity_log (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'agenda_added',
    'agenda_updated',
    'agenda_deleted',
    'meeting_date_changed',
    'decision_registered',
    'task_created',
    'task_completed'
  )),
  meeting_id text,
  meeting_label text not null default 'Möte',
  summary text not null,
  section_label text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists board_activity_log_created_at_idx
  on public.board_activity_log (created_at desc);

alter table public.board_activity_log enable row level security;

-- Alla inloggade styrelsemedlemmar får läsa loggen.
drop policy if exists "Authenticated users can read board activity" on public.board_activity_log;
create policy "Authenticated users can read board activity"
  on public.board_activity_log
  for select
  to authenticated
  using (true);

-- Endast portalens administratör får lägga till logghändelser.
drop policy if exists "Admins can insert board activity" on public.board_activity_log;
create policy "Admins can insert board activity"
  on public.board_activity_log
  for insert
  to authenticated
  with check (public.current_user_is_admin() = true);

grant select, insert on public.board_activity_log to authenticated;
grant usage, select on sequence public.board_activity_log_id_seq to authenticated;
