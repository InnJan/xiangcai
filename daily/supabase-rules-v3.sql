ALTER TABLE public.cilantro_daily_entries
  ADD COLUMN IF NOT EXISTS rules_version integer NOT NULL DEFAULT 2;
CREATE INDEX IF NOT EXISTS cilantro_daily_entries_by_rules
  ON public.cilantro_daily_entries(day, rules_version, player, score DESC, submitted);

CREATE OR REPLACE FUNCTION public.cilantro_daily_board_for_rules(p_day date, p_version integer)
RETURNS TABLE(name text, score integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT best.name, best.score FROM (
    SELECT DISTINCT ON (e.player) e.name, e.score, e.submitted
    FROM public.cilantro_daily_entries AS e
    WHERE e.day = p_day AND e.rules_version = p_version
    ORDER BY e.player, e.score DESC, e.submitted, e.id
  ) AS best
  ORDER BY best.score DESC, best.submitted, best.name LIMIT 25
$$;
REVOKE EXECUTE ON FUNCTION public.cilantro_daily_board_for_rules(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cilantro_daily_board_for_rules(date, integer) TO service_role;
