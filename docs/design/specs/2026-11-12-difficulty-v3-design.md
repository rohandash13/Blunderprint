# Difficulty v3: Engine-Based, Rating-Aware Difficulty and Positional Drills

**Date:** 2026-11-12
**Status:** Approved design
**Supersedes:** the difficulty parts of `2026-11-11-coach-v2-design.md` §1–2. Playout, stepping and transcript are unchanged.

## Problem

Live test (`Knight_ofthelight73`, ~2450): the coach drilled a free-queen capture (Nxf4) as "deep, harder than 80%
of your mistakes". Cause: difficulty came from the move model's `p_best`. The model predicts what a human plays
at a glance. In that position it gives the game move Kd5 95% and the queen capture 0.3%, because it has no notion
of free material. `p_best` measures how natural a move looks, not how hard it is to find. Also:

- The same move appears in up to three patterns (endgame + time trouble + missed tactic), so drills repeat.
- Only moves losing ≥ 100 cp are mistakes, so quiet positional errors (454 moves of 40–99 cp in this player's
  games) never reach the drills.
- The coach recites statistics ("harder than 73% of your mistakes"), which sounds robotic.

## Goals

1. Difficulty = how hard the best move is to find, measured from the engine and from board rules.
2. Levels relative to the player's rating: an obvious tactic is a slip for a 2400 and a fair drill for a 1200.
3. Positional drills: quiet best moves with a modest cost, alongside tactics.
4. Clock errors kept out of the default drills; one primary pattern per move.
5. Conversational difficulty wording, with no numbers.

## Non-goals

Retraining the move model (`p_played` still marks habits). UI redesign (next). Deployment (separate plan).

## 1. Signals per analyzed move

Computed once per move during scoring and stored in `move_analysis` (Flyway `V3`):

| Column | Source | Meaning |
|---|---|---|
| `win_drop double` | Java, from cached evals | Drop in winning chances on the [0,1] scale, from the mover's side: `wc(best) − wc(played)` with `wc(cp) = 1 / (1 + exp(−0.00368208·cp))` (the Lichess win-chance curve). |
| `best_quiet bool` | Python `/analyze` | Best move is not a capture, check or promotion, and its line is not tactical (see below). |
| `best_free_material bool` | Python `/analyze` | Best move captures a piece that is undefended, or worth more than the capturing piece (net gain ≥ 2 pawns). Also true for mate in 1. |
| `find_depth int` | Java, Stockfish trace | Shallowest iterative-deepening depth from which Stockfish's first PV move equals the stored `best_uci` (the move being drilled) at every later depth (search to `engine.depth`, the same depth the stored best move came from, 12 by default). |
| `only_move bool` | Java, Stockfish MultiPV 2 | The stored best move is the final multipv-1 move and beats the second-best by ≥ 0.10 in win chance (one move clearly works). |
| `difficulty_elo int` | Java, `DifficultyEstimator` | Estimated rating at which players usually find the move (below). |

**Tactical lines.** A move that is quiet by type can still be a tactic. Java sends the cached best line to Python
as `best_pv` (space-separated UCI, from the `eval_cache` row for the best move). `best_line_is_tactical(board,
best_pv)` is true when the mover is in check (a check evasion), or when playing the PV for at most 4 plies
(stopping at the first illegal move) the mover delivers mate, or the mover's material balance (P1 N3 B3 R5 Q9)
is ≥ 2 better than at the start after an opponent reply (ply 2 or 4, so a sacrifice that is recaptured is not a
gain). `best_quiet = is_quiet(best) and not best_line_is_tactical`; the `positional` tag uses the same
definition. `best_free_material` is unchanged.

**Trace against the stored best move.** The trace describes the move that is drilled, not whatever Stockfish
prefers in a deeper search; it runs at the analysis depth so the two usually agree. `EngineTracer.trace(fenKey, targetUci)` measures `find_depth` against `targetUci` (the stored
`move_analysis.best_uci`) and reports `targetIsBest` (the final multipv-1 first move is the target) and the
multipv-2 first move. `only_move` is computed as above when `targetIsBest`; otherwise (the target is the final multipv-2 move, where
`find_depth` would just be the final depth, or in neither line) `find_depth`, `only_move` and `difficulty_elo` stay null
(the move reads as `unrated`) and the run's log line counts it as "trace disagreed".

The trace (`find_depth`, `only_move`) runs only for candidate moves (§2), so it costs one MultiPV-2 search per
candidate (≈ 100–300 per player), done in the scoring step and by rescore.

**DifficultyEstimator** (pure function; constants in one place):

```
base by find_depth: ≤1 → 900, 2 → 1200, 3–4 → 1500, 5–6 → 1800, 7–8 → 2100, 9–10 → 2400, ≥11 → 2700
if best_free_material: elo = min(elo, 1200)
if best_quiet and only_move: elo += 200
if best_quiet and not only_move: elo -= 100   (several good quiet moves: a positional nudge, not a puzzle)
clamp to [600, 3000]
```

## 2. Candidates, levels, patterns

