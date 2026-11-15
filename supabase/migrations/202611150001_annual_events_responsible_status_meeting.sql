-- Utöka årshjulet med ansvarig, status och koppling till styrelsemöte.
-- Kör detta en gång i Supabase SQL Editor innan den nya portalversionen används.

alter table public.annual_events
  add column if not exists responsible text,
  add column if not exists status text not null default 'Ej påbörjad',
  add column if not exists meeting_id text;

alter table public.annual_events
  drop constraint if exists annual_events_status_check;

alter table public.annual_events
  add constraint annual_events_status_check
  check (status in ('Ej påbörjad', 'Pågående', 'Genomförd', 'Ej aktuell'));

comment on column public.annual_events.responsible is
  'Person som ansvarar för aktiviteten.';
comment on column public.annual_events.status is
  'Uppföljningsstatus för aktiviteten.';
comment on column public.annual_events.meeting_id is
  'Valfritt ID för kopplat styrelsemöte i public.meetings.';
