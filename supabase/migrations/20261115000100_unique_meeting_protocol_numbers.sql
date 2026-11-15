-- BRF Umeälven: säkra, föreningsgemensamma protokollnummer
-- Anpassad till den befintliga tabellen:
-- meeting_id (uuid), protocol_year, year_number, total_number, created_at.
-- Historiska protokoll importeras inte. Första nya total_number blir 291.

CREATE SEQUENCE IF NOT EXISTS public.meeting_protocol_number_seq
  AS bigint START WITH 291 INCREMENT BY 1 NO CYCLE;

-- Behåll den befintliga tabellens struktur och unika begränsningar.
-- Ta bort kaskadradering: tilldelade nummer ska finnas kvar även om ett möte tas bort.
ALTER TABLE public.meeting_protocol_numbers
  DROP CONSTRAINT IF EXISTS meeting_protocol_numbers_meeting_id_fkey;

-- Synka sekvensen mot både tidigare sekvensläge och högsta redan använda totalnummer.
DO $init$
DECLARE
  current_last bigint;
  current_called boolean;
  highest_assigned bigint;
  safe_last bigint;
BEGIN
  SELECT last_value, is_called
    INTO current_last, current_called
    FROM public.meeting_protocol_number_seq;

  SELECT COALESCE(MAX(total_number), 290)
    INTO highest_assigned
    FROM public.meeting_protocol_numbers;

  safe_last := GREATEST(
    290,
    highest_assigned,
    CASE WHEN current_called THEN current_last ELSE 290 END
  );

  PERFORM pg_catalog.setval(
    'public.meeting_protocol_number_seq'::regclass,
    safe_last,
    true
  );
END
$init$;

ALTER TABLE public.meeting_protocol_numbers ENABLE ROW LEVEL SECURITY;

-- Endast aktiva styrelsemedlemmar får läsa protokollnummer.
DROP POLICY IF EXISTS "Authenticated users can read protocol numbers" ON public.meeting_protocol_numbers;
DROP POLICY IF EXISTS "Active members can read protocol numbers" ON public.meeting_protocol_numbers;
CREATE POLICY "Active members can read protocol numbers"
  ON public.meeting_protocol_numbers
  FOR SELECT TO authenticated
  USING (private.is_active_board_member());

-- Skrivning och radering sker endast via den behörighetskontrollerade funktionen.
REVOKE INSERT, UPDATE, DELETE ON public.meeting_protocol_numbers FROM anon, authenticated;
GRANT SELECT ON public.meeting_protocol_numbers TO authenticated;

-- Ta bort eventuell äldre variant med felaktig text-parameter.
DROP FUNCTION IF EXISTS public.assign_meeting_minutes_number(text);

CREATE OR REPLACE FUNCTION public.assign_meeting_minutes_number(
  p_meeting_id uuid,
  p_protocol_year integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  assigned_total integer;
  next_year_number integer;
  next_total_number bigint;
BEGIN
  IF NOT private.is_admin_board_member() THEN
    RAISE EXCEPTION 'Endast administratör får tilldela protokollnummer.'
      USING ERRCODE = '42501';
  END IF;

  IF p_meeting_id IS NULL THEN
    RAISE EXCEPTION 'Mötes-ID saknas.';
  END IF;

  IF p_protocol_year IS NULL OR p_protocol_year < 2000 OR p_protocol_year > 2200 THEN
    RAISE EXCEPTION 'Protokollets årtal är ogiltigt.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.meetings WHERE id = p_meeting_id
  ) THEN
    RAISE EXCEPTION 'Mötet finns inte.';
  END IF;

  -- Ett globalt lås gör både totalnummer och årsnummer säkra vid samtidiga sparningar.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('brf-umealven-protocol-number-series')
  );

  SELECT total_number
    INTO assigned_total
    FROM public.meeting_protocol_numbers
    WHERE meeting_id = p_meeting_id;

  -- Ett redan tilldelat nummer återanvänds alltid, även vid redigering.
  IF assigned_total IS NOT NULL THEN
    RETURN assigned_total;
  END IF;

  SELECT COALESCE(MAX(year_number), 0) + 1
    INTO next_year_number
    FROM public.meeting_protocol_numbers
    WHERE protocol_year = p_protocol_year;

  next_total_number := pg_catalog.nextval(
    'public.meeting_protocol_number_seq'::regclass
  );

  IF next_total_number > 2147483647 THEN
    RAISE EXCEPTION 'Protokollserien har nått högsta tillåtna nummer.';
  END IF;

  INSERT INTO public.meeting_protocol_numbers (
    meeting_id,
    protocol_year,
    year_number,
    total_number
  )
  VALUES (
    p_meeting_id,
    p_protocol_year,
    next_year_number,
    next_total_number::integer
  );

  RETURN next_total_number::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_meeting_minutes_number(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_meeting_minutes_number(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_meeting_minutes_number(uuid, integer) TO authenticated;
