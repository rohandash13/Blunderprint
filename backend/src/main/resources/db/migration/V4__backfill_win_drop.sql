-- Runs analysed before win_drop existed would show an empty report. Recompute it from the cached evals exactly
-- as AnalysisService.score does: wc(best) - wc(played), played = -(after score). difficulty_elo stays null, so
-- those moves show as "unrated" until the run is rescored.
update move_analysis a
set win_drop = 1.0 / (1.0 + exp(-0.00368208::float8 * eb.score_cp))
             - 1.0 / (1.0 + exp(0.00368208::float8 * ea.score_cp))
from move m
join analysis_run r on r.id = m.run_id
join eval_cache eb on eb.fen_key = m.before_key and eb.engine = r.engine and eb.depth = r.depth and eb.multipv = 1
join eval_cache ea on ea.fen_key = m.after_key and ea.engine = r.engine and ea.depth = r.depth and ea.multipv = 1
where a.move_id = m.id and a.win_drop is null;
