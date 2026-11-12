# Coach Mode v2 — Difficulty Levels, Full Line Playout, Clean Transcript

**Date:** 2026-11-11
**Status:** Approved design
**Builds on:** `2026-11-10-voice-coach-design.md`, `plans/2026-11-11-coach-mode.md`

## Problem

Live test with `Knight_ofthelight73` (Lichess blitz ~2500, rapid ~2480) showed three gaps:

1. **The coach leads with trivial mistakes.** Examples are ranked by centipawn loss only, so the first drill
   for a 2400+ player was a missed free queen. That is usually a time-pressure slip, not a habit worth
   coaching. Mistakes have no notion of difficulty.
2. **Suggested moves don't play out.** A wrong drill attempt flashes the move and snaps back to the start
   position; `try_move` shows only one engine reply. The player wants every move they suggest played on the
   board, followed by the engine's continuation to the end of the line, then the eval and a justification.
3. **The transcript shows mishears and blanks.** "drill me" was transcribed and displayed as "Drove me";
   empty `You:` lines appear.

## Goals

- Every analyzed move carries a **difficulty**: how findable the best move was for a player at that rating.
- The player picks a **challenge level** (Slips / Tricky / Deep); report, drills and "worst habit" answers
  follow it. Default is **Tricky + Deep**.
- Every move the player suggests plays out on the board with the engine continuation, ending in a plain-
  language eval and fact-grounded justification. The player can step back and forward through it.
- The transcript displays clean text: no empty lines, near-miss commands corrected, spoken moves in SAN.

## Non-goals

- Multi-variation trees (MultiPV). One engine line per suggested move.
- Changing what the LLM hears — transcript cleanup is display-only.
- Retraining the model.

## 1. Difficulty data

**Definition.** `p_best` = the move model's probability, conditioned on the mover's rating, of the
engine's best move in the position (same masked softmax already used for `p_played`). Low `p_best` means
few players at that rating find the move.

**Levels** (relative to the player). Let `C` be the non-null `p_best` values of the run's candidate mistakes
(`cpl >= report.mistake-cpl` and `p_played >= report.min-p-played`), sorted ascending, `n = |C|`. Cutoffs are
the tertiles of `C`: `deepMax = C[floor(n/3)]`, `slipMin = C[floor(2n/3)]` (for `0 < n < 3` there is nothing to split, so every rated candidate is `tricky`;
for `n = 0` every level is `unrated`, and the report then also lists unrated rows so patterns are not empty).

| Level  | Rule                         | Meaning                                       |
|--------|------------------------------|-----------------------------------------------|
| slip   | `p_best >= slipMin`          | Among this player's easier mistakes           |
| tricky | `deepMax <= p_best < slipMin`| Middle third                                  |
| deep   | `p_best < deepMax`           | Among this player's hardest mistakes          |

Why relative: candidates are pre-selected for high `p_played`, which squeezes `p_best` toward 0, and the MLP
cannot calculate, so tactical best moves get tiny probabilities. On real data (a 2500-rated player, 71
candidates) fixed cutoffs put 80% of mistakes in "deep". Levels use only the *ordering* of `p_best`
within the player's own mistakes (the absolute value is compressed, and the ordering is not validated as a
find rate), so no level claims a population find rate.

Each example also carries `harderThanPercent = round(100 * #{c in C : c > p_best} / n)` (null when `p_best`
is null or `n = 0`).

Rows with `p_best` null (best move unknown) have level `unrated`.

**ML service.** `POST /analyze` adds `p_best: float | null` to each `MoveOut` (null when `best_uci` is
null). Computed in the same batched forward pass as `p_played` (new `p_moves_batch` returning probabilities
for an arbitrary move per board; `p_played_batch` becomes a thin wrapper).

**Backend.**
- Flyway `V2__p_best.sql`: `alter table move_analysis add column p_best double precision;`
- `ModelClient.MoveOut` gains `@JsonProperty("p_best") Double pBest`; `AnalysisService` writes it alongside
  `p_played`.
