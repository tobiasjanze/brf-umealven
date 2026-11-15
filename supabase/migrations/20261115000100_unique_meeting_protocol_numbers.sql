-- BRF Umeälven: unika protokollnummer
-- Förutsätter att 290 protokoll redan finns i meeting_minutes.
-- Migreringen avbryts om antalet inte stämmer, så att numreringen inte blir fel.

DO $$
DECLARE existing_count bigint;
BEGIN
  SELECT count(*) INTO existing_count FROM public.meeting_minutes;
  IF existing_count <> 290 THEN
    RAISE EXCEPTION 'Förväntade 290 befintliga protokoll före nästa nummer 291, men hittade % rader i meeting_minutes. Avbryter utan ändringar.', existing_count;
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS public.meeting_protocol_number_seq
  AS bigint START WITH 291 INCREMENT BY 1 NO CYCLE;

CREATE TABLE IF NOT EXISTS public.meeting_protocol_numbers (
  meeting_id text PRIMARY KEY,
  protocol_number bigint NOT NULL UNIQUE,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

-- Ge de 290 befintliga protokollen stabila historiska nummer 1–290.
INSERT INTO public.meeting_protocol_numbers (meeting_id, protocol_number)
SELECT meeting_id::text,
       row_number() OVER (ORDER BY updated_at ASC NULLS FIRST, meeting_id::text ASC)
FROM public.meeting_minutes
ON CONFLICT (meeting_id) DO NOTHING;

SELECT setval('public.meeting_protocol_number_seq', 290, true);

ALTER TABLE public.meeting_protocol_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Active members can read protocol numbers" ON public.meeting_protocol_numbers;
CREATE POLICY "Active members can read protocol numbers"
  ON public.meeting_protocol_numbers
  FOR SELECT TO authenticated
  USING (private.is_active_board_member());

GRANT SELECT ON public.meeting_protocol_numbers TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_meeting_minutes_number(p_meeting_id text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
DECLARE assigned_number bigint;
BEGIN
  IF NOT private.is_admin_board_member() THEN
    RAISE EXCEPTION 'Endast administratör får tilldela protokollnummer.'
      USING ERRCODE = '42501';
  END IF;

  IF p_meeting_id IS NULL OR btrim(p_meeting_id) = '' THEN
    RAISE EXCEPTION 'Mötes-ID saknas.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('brf-meeting-protocol-numbering'), hashtext(p_meeting_id));

  SELECT protocol_number INTO assigned_number
  FROM public.meeting_protocol_numbers
  WHERE meeting_id = p_meeting_id;

  IF assigned_number IS NOT NULL THEN
    RETURN assigned_number;
  END IF;

  assigned_number := nextval('public.meeting_protocol_number_seq');

  INSERT INTO public.meeting_protocol_numbers (meeting_id, protocol_number)
  VALUES (p_meeting_id, assigned_number);

  RETURN assigned_number;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_meeting_minutes_number(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_meeting_minutes_number(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_meeting_minutes_number(text) TO authenticated;