**Candidate** (shown in the report and drills): `win_drop ≥ 0.05` and `p_played ≥ report.min-p-played` (the habit
filter is unchanged). Inaccuracies (0.05–0.10) qualify only when `best_quiet`, since that is the positional pool.
Severity labels (Lichess thresholds halved for the [0,1] scale): inaccuracy 0.05–0.10, mistake 0.10–0.15, blunder ≥ 0.15.

**Level** vs the mover's rating `R` (the move's stored rating, or 1500 if missing), with config offsets:
- `slip`: `difficulty_elo ≤ R − 300` (should be found at this level)
- `deep`: `difficulty_elo > R + 100` (a stretch for this level)
- `tricky`: in between
- `unrated`: `difficulty_elo` null (older runs before rescore)

Config: `report.levels.slip-below: 300`, `report.levels.deep-above: 100`.

**Primary pattern:** each candidate is listed under exactly one pattern, by priority:
`time_trouble` (clock < 30 s) > `missed_tactic` > `hanging_piece` > `positional` > `endgame_technique` >
`opening_error` > `other`.
- `time_trouble` moves appear only in that pattern, and the default level filter excludes them from drills (the
  pattern still shows its count).
- The Python tagger adds `positional`: best move quiet and none of `hanging_piece`/`missed_tactic`. Tagging runs
  for every move with `cpl ≥ 30`, not only `cpl ≥ 100`.

**Report:** same endpoint and `?levels=` (default `tricky,deep`). Examples are sorted by `win_drop` descending
within the filter. Each example gains `kind` (`tactical` if not `best_quiet`, else `positional`), `severity`
(`inaccuracy|mistake|blunder`), `difficultyElo`, `level`. `harderThanPercent` and the tertile logic are removed.

**Drillable patterns.** `get_report` patterns carry `drillable` (`examples > 0`). The prompt says to drill or show
only drillable patterns; a `time_trouble` pattern is about the clock, so the coach talks about it instead of
drilling. The pattern table disables Show/Drill with the tooltip "No positions at these levels" when a pattern
has no examples.

**Level chips (`levelCounts`).** Clock (`time_trouble`-primary) candidates only produce examples under the
`slip` filter, so they are excluded from `levelCounts` unless `slip` is in the filter; a chip never promises
positions that are not there. Pattern counts are unchanged (clock errors always count toward their pattern).

**Old runs.** Flyway `V4__backfill_win_drop.sql` fills `move_analysis.win_drop` where null from `eval_cache`
exactly like `AnalysisService.score` (join on `before_key`/`after_key` with the run's engine and depth,
`multipv = 1`). `difficulty_elo` stays null, so those moves are `unrated` (and, when every candidate is unrated,
the all-unrated fallback shows them) until the run is rescored.

**Rescore without an engine.** Stale trace values are cleared by design, so a rescore with no working Stockfish
yields an all-unrated report (the all-unrated fallback still lists the examples).

**Scheduling and rescore.** `spring.task.scheduling.pool.size: 2`, so tracing inside `tick()` does not block
the worker reaper. `score()` no longer nulls `find_depth`/`only_move`/`difficulty_elo` in its upsert; after the
trace pass it nulls them only for this run's rows that were not traced successfully (non-candidates, failed or
disagreeing traces), so a rescore never shows a temporarily all-unrated report. The candidate thresholds
(0.05 / 0.10) live in one place (`analysis.Severity`), shared by `AnalysisService` and `ReportService`.

## 3. Coach wording

Function results carry a `difficultyNote` (built in the frontend from `level`, `kind` and `severity`); no numbers:
- deep + positional: "a quiet positional move, the kind that's hard to find even at your level"
- deep + tactical: "a tactic that needs real calculation"
- tricky + positional: "a positional decision worth slowing down for"
- tricky + tactical: "a tactic a few moves deep"
- slip: "something you'd usually spot, probably a rushed moment"

Prompt: describe positions with `difficultyNote`, never with percentages or ratings. Lead a session with a
positional and a tactical drill before repeating a kind. The UI's Difficulty column shows the level and kind
("Deep · positional").

## 4. Errors and tests

- No engine at rescore/scoring → trace columns stay null → level `unrated`; scoring still completes.
- Python: flags for quiet, capture, check and promotion; free material (undefended piece, piece worth more,
  mate in 1, defended equal trade = false); `positional` tag; tags for cpl 30–99.
- Java: `WinChance` values and symmetry; `UciParser` MultiPV 2 parsing; `StockfishEngine.trace` against real
  Stockfish (existing IT pattern): a free-queen capture has `find_depth ≤ 2`; `DifficultyEstimator` table cases;
  `ReportService` candidate rule, levels vs rating, primary-pattern dedupe, time-trouble exclusion, sort.
- Frontend: `difficultyNote` mapping, no numbers in function results, prompt text.
- Verification on real data: the Nxf4 queen capture must come out `slip` for the 2450 player. The level
  distribution is reported; if a level is empty the offsets are revisited (config, not code).
