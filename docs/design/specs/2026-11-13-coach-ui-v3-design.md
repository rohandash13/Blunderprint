# Coach UI v3: Profile First, Steps, Coach-Paced Lines, Public Analysis

**Date:** 2026-11-13
**Status:** Approved design (direction chosen: Club Wallchart)
**Product context:** `PRODUCT.md`. **Visual direction contract:** `.impeccable/surfaces/frontend-src-app-tsx.md`.

## Problem

From the live test:
- Entering a username jumps straight into mistakes. There's no overview of who the player is.
- The UI is a single dense page with no sense of steps.
- When the player proposes a move, the whole line plays and the explanation comes at the end. They want one move at
  a time, each pointed out and explained.
- The public demo only works for one pre-analyzed player.

## Goals

1. A guided flow in three steps: **Profile → Choose focus → Drill**. A landing step and an analysis step come
   before them when needed.
2. A player profile first: ratings, record, a written summary, strengths, leaks and the Blunderprint grid. The
   summary is spoken when voice is on.
3. Coach-paced lines: each ply is shown with an arrow and a one-sentence explanation, and the coach (or a Next
   button) advances to the next.
4. Any Lichess username can be analyzed on the public site, within limits.
5. A full visual redesign in the Club Wallchart world.

## 1. Flow and screens

Steps live in a felt-green left rail; at 390 px the rail becomes a top bar. Steps are reachable once unlocked.

- **Landing** (no player yet): username input, "Analyze" button, and a "Try Knight_ofthelight73" link.
- **Analyzing**: progress bar (positions done / total from `GET /analysis/{runId}`), queue position when waiting,
  and an honest time estimate. Polls every 2 s. Errors show plain messages (unknown user, daily limit reached,
  no rated games).
- **Profile** (step 1):
  - Header: name, Lichess, rating chips (bullet/blitz/rapid when present) with their last-90-day change, and games
    analyzed.
  - Written summary of 3–4 sentences.
  - Strengths and leaks.
  - **Blunderprint grid:** pattern rows × recent analyzed games. A marker dot marks each candidate mistake, sized
    by win-drop and coloured by level. A Slips | Tricky | Deep control re-marks the grid live. Clicking a mark
    opens that position in the drill.
  - A "Start with this" card for the recommended pattern.
- **Choose focus** (step 2): one card per pattern with fixed furniture: name plate, one-line description,
  count, last seen, level mix (slips/tricky/deep) and kind split (positional/tactical), plus "Drill" and "Show".
  The level control sits here too.
- **Drill** (step 3):
  - Board on the left (classic colours).
  - Coach panel on the right: the current prompt, the transcript, the typed move input, and the hint, reveal,
    reset and level buttons.
  - Line caption strip under the board, with Prev / Next and a ply counter.

## 2. Profile data

`GET /players/{u}/profile` returns 404 when there's no finished run. The response contains:
- `username`; `ratings`: `{perf: {rating, games, prog}}` from the Lichess public user API
  (`/api/user/{u}`), cached for 10 minutes; null on failure, so the profile still renders.