- **Backfill:** `POST /admin/players/{username}/rescore` rescores the whole latest DONE run through the
  existing `ModelClient` and returns `{rescored}`. Idempotent. `/admin/**` is unauthenticated and must not be
  exposed publicly (deployment will gate it).
- `GET /players/{u}/mistakes` rows carry `level` / `harderThanPercent` only for candidate mistakes
  (`cpl >= mistake-cpl` and `p_played >= min-p-played`); both are `null` otherwise.
- `Difficulty` value class maps `p_best` → level using per-run tertile cutoffs (single source of truth for the
  backend; the frontend receives the level string, never recomputes it).

**Reproducibility.** `scripts/difficulty_report.py --username U` reads Postgres and writes
`results/difficulty_levels.json`: per-level count, share, average CPL, and per-tag breakdown. Used to sanity-
check levels (each should hold roughly a third of candidate mistakes).

## 2. Challenge level

**API.** `GET /players/{u}/report?levels=tricky,deep` (default `tricky,deep`; accepts any subset of
`slip,tricky,deep,unrated`; unknown value → 400).
- Pattern counts, averages and examples are computed over the selected levels only.
- `Report` gains `levelCounts: {slip, tricky, deep, unrated}` (over all candidate mistakes — the same
  `cpl`/`p_played` base the patterns use — ignoring the level filter) and `levels`
  (the applied filter).
- `Example` gains `pBest` (nullable), `level` and `harderThanPercent` (nullable).
- Within a pattern, examples sort by `cpl * (1 - p_best)` descending (costly *and* hard first), ties broken
  deterministically as today. Null `p_best` treated as 0.5 for sorting.

