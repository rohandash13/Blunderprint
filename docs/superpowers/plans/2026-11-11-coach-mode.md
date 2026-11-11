# Coach Mode Implementation Plan (voice coach v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the voice coach from an answer-giver into a teacher: hints before answers, unlimited attempts on a position, engine lines played out on the board with arrows and explained from computed facts, "what if I play X?" exploration with a live engine, correct spoken move names, and a readable report table.

**Builds on:** `docs/superpowers/specs/2026-11-10-voice-coach-design.md` and `docs/superpowers/plans/2026-11-10-voice-coach.md` (all tasks done).

## Spec addendum (from the 2026-11-11 live test)

Problems seen: the board never moved on spoken moves; the LLM said "knight to f7" for Nxf7; asking "why?" got a guess; the coach jumped to the next example; one attempt per drill; no hints. Decisions:

1. **Code computes chess facts; the LLM only teaches from them.** Every move the agent may say is returned with a `spoken` string; the prompt forbids converting notation itself.
2. **Hint ladder:** idea → piece → square → reveal. Unlimited attempts per position. Reveal only after the ladder, or when the player says they don't know / asks to see it.
3. **Explain by playing it out:** the report carries each example's engine line (`pv`); `explain_line` animates it on the board and returns per-ply facts (capture, check, fork, material).
4. **Explore:** `try_move` plays any move from the current exploration position and gets a live engine reply via a new backend endpoint (cached in `eval_cache`).
5. **Stay on a position** until the player asks to move on. "other" is presented as "uncategorized middlegame mistakes"; lead with the largest named pattern.
6. **Board:** arrows — green engine best, red player/game move, blue engine reply; spoken moves flash red then animate.
7. **Report table:** pattern (friendly name + one-line description), count, avg loss, examples, Show/Drill.

## Global Constraints

- All constraints in `docs/superpowers/plans/2026-11-10-voice-coach.md` "Global Constraints" still apply (key handling, socket protocol, audio format, commit rules, LLM never judges chess).
- Piece values: pawn 1, knight 3, bishop 3, rook 5, queen 9, king 0 (for material and fork logic).
- Engine scores from the backend are centipawns from the **side to move**'s perspective (as stored in `eval_cache`); mate = ±(10000 − |n|).
- Engine endpoint depth = `engine.depth` (12); engine version = `engine.version`; results are read from and written to `eval_cache` with the same key as the worker pool (`Fen.key(fen)`, engine version, depth, multipv 1).
- Spoken move format (exact): non-pawn `"<piece> to <sq>"` / `"<piece> takes on <sq>"`; pawn push `"pawn to <sq>"`; pawn capture `"<file>-pawn takes on <sq>"`; castling `"castles kingside"` / `"castles queenside"`; promotion suffix `", promoting to a <piece>"`; check suffix `", check"`; mate suffix `", checkmate"`. Piece names lowercase: pawn knight bishop rook queen king. Squares lowercase.
- Commits: stage by explicit path; message ends with blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task C1: Engine line in the report + live engine endpoint (Java)

**Files:** Modify `backend/src/main/java/com/blunderprint/report/ReportService.java`; Create `backend/src/main/java/com/blunderprint/engine/EngineService.java`, `backend/src/main/java/com/blunderprint/api/EngineController.java`; Tests `backend/src/test/java/com/blunderprint/report/ReportServiceIT.java` (extend), `backend/src/test/java/com/blunderprint/engine/EngineServiceIT.java`.

