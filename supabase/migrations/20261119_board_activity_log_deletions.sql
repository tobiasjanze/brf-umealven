-- BRF Umeälven: tillåt loggning när beslut och uppgifter tas bort.
-- Kör hela filen i Supabase SQL Editor.
alter table public.board_activity_log
  drop constraint if exists board_activity_log_event_type_check;

alter table public.board_activity_log
  add constraint board_activity_log_event_type_check
  check (event_type in (
    'agenda_added',
    'agenda_updated',
    'agenda_deleted',
    'meeting_date_changed',
    'decision_registered',
    'decision_deleted',
    'task_created',
    'task_completed',
    'task_deleted'
  ));