**UI.** Toggle chips **Slips · Tricky · Deep** above the report table, each showing its count; default
Tricky + Deep on. Changing chips refetches the report and resets drill state. Table gains a **Difficulty**
column (level of the pattern's first example plus "harder than N% of your mistakes" from `harderThanPercent`). Selecting zero chips is not
allowed (last chip can't be turned off).

**Coach.** `CoachState` holds `levels`; `fetchReport` passes them. `get_report` result includes `levels`
and `levelCounts`; `show_mistake`/`start_drill` results include `level` and `harderThanPercent`.
Prompt additions: name the active level when summarizing ("among your hardest mistakes");
if the player asks for easier/harder positions, call new function `set_levels({levels: string[]})`, which
updates state and the chips, refetches, and returns the new counts.

## 3. Full line playout

Applies to `play_move` (every verdict except illegal) and `try_move`.

**Flow.**
1. Flash the player's move red (existing `flashMove`), then leave it played.
2. If the move gives mate, stop: eval = mate.
3. Otherwise `fx.analyze(fenAfter)`; take the engine `pv`, cap at `PLAYOUT_PLIES = 9`, drop any illegal
   tail (existing `afterMove` null check). The line must end with the drill side to move: after the player's
   move it runs opponent, player, ... so the ply count is odd; if truncation leaves it even, the last ply
   is dropped. "You" is always the side to move in the drill start position.
4. Animate the line ply by ply with arrows: opponent moves in `REPLY` (blue), player-side moves in `BEST`
   (green). 900 ms per ply as today.
5. Result includes `line` facts (`lineFacts` over the played pv: spoken move, capture, check, fork per ply),
   `materialBefore/After`, `evalForYou` (cp from the player's side) and `evalSpoken` from new
   `describeEval(cp, mate)` in `facts.ts`:
   - |cp| < 50 → "roughly equal"; 50–149 → "a slight edge"; 150–299 → "a clear edge, about
     <round(cp/100)> pawn(s)"; 300–699 → "a winning edge, about <round(cp/100)> pawns"; ≥ 700 → "completely
     winning"; mate → "mate in N".
   - Sign phrased for the player: positive → "You have …", negative → "Your opponent has …"; equal band
     has no side.

**Hint integrity.** Until the drill is solved or revealed, the engine line shown after a wrong `play_move` or any
`try_move` is cut before the first player-side ply whose from→to matches the drill answer, so a wrong attempt
never shows the answer. A `best` verdict is never cut. No change to hint/reveal rules.

**Stepping and exploring.** Stepping (◀ ▶, keys, `step_line`) always moves `exploreFen` to the stepped frame.
`try_move` refuses when it is the opponent's move there, when the game is over, or when the last playout had no
engine reply (each with its own message); "reset" returns to the drill position.

**After playout.** Board stays on the final position. `d.exploreFen` = final FEN for `try_move`; for
`play_move` wrong attempts the next attempt resets to the drill start automatically (attempts are always
judged from the start FEN).

**Stepping.** New `LineHistory` (in `coach/lineHistory.ts`): `{ fens: string[], arrows: Arrow[][], index }`
recorded by `animateLine`/`flashMove`. UI **◀ ▶** buttons and ←/→ keys move `index` and call
`showPosition` without cancelling the history. Voice: new function `step_line({direction: "back" |
"forward" | "start" | "end"})`. Any new playout replaces the history.

**Engine unavailable.** Move still plays; result has `engineLine: null, note: "No engine line available"`;
prompt already forbids inventing evals.

**Prompt changes.** Replace the play_move verdict guidance with: after any playout, narrate in 1–3
sentences using `line` facts and `evalSpoken`, then (for wrong attempts) ask a guiding question. Never say
the drill's best move while hints remain.

## 4. Transcript cleanup (display only)

New `voice/transcript.ts`, `cleanUserLine(text): string | null`, applied when appending `ConversationText`
with `role === "user"`:
- Trim; return null (don't render) for empty or punctuation-only text.
- **Command correction:** if the utterance has ≤ 4 words, compare (lowercased, punctuation stripped) against
  `COMMANDS = ["drill me", "show me", "give me a hint", "i don't know", "next one", "go back", "reset",
  "show me the answer"]` with Levenshtein distance, considering only commands with the same first letter;
  if the best match has distance ≤ 3 and ≤ 40% of its length, display the command text. "drove me" →
  "drill me" (distance 3/8); "tell me" is left alone (different first letter).
- **Move rendering:** if `parseMove(currentFen, text)` yields a unique legal move, display its SAN
  (`king d five` → `Kd5`).
- Otherwise display the original text unchanged.
Add `"hint"`, `"reveal"`, `"reset"` to `KEYTERMS` to improve recognition at the source.

## 5. Errors & testing

**Errors.** Rescore with the model service down → 503 `{"error":"model service unavailable"}` (fixed text, exception logged).
`levels` param invalid → 400. Missing `p_best` → `unrated`, excluded by default (exception: when no candidate in the run has a `p_best`, unrated rows are shown so the report is not empty). Report for a run with no
`p_best` at all → `levelCounts.unrated` = all mistakes, coach told "difficulty not computed yet".

**Tests.**
- Python: `p_moves_batch` matches `p_played_batch` for the played move; `/analyze` returns `p_best` and null
  when `best_uci` absent.
- Backend (Testcontainers): V2 migration applies; `Difficulty` tertile cutoffs (`n < 3` → all tricky, `n = 0` → unrated rows shown);
  report `levels` filtering, `levelCounts`, example sort, 400 on bad level; rescore is idempotent; mistakes
  rows are null-level for non-candidates.
- Frontend (Vitest): `describeEval` bands and signs; playout result shape for wrong/best/try_move, cap at
  9 plies ending with the player to move, illegal-tail truncation, wrong-attempt line cut before the answer, engine-down path; `LineHistory` stepping and replacement; `set_levels`
  and `step_line`; `cleanUserLine` (empty → null, "Drove me." → "drill me", long sentence untouched, move →
  SAN).
- Manual: live voice retest with `Knight_ofthelight73` — default drill is tricky/deep, wrong attempt plays
  the refutation with eval, ◀ ▶ works, "drove me" displays as "drill me".
