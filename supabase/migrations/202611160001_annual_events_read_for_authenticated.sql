-- Tillåt alla inloggade användare i styrelseportalen att läsa årshjulets aktiviteter.
-- Behörighet att skapa, ändra och ta bort aktiviteter styrs fortsatt separat.

alter table public.annual_events enable row level security;

drop policy if exists "annual_events_select_authenticated" on public.annual_events;

create policy "annual_events_select_authenticated"
on public.annual_events
for select
to authenticated
using (true);
