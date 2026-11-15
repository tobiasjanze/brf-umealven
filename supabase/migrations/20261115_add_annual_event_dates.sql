-- Lägg till start- och slutdatum för uppgifter i årshjulet.
-- Kör detta en gång i Supabase SQL Editor.

ALTER TABLE public.annual_events
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

COMMENT ON COLUMN public.annual_events.start_date IS
  'Planerat startdatum för aktiviteten i årshjulet.';

COMMENT ON COLUMN public.annual_events.end_date IS
  'Sista datum då aktiviteten ska vara genomförd; används för varningsfärg i årshjulet.';
