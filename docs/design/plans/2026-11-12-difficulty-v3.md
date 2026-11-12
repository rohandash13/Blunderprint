# Difficulty v3 Implementation Plan

**Goal:** Replace model-based difficulty with engine-based, rating-aware difficulty; add positional drills; one
primary pattern per move; keep clock errors out of drills; conversational difficulty wording.

**Spec:** `docs/design/specs/2026-11-12-difficulty-v3-design.md` (read it; its formulas and thresholds are binding).

**Branch:** `feat/coach-v2` (PR #1). Tasks run in order; each is TDD with a failing test first.

## Global Constraints

- Win chance: `wc(cp) = 1 / (1 + exp(-0.00368208 * cp))`; `win_drop = wc(bestScoreForMover) - wc(playedScoreForMover)`.
- Severity: inaccuracy 0.05–0.10, mistake 0.10–0.15, blunder ≥ 0.15. Candidate: `win_drop ≥ 0.05 AND p_played ≥ report.min-p-played`, and when `win_drop < 0.10` also `best_quiet = true`.
- `only_move`: best − second-best ≥ 0.10 in win chance at final depth. Trace search depth 14, MultiPV 2.
- DifficultyEstimator table exactly as in the spec §1.
- Levels vs rating R (move's rating, default 1500): slip `elo ≤ R − 300`, deep `elo > R + 100`, else tricky; null elo → unrated. Config `report.levels.slip-below: 300`, `report.levels.deep-above: 100`.
- Primary pattern priority: time_trouble > missed_tactic > hanging_piece > positional > endgame_technique > opening_error > other.
- Engine scores are centipawns from the side to move; mate = `sign * (10000 - |mate|)`.
- The LLM never receives FENs, UCI, ratings, Elo numbers or percentages for difficulty.
- Commands: Python `cd ml && .venv/Scripts/python.exe -m pytest -q`; backend (PowerShell) `$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"; Set-Location C:\Users\rohid\Blunderprint\backend; & "C:\Program Files\JetBrains\IntelliJ IDEA 2026.2.1\plugins\maven-plugin\lib\maven3\bin\mvn.cmd" -q test`; frontend `cd frontend && npx vitest run && npm run build`.
- Stage by explicit path; never `git add -A`; never touch `scripts/hw_ceiling.py`, `results/hw_ceiling_ac.json`. Commit trailer exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never print `.env`.

---

### Task D1: Python flags and positional tag

**Files:** `ml/src/blunderprint_ml/tags.py`, `ml/src/blunderprint_ml/service.py`, tests `ml/tests/test_tags.py`, `ml/tests/test_service.py`.

**Produces:** `/analyze` items gain `best_quiet: bool | null` and `best_free_material: bool | null` (null when `best_uci` is null). New functions in `tags.py`:
- `is_quiet(board, move) -> bool`: not capture, not check, not promotion.
- `wins_free_material(board, move) -> bool`: true if the move gives mate in one; or captures a piece (en passant counts as a pawn) where the captured square is undefended by the opponent after the capture, or captured value − capturing piece value ≥ 2 (values P1 N3 B3 R5 Q9; king as capturer counts 0 only if the square is undefended).
- `tag_move`: gate changes from `cpl < 100` to `cpl < 30`; add `"positional"` when `best` is not None and `is_quiet(board, best)` and neither `hanging_piece` nor `missed_tactic` was tagged. Keep the existing rules (missed_tactic still needs `cpl ≥ 200`). Rename the module constant to `TAG_MIN_CPL = 30`.

**Tests (must fail first):** quiet true/false for capture, check, promotion; free material: undefended knight capture → true, QxQ defended equal trade → false, pawn takes defended rook → true (5−1 ≥ 2), mate-in-1 move → true; positional tag for a quiet best with cpl 60; no tags for cpl 20; `/analyze` returns both flags and nulls when best is null. Use concrete FENs you construct and verify with python-chess in the test.

### Task D2: Stockfish trace (find depth, only move)

**Files:** `backend/src/main/java/com/blunderprint/engine/UciParser.java`, `StockfishEngine.java`, new `engine/EngineTracer.java`, new `engine/Trace.java`; tests `UciParserTest.java`, `StockfishEngineIT.java` (follow its existing skip-if-no-binary pattern).

**Produces:**
- `UciParser.parseInfoAny(String line) -> Optional<InfoMulti>` with `record InfoMulti(int depth, int multipv, Integer cp, Integer mate, String pv)` (same bound/score rules as `parseInfo`; `parseInfo` keeps its behaviour).
- `record Trace(String bestUci, int bestCp, Integer secondCp, int findDepth)` — scores from side to move, mate-encoded via `toCentipawns`.
- `StockfishEngine.trace(String fenKey, int depth) -> Trace`: `setoption name MultiPV value 2`, `go depth N`, track for each depth the multipv-1 PV's first move; `findDepth` = smallest d such that the multipv-1 first move at every depth ≥ d equals the final bestmove; `secondCp` from the last multipv-2 line at the final depth (null if only one legal move); then `setoption name MultiPV value 1`.
- `@Component EngineTracer` with its own `StockfishEngine` (lazy, `@Value("${engine.path}")`), `synchronized Optional<Trace> trace(String fenKey)` at depth 14; returns empty and logs on any IOException or missing binary; `@PreDestroy` closes.

**Tests:** parser handles `multipv 2` lines and bounds; IT: a position with a free queen (construct one) → `findDepth ≤ 2` and best captures the queen; start position → `secondCp != null`.

### Task D3: Store signals and estimate difficulty

**Files:** `db/migration/V3__difficulty.sql`, new `analysis/WinChance.java`, new `analysis/DifficultyEstimator.java`, `model/ModelClient.java`, `analysis/AnalysisService.java`; tests `WinChanceTest`, `DifficultyEstimatorTest`, `ModelClientTest`, `AnalysisServiceIT`.

**Produces:**
- Migration adds to `move_analysis`: `win_drop double precision, best_quiet boolean, best_free_material boolean, find_depth int, only_move boolean, difficulty_elo int`.
- `WinChance.of(int cp)`, `WinChance.drop(int bestCpForMover, int playedCpForMover)`.
- `DifficultyEstimator.estimate(int findDepth, boolean freeMaterial, boolean quiet, boolean onlyMove) -> int` exactly per spec table.
- `ModelClient.MoveOut` gains `@JsonProperty("best_quiet") Boolean bestQuiet, @JsonProperty("best_free_material") Boolean bestFreeMaterial` (keep the existing convenience constructors compiling).
- `AnalysisService.score` also writes `win_drop` (from the same `best_score`/`after_score` it uses for cpl: played-for-mover = −after_score), `best_quiet`, `best_free_material`. Then, for this run's candidates (spec rule, using stored `p_played`, `win_drop`, `best_quiet`), calls `EngineTracer.trace(before_key)`; on a trace writes `find_depth`, `only_move` (`WinChance.of(bestCp) − WinChance.of(secondCp) ≥ 0.10`, false when secondCp null), `difficulty_elo` (estimator; free material and quiet from the stored flags). Missing trace → those three stay null. `rescoreLatest` therefore refreshes everything.

**Tests:** WinChance at 0 = 0.5, symmetric, drop positive for a worse move; estimator table rows incl. free-material cap and quiet±only-move adjustments and clamps; IT with `@MockBean EngineTracer` returning a Trace → columns written; tracer empty → nulls and run still DONE; non-candidate moves are not traced (verify mock call count).

### Task D4: Report on the new signals

**Files:** `report/Difficulty.java` (rewrite), `report/ReportService.java`, `api/AnalysisController.java` (only if signatures change), `application.yml`, `scripts/difficulty_report.py`; tests `DifficultyTest`, `ReportServiceIT`, `AnalysisControllerIT`.

**Produces:**
- `Difficulty` value/config: `level(Integer difficultyElo, Integer rating)` per constraints (config offsets injected), `parse(csv)` unchanged, `sqlLevel(eloCol, ratingCol)` mirroring `level`. Tertiles and `harderThanPercent` removed.
- Candidate rule in SQL per constraints (replaces `cpl ≥ mistake-cpl`). `mistakes`/`candidates` header counts: `mistakes` = moves with `win_drop ≥ 0.10`, `candidates` = candidate rule.
- Primary pattern: computed per move from its tags by the priority list; a move contributes to exactly one pattern. Default level filter excludes `time_trouble` moves from patterns other than `time_trouble`; the `time_trouble` pattern's count is always reported but its examples are included only when the filter contains `slip` (they are clock errors).
- Example record: `gameId, ply, fen, played, best, cpl, pPlayed, pv, level, kind ("tactical"|"positional"), severity ("inaccuracy"|"mistake"|"blunder"), difficultyElo (Integer)`. Remove `pBest`, `harderThanPercent` from Example. Sort examples by `win_drop desc, game_id, ply`.
- `levelCounts` over candidates (all levels incl. unrated). `MistakeRow` gains `winDrop, kind, severity, difficultyElo, level` (level null for non-candidates); drop `harderThanPercent`.
- `scripts/difficulty_report.py`: summarize candidates by level with count, share, avg win drop, kind split, and per primary pattern; read the rows from `/players/{u}/mistakes` and treat `level != null` as candidate.

**Tests:** level boundaries vs rating (R−300 inclusive slip, R+100 exclusive deep); inaccuracy-but-tactical excluded; quiet inaccuracy included; dedupe (a move tagged endgame+missed_tactic appears only in missed_tactic); time-trouble move absent from other patterns and from default examples; sort by win_drop; 400 on bad level stays.

### Task D5: Frontend wording and fields

**Files:** `frontend/src/types.ts`, `frontend/src/coach/difficultyNote.ts` (new) + test, `frontend/src/coach/functions.ts` + test, `frontend/src/voice/settings.ts` + test, `frontend/src/App.tsx`.

**Produces:**
- Types: `Example` gets `kind`, `severity`, `difficultyElo`; drops `pBest`, `harderThanPercent`.
- `difficultyNote(level, kind): string` exactly the five phrases in spec §3 (unrated → "a position from your games").
- `get_report` patterns, `show_mistake`, `start_drill` results include `level`, `kind`, `difficultyNote`; never `difficultyElo`, `pBest`, percentages.
- Prompt: replace the levels line with: levels mean slip = something they'd usually spot, tricky = worth slowing down for, deep = a stretch at their level; describe positions with `difficultyNote` in natural words, never percentages or ratings; alternate positional and tactical drills when the player says "drill me" without a pattern (call `start_drill` on the largest `positional` or tactical pattern not used last).
- App Difficulty cell: `${LEVEL_NAMES[level] ?? "—"} · ${kind}`.

**Tests:** five note mappings; results contain no digits-percent strings and no `difficultyElo`; prompt contains the new phrasing and no "harderThanPercent".

### Task D6: Verify on real data, docs

Restart model service and backend; `POST /admin/players/Knight_ofthelight73/rescore`; run `scripts/difficulty_report.py`; check that the Nxf4 queen-capture example (FEN containing `Nxf4` best for Black, from the report) is `slip`; check the level distribution and the positional share; browser check (chips, Difficulty column, a positional drill plays out). Update README (Difficulty section and Results row with the new measured breakdown) and mark the v2 spec's difficulty sections as superseded by this spec. Commit `results/difficulty_levels.json`.
