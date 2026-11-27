CREATE TABLE IF NOT EXISTS public.cilantro_daily_entries (
  id uuid PRIMARY KEY,
  player uuid NOT NULL,
  day date NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 18),
  score integer NOT NULL CHECK (score >= 0),
  submitted bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS cilantro_daily_entries_ranking
  ON public.cilantro_daily_entries(day, player, score DESC, submitted);
ALTER TABLE public.cilantro_daily_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cilantro_daily_entries FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.cilantro_daily_entries TO service_role;

CREATE OR REPLACE FUNCTION public.cilantro_daily_board(p_day date)
RETURNS TABLE(name text, score integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT best.name, best.score FROM (
    SELECT DISTINCT ON (e.player) e.name, e.score, e.submitted
    FROM public.cilantro_daily_entries AS e
    WHERE e.day = p_day
    ORDER BY e.player, e.score DESC, e.submitted, e.id
  ) AS best
  ORDER BY best.score DESC, best.submitted, best.name LIMIT 25
$$;
REVOKE EXECUTE ON FUNCTION public.cilantro_daily_board(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cilantro_daily_board(date) TO service_role;

CREATE SCHEMA IF NOT EXISTS cilantro_internal;
REVOKE ALL ON SCHEMA cilantro_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA cilantro_internal TO service_role;
CREATE TABLE IF NOT EXISTS cilantro_internal.signing_key (
  singleton boolean PRIMARY KEY CHECK (singleton),
  secret text NOT NULL
);
INSERT INTO cilantro_internal.signing_key (singleton, secret)
VALUES (true, gen_random_uuid()::text || gen_random_uuid()::text)
ON CONFLICT (singleton) DO NOTHING;
GRANT SELECT ON TABLE cilantro_internal.signing_key TO service_role;
CREATE OR REPLACE FUNCTION public.cilantro_daily_signing_key()
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT secret FROM cilantro_internal.signing_key WHERE singleton
$$;
REVOKE EXECUTE ON FUNCTION public.cilantro_daily_signing_key() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cilantro_daily_signing_key() TO service_role;