**Interfaces:**
- `ReportService.Example` gains a final component `List<String> pv` (UCI moves of the engine's best line from the position before the mistake; empty list if not cached). Source: `eval_cache.pv` (space-separated) via a LEFT JOIN on `c.fen_key = m.before_key and c.engine = r.engine and c.depth = r.depth and c.multipv = 1` where `r` is the run (`analysis_run` has `engine`, `depth`).
- `EngineService.analyze(String fen) -> Analysis(String bestUci, int scoreCp, List<String> pv)`: invalid FEN → `IllegalArgumentException`; cache hit returns the cached row without touching the engine; miss → analyzes with one lazily created engine (calls serialized with `synchronized`), stores the row (`on conflict do nothing`), returns it. The engine dependency is an interface `EngineService.Analyzer { EngineResult analyze(String fenKey, int depth) throws IOException; }` with a default implementation wrapping `StockfishEngine(engine.path)`; tests inject a fake.
- `POST /engine/analyze` body `{"fen": "..."}` → 200 `{"bestUci","scoreCp","pv":[...]}`; invalid FEN → 400 `{"error": "invalid FEN"}`; engine failure → 503 `{"error": "engine unavailable"}`.
- Vite proxy: add `"/engine": "http://localhost:8080"` to `frontend/vite.config.ts`.

- [ ] Step 1: Failing tests. ReportServiceIT: seed an `eval_cache` row for an example's `before_key` (engine/depth of the run) with `pv = "e5f7 e8f7 d1h5"` and assert that example's `pv()` equals `List.of("e5f7","e8f7","d1h5")`; an example without a cache row has `pv()` empty. EngineServiceIT (extends `PostgresIT`): (a) cache hit — insert a row, fake analyzer that fails if called, `analyze(fen)` returns the row; (b) miss — fake analyzer returns `new EngineResult("g1f3", 25, "g1f3 g8f6")`, result matches and a row now exists in `eval_cache` for `Fen.key(fen)`; (c) invalid FEN (`"not a fen"`) → `IllegalArgumentException`.
- [ ] Step 2: Run, see failures (compile errors count). Maven: `$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.13.9-hotspot"; & "C:\Program Files\JetBrains\IntelliJ IDEA 2026.2.1\plugins\maven-plugin\lib\maven3\bin\mvn.cmd" -q test -Dtest=ReportServiceIT,EngineServiceIT` from `backend`.
- [ ] Step 3: Implement. Validate FEN with chesslib (`new com.github.bhlangonijr.chesslib.Board().loadFromFen(fen)` inside try/catch) plus a 6-field check. Read `Fen.java` and `StockfishEngine.java` for how a key is passed to the engine.
- [ ] Step 4: Full backend suite passes (`mvn -q test`).
- [ ] Step 5: Commit `feat: engine line in report examples and live engine endpoint`.

### Task C2: Position facts, spoken moves, hint ladder (TypeScript, pure)

**Files:** Create `frontend/src/chess/facts.ts`, `frontend/src/coach/hints.ts`; Tests `frontend/src/chess/facts.test.ts`, `frontend/src/coach/hints.test.ts`. Modify `frontend/src/types.ts` (`Example.pv: string[]`).

**Interfaces:**
- `spokenMove(fen: string, uci: string): string` — exact format from Global Constraints; illegal → returns the UCI text.
- `describeMove(fen, uci): MoveFacts | null` with `MoveFacts = { uci, san, spoken, side: "White"|"Black", piece: string, captured?: string, check: boolean, mate: boolean, attacks: {square: string; piece: string}[], fork: boolean, fenAfter: string, materialAfter: number }`. `attacks` = opponent pieces attacked by the moved piece after the move (king included, as "king"). `fork` = the moved piece attacks ≥2 opponent pieces that are each either the king, worth more than the mover, or undefended. `materialAfter` = White minus Black material in pawns.
- `lineFacts(fen, ucis: string[], maxPlies = 6): MoveFacts[]` — applies moves in sequence, stops at the first illegal one.
- `material(fen): { white: number; black: number; diff: number }`.
- `hintLadder(fen, bestUci): [string, string, string]` — `[idea, piece, square]`:
  - idea: mate → "There's a forced checkmate here — look at every check."; capture+check → "Look for a capture that also gives check."; fork → "Look for a move that attacks two things at once."; capture → "Something can be won — look for what's loose or under-defended."; check → "Look at forcing moves, especially checks."; otherwise → "No capture needed — find the move that improves your worst piece or stops your opponent's main idea."
  - piece: `"It's a move with your <piece>."` (castling → "It involves your king — think about safety.")
  - square: `"Your <piece> goes to <square>."` (castling → "Castle.")

- [ ] Step 1: Failing tests (use exact expected strings). `spokenMove`: start `g1f3` → "knight to f3"; start `e2e4` → "pawn to e4"; `rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2` `e4d5` → "e-pawn takes on d5"; `r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1` `e1g1` → "castles kingside", `e1c1` → "castles queenside"; `8/P6k/8/8/8/8/8/K7 w - - 0 1` `a7a8q` → "pawn to a8, promoting to a queen" (check suffix if it gives check — compute, don't hard-code); a knight capture with check, e.g. `r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4` `h5f7` → "queen takes on f7, checkmate". `describeMove` fork: `4k3/8/8/8/8/8/3r1q2/4N1K1 w - - 0 1`... choose and VERIFY with chess.js a position where a knight move forks king and rook (assert `fork === true`, `check === true`, attacks include king and rook), and a quiet move with `fork === false`. `material` of the start position → `{white: 39, black: 39, diff: 0}`. `lineFacts` stops at an illegal move. `hintLadder` for the scholar's-mate position above (`h5f7`) → idea is the mate line, piece "It's a move with your queen.", square "Your queen goes to f7."; for a quiet best move → the "No capture needed…" idea.
- [ ] Step 2: Run, see failures. Step 3: Implement with chess.js 1.4.0 (`new Chess(fen)`, `.move()`, `.isCheck()`, `.isCheckmate()`, `.attackers()` or by scanning `.moves({verbose:true})` from a board where it is the mover's turn again — choose a correct method and test it). Step 4: `npx vitest run` + `npx tsc --noEmit` clean. Step 5: Commit `feat: position facts, spoken move names and hint ladder`.

### Task C3: Coach functions rework (TypeScript)

**Files:** Modify `frontend/src/coach/functions.ts`, `frontend/src/coach/functions.test.ts`.

**Interfaces:**
- `CoachEffects` becomes: `fetchReport(): Promise<Report|null>`; `showPosition(fen, arrows?: Arrow[]): void`; `animateLine(fen: string, ucis: string[], color: string): Promise<void>` (steps the board through moves, drawing each move's arrow); `flashMove(fen, uci): Promise<void>` (red highlight/arrow, then animate the move); `analyze(fen): Promise<{bestUci: string; scoreCp: number; pv: string[]} | null>`. `type Arrow = [string, string, string]` ([from, to, color]). Colors: `BEST = "rgb(40,160,80)"`, `PLAYED = "rgb(200,50,50)"`, `REPLY = "rgb(50,100,210)"` exported constants.
- State: `drill: { tag, example, attempts, hintsGiven, solved, revealed, exploreFen } | null`.
- `FUNCTION_DEFS` (names, in order): `get_report`, `show_mistake`, `start_drill`, `play_move`, `get_hint`, `reveal_answer`, `explain_line`, `try_move`, `reset_position`. Descriptions must state when to use each (see prompt in C4).
- Behaviour:
  - `get_report`: as before, plus each pattern gets `name` and `description` (map in code: hanging_piece "Hanging pieces — leaving a piece where it can be taken for free"; missed_tactic "Missed tactics — a capture or check that wins material was available"; opening_error "Opening mistakes — in the first 10 moves"; endgame_technique "Endgame technique — with few pieces left"; time_trouble "Time trouble — under 30 seconds on the clock"; other "Uncategorized middlegame mistakes — positional or strategic errors no rule matched") and `named: tag !== "other"`.
  - `show_mistake`: as before but returns `playedSpoken`, `bestSpoken` (from `spokenMove`) instead of SAN, and arrows (played red, best green).
  - `start_drill(tag)`: picks next undrilled example; resets drill state; `exploreFen = example.fen`; shows position with no arrows; returns `{status, side, moveNumber}` — never the answer.
  - `play_move(move)`: requires a drill. Illegal → `{verdict:"illegal", reason}`. Legal → `attempts += 1`; awaits `flashMove(fen, uci)` then resets the board to the drill position unless best. Best → `solved = true`, returns `{verdict:"best", spoken, attempts, facts: describeMove(...)}` and leaves the move on the board. Otherwise → `{verdict, spoken, attempts, hintsGiven, hintsRemaining: 3 - hintsGiven, facts: describeMove(...)}` and **no answer**. `repeated_mistake` is reported as such (the player repeated their game move).
  - `get_hint()`: requires a drill; returns the next ladder step `{hint, level: 1..3, hintsRemaining}`; after 3 → `{hint: null, message: "No hints left. Offer to reveal the answer."}`. Highlights the piece's from-square after level 2 (arrow-free square highlight via `showPosition` arrows from==to is not allowed; use an arrow only at level 3: green from→to).
  - `reveal_answer()`: requires a drill; `revealed = true`; shows green best arrow and red game-move arrow; returns `{bestSpoken, gameMoveSpoken, cpl, facts: describeMove(best)}`.
  - `explain_line(plies = 6)`: requires a drill or a shown example; line = `example.pv` if non-empty else `(await analyze(fen))?.pv ?? []`; awaits `animateLine(fen, line.slice(0, plies), BEST)`; returns `{line: lineFacts(...) mapped to {ply, side, spoken, captured, check, fork}, materialBefore: material(fen).diff, materialAfter, note: "Explain using only these facts."}`.
  - `try_move(move)`: requires a drill; parses `move` against `exploreFen` (illegal → `{verdict:"illegal", reason}`); awaits `flashMove`; then `analyze(fenAfter)`; if a reply exists, animates it (REPLY color) and sets `exploreFen` to the position after the reply; returns `{yourMove: spoken, engineReply: spoken | null, evalForYou: number | null (centipawns from the player's perspective = -scoreCp of the side to move after your move), material: material(...).diff}`.
  - `reset_position()`: `exploreFen = example.fen`; shows it; returns `{status: "Back to the drill position"}`.
- [ ] Step 1: Rewrite tests first: keep the get_report/show_mistake/start_drill coverage (updated for spoken fields), and add: multiple attempts (wrong, wrong, best → attempts 3, solved); a wrong attempt never includes the best move anywhere in its JSON; hint ladder progression and exhaustion; reveal returns spoken best and game move; explain_line uses `example.pv` and calls `animateLine` with it, and falls back to `analyze` when pv is empty; try_move returns the engine reply spoken and an eval sign that is correct from the player's perspective (fake `analyze` returning `scoreCp: -150` for the opponent → `evalForYou: 150`); reset_position restores the drill FEN; all drill functions without a drill return `{error: "no drill in progress; call start_drill first"}`. Fake effects record calls.
- [ ] Step 2–4: failures → implement → `npx vitest run` and `npx tsc --noEmit` clean.
- [ ] Step 5: Commit `feat: coach mode functions — hint ladder, reveal, explain line, explore`.

### Task C4: Board animation, arrows, report table, coaching prompt

**Files:** Modify `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/voice/settings.ts`, `frontend/src/voice/settings.test.ts`, `frontend/vite.config.ts` (if not done in C1).

- App effects implement C3's `CoachEffects`: `showPosition` sets FEN + arrows; `flashMove` draws a red arrow and highlights from/to for 600 ms, then sets `fenAfter`; `animateLine` steps through moves every 900 ms with the given color arrow for the current move; `analyze` POSTs `/engine/analyze` and returns null on non-200. react-chessboard 4.7.3: use `customArrows` and `customSquareStyles` (check the .d.ts). Animations must not overlap: queue them (await the previous) and cancel the queue on `reset_position`, `start_drill` or Stop.
- Report table: semantic `<table>` with columns Pattern (friendly name, description as smaller text), Mistakes, Avg loss, Examples, Actions (Show / Drill); "other" row last and visually muted; sorted named patterns first by count.
- Prompt (replace the body of `prompt(username)`), covering exactly these rules: coach "<username>" by voice, concise (1–3 sentences), Socratic; call `get_report` before discussing habits; when asked for the worst habit, lead with the largest pattern where `named` is true, mentioning "uncategorized" mistakes only as context; in a drill, never reveal the best move until hints are exhausted or the player says they don't know / asks to see it; after a wrong attempt, ask a guiding question or offer `get_hint`; on "why" or "show me", call `explain_line` and narrate the line using only the returned facts; when the player says a move to explore ("what if…", "play…"), call `try_move`; stay on the current position until the player asks to move on; read move names only from `spoken`/`*Spoken` fields, never convert notation yourself; never state an evaluation or best move that did not come from a function result.
- Settings test: assert the prompt contains `get_hint`, `explain_line`, `try_move`, `spoken`, and that the nine function names are declared in order.
- Steps: update tests → implement → `npx vitest run`, `npm run build` clean → headless check that `/engine` proxies (`curl -X POST localhost:5173/engine/analyze` with the start FEN returns 200 when the backend is up; skip if backend down and say so) → commit `feat: coach mode board animation, arrows, report table and coaching prompt`.