- `analyzed`: `{games, moves, from, to}`.
- `record`: `{white: {w, d, l}, black: {w, d, l}}` from `game.result` and the player's colour.
- `phases`: candidate-mistake rate per 100 of the player's moves in opening (ply < 20, i.e. fullmove ≤ 10, the tagger's rule), middlegame and endgame
  (≤ 4 non-pawn non-king pieces, the tagger's rule).
- `phaseMoves`: `{opening, middlegame, endgame}`, the player's move counts per phase (same phase rules), so the frontend can ignore phases with tiny samples.
- `kinds`: `{positional, tactical}` counts over candidates.
- `clock`: `{underThirtyShare, mistakeRateUnder30, mistakeRateOver30}`.
- `grid`: up to the 40 most recent analyzed games, oldest to newest. Each entry is
  `{gameId, playedAt, color, result, marks: [{ply, pattern, level, kind, winDrop}]}`, with candidates only and
  the primary pattern.
- `patterns`: `[{tag, count, lastSeen, levels: {slip, tricky, deep, unrated}, kinds: {positional, tactical}}]`.

`GET /players/{u}/positions/{gameId}/{ply}` returns one `Example` (same shape as report examples), so a grid
mark can open in the drill.

**Strengths and leaks** are computed in the frontend (`profileInsights.ts`, pure and tested) from `phases`,
`kinds`, `clock` and `patterns`:
- The lowest-rate phase becomes a strength.
- A pattern with zero or one marks among the tactical patterns becomes "rarely misses forcing wins".
- The highest-rate phase or pattern becomes a leak.
- The clock leak applies when the rate under 30 s is at least 1.5× the rate over it.

**Summary** (`profileSummary.ts`, pure and tested) is built from the same facts, with no numbers beyond counts
and ratings. The same text feeds the screen and the voice coach's `get_profile` function.

## 3. Coach-paced lines

`play_move` (non-illegal) and `try_move` no longer animate the whole line:
- They flash the player's move.
- They compute the engine line (≤ 9 plies, ending with the player to move, answer-cut rules unchanged) and keep it
  as the **pending line**.
- They return `{spoken, verdict, facts, lineLength, evalSpoken, materialForYou, note}` plus `next` = the first
  ply's facts, without animating it yet.

New function `next_move` (no args) animates the next pending ply with a marker-red arrow (the previous arrow
fades) and returns `{ply, total, side, spoken, captured, check, fork, caption, done, evalSpoken?}`:
- `caption` is a deterministic sentence from the facts (`plyCaption.ts`, e.g. "Black takes on d5 with the
  knight, attacking your queen").
- `evalSpoken` is included on the last ply.
- With no pending line it returns an error the coach can say.

Voice prompt: after play_move or try_move, explain the player's move in one sentence. Then call next_move, explain
that move in one sentence using its facts, and keep calling next_move until done or until the player interrupts.
End with evalSpoken. Never explain several moves at once.

Typed/no-voice mode: the caption strip shows each ply's caption, and the **Next ▶** button or → key calls the
same `next_move`. `step_line` and Prev still step back through what has been shown.

## 4. Public analysis

With `DEMO_MODE=true`, `POST /analysis` is allowed and limited by a new `AnalysisGate`:
- `maxGames` is forced to 40.
- If the user has a DONE run less than 7 days old, that `runId` comes back with `reused: true` and nothing new is
  enqueued.
- If another run is RUNNING or SCORING, the request is still accepted. It is queued: ingest runs, and the worker
  pool handles one queue (FIFO).
- The response includes `queuePosition`, which the progress endpoint also returns.
- Global cap: `analysis.max-runs-per-day`, default 40. Per-IP cap: `analysis.max-runs-per-ip-per-day`, default 3.
  Over either cap the response is 429 `{"error": ...}`.
- Unknown Lichess user or no rated games: 404 `{"error": "No rated games found for <u>"}`.
- `/admin/**` stays blocked.
- `GET /players/{u}/status` returns `{status: "none" | "RUNNING" | "SCORING" | "DONE", runId, queuePosition}` so
  the landing step can skip straight to the profile.

## 5. Visual system (Club Wallchart)

The direction contract governs. In short:
- Felt-green rail.
- Cool-white paper panels on a faint cell grid that every region snaps to.
- Ink, marker red and highlighter yellow; a classic board.
- One workhorse UI face; tabular figures; rank by weight and case.
- Standard web controls.

The board keeps react-chessboard with custom square colours. The design hook checks every UI edit.

## 6. Errors and tests

- Profile endpoint: works with Lichess unavailable (ratings null) and with a run that has no candidates (empty
  grid; the summary says so).
- Gate: tests for reuse, queueing, caps (injected clock), and DEMO_MODE on and off.
- Frontend: `profileSummary`, `profileInsights` and `plyCaption` unit tests; `next_move` behaviour (pending line,
  done, no line, interrupts via reset/new move); flow state reducer tests (landing → analyzing → profile → focus
  → drill, unlocks).
- Finish: impeccable finish review on desktop and 390 px screenshots, then DESIGN.md by the documenter.
