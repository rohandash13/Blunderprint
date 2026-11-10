# Blunderprint Voice Coach — Design

**Date:** 2026-11-10
**Status:** Approved in conversation; pending written-spec review
**Builds on:** `2026-11-08-blunderprint-design.md` (needs plan Task 17, the report endpoint)

## Goal

Let a player talk to their Blunderprint report and drill their recurring mistakes by voice, using Deepgram's Voice Agent API. The feature should demonstrate a fast, reliable real-time voice AI tool, with a measured latency number that a script reproduces.

## Scope (v1)

1. **Report Q&A.** "What's my worst habit?" The agent fetches the report, answers aloud, and the board jumps to an example position.
2. **Drill.** "Drill me on hanging pieces." The board shows one of the player's past mistake positions with their move hidden; the player says a move; code (not the LLM) judges it; the agent responds.

Out of scope for v1: accounts/auth, mobile layout polish, playing full games by voice, server-side (Deepgram-called) functions, persisting drill history across sessions.

## Architecture

```
Browser (React + Vite + TypeScript)                    Deepgram Voice Agent
 ├─ Board, transcript, drill panel                     wss://agent.deepgram.com/v1/agent/converse
 ├─ mic audio (linear16) ─────── direct wss ─────────►  listen: deepgram nova-3
 ├─ ◄──────── agent audio + JSON events ──────────────┤ think:  managed LLM (config)
 └─ client-side function calls ──► Java API            speak:  deepgram aura voice (config)
                                    ├─ GET /voice/token
                                    └─ GET /players/{username}/report  (Task 17)
```

- **The Deepgram API key lives only in the Java backend**, read from `DEEPGRAM_API_KEY` (repo-root `.env`, git-ignored; `.env.example` is committed). The browser never sees it.
- **`GET /voice/token`** calls `POST https://api.deepgram.com/v1/auth/grant` with `{"ttl_seconds": 30}` and returns `{"token": "...", "expiresIn": 30}`. The token only has to be valid at the WebSocket handshake.
- **The browser connects to Deepgram directly** (no audio relay through our servers), passing the token via the WebSocket subprotocol.
- **All agent functions are client-side** (`client_side: true`): the browser executes them against our Java API and replies with `FunctionCallResponse`. Deepgram cannot reach localhost, so server-side functions are out of scope.
- **The Python model service is unchanged.** The voice layer only reads finished reports.

## Components

### Backend (Java)
- `voice/DeepgramTokenClient` — calls the grant endpoint with the API key; connect timeout 5 s, read timeout 10 s.
- `api/VoiceController` — `GET /voice/token`. Missing key or Deepgram error → `503` with `{"error": "..."}`.
- Config: `deepgram.api-key: ${DEEPGRAM_API_KEY:}`, `deepgram.base-url: https://api.deepgram.com`. Local runs load the repo-root `.env` via `spring.config.import: optional:file:.env[.properties],optional:file:../.env[.properties]` (works whether the backend starts from the repo root or from `backend/`); a real `DEEPGRAM_API_KEY` environment variable still wins.
- CORS: allow the Vite dev origin (`http://localhost:5173`) for `/voice/**` and `/players/**`.

### Frontend (`frontend/`, React + Vite + TypeScript)
- `chess.js` for move legality/parsing; `react-chessboard` (or equivalent) for the board.
- `voice/agentSocket.ts` — owns the WebSocket: waits for `Welcome`, sends `Settings`, waits for `SettingsApplied`, streams mic audio, plays agent audio, dispatches events, sends `KeepAlive` every 8 s while the mic is muted.
- `voice/settings.ts` — builds the `Settings` message (pure function; tested).
- `voice/functions.ts` — function declarations and handlers (pure where possible; tested).
- `chess/moveParse.ts` — spoken/typed move → legal move (pure; tested).
- `chess/verdict.ts` — judges a drill answer (pure; tested).
- `latency/recorder.ts` — collects `LatencyReport` events and can export them as JSON.
- UI: board, live transcript (from `ConversationText`), mic button with state, drill panel, typed-move fallback, error banner with Reconnect.

## Agent functions

| Function | Arguments | Behavior | Returns |
|---|---|---|---|
| `get_report` | none | Fetches `GET /players/{username}/report` once per session, caches it | Compact JSON: moves analyzed, mistakes, and per pattern: tag, count, avg CPL, number of examples |
| `show_mistake` | `tag`, `index` | Sets the board to that example's FEN, highlights played and best moves | Move number, side, played move and best move (the report stores UCI; the browser converts to SAN with chess.js), CPL, `p_played` |
| `start_drill` | `tag` | Picks an undrilled example for that tag, sets the board, hides the answer | `"Position ready, <side> to move"` — never the answer |
| `play_move` | `move` (string) | Parses with chess.js against the drill position; animates if legal | `{verdict, san, reason?}` with verdict one of `illegal`, `best`, `repeated_mistake`, `other` |

Verdict rules (`chess/verdict.ts`): `illegal` if not a legal move; `best` if it equals the example's best move; `repeated_mistake` if it equals the move the player actually played; otherwise `other`. Comparison is on from-square, to-square and promotion piece.

The username is set in the UI before the session starts and is not a function argument (the LLM cannot switch users).

**Design rule: the LLM never judges chess.** Legality, best-move matching and repetition are decided by code and by Stockfish data already in the report. The LLM only routes to functions and phrases results.

## Agent configuration

- `listen`: Deepgram `nova-3`, with chess keyterms (piece names, "takes", "castle", "check", file letters) to reduce misrecognition. The exact keyterm field name is confirmed against Deepgram's docs during implementation; if unsupported in the agent API it is dropped, not faked.
- `think`: managed provider, model from config. Default `gpt-4o-mini` (the model Deepgram's own examples use). Reasoning ("Thinking") models are excluded for latency.
- `speak`: a Deepgram Aura voice, from config.
- Prompt: short coaching persona; must call `get_report` before discussing the player; must use `play_move` for any move the player says; must never state a chess evaluation that did not come from a function result.
- Audio: `linear16` at 24 kHz in and out.

## Error handling

| Failure | Behavior |
|---|---|
| Token endpoint fails (no key / bad key / Deepgram down) | Backend `503` with message; UI shows "Voice unavailable"; board and typed moves still work |
| Deepgram `Error` event or socket close | Banner with the error; mic stops; one Reconnect button that fetches a fresh token |
| No report for the user | `get_report` returns `{"error": "no report yet"}`; prompt tells the agent to say so and not invent patterns |
| Unparseable or illegal spoken move | `play_move` returns `illegal` with a reason; agent asks the player to repeat |
| A function handler throws | Browser still sends a `FunctionCallResponse` whose content is `{"error": "..."}` so the agent never waits forever |
| `FunctionCallCancelled` | Pending call is dropped; no response is sent |
| Session nearing the 2-hour cap | Warning shown; user can reconnect |

## Testing

- **Java (JUnit):** `VoiceController`/`DeepgramTokenClient` against a stubbed grant endpoint (same `MockRestServiceServer` pattern as `ModelClientTest`): success, missing key → 503, upstream error → 503. No real Deepgram calls in the suite.
- **Frontend (Vitest):** `moveParse` ("knight f3", "Nf3", "e takes d5", "castle kingside", garbage), `verdict` (all four outcomes, promotions), function handlers against a fixture report (including no-report and thrown-error paths), and the `Settings` builder.
- **Manual:** one live voice session with the real key, run with the user, checking Q&A, drill, typed fallback and Reconnect.

## Latency measurement

- The UI records every `LatencyReport` (`stt_latency`, `ttt_*`, `tts_latency`, `total_latency`, in seconds) and exports them as JSON.
- `scripts/voice_latency.py` turns exported sessions into p50/p95 per component and per model, writing `results/voice_latency.json`.
- **Model bake-off:** the same scripted 10-question session on `gpt-4o-mini`, `gpt-5.4-mini` and `claude-haiku-5-5`; compare total latency and whether each turn called the expected function. The default model becomes the winner.
- Project rule applies: no latency number is claimed unless the script reproduces it from saved session files.

## Build order

1. Plan Task 17 (report endpoint) — the agent needs something to talk about.
2. Token endpoint (Java) + `.env` loading + CORS.
3. Frontend scaffold: board, username input, report fetch, typed moves.
4. Voice connection: token → socket → Settings → mic/audio → transcript.
5. Agent functions and drill.
6. Latency recorder, script, and bake-off.

## Open items to confirm during implementation

- The browser subprotocol format for passing a grant token (expected `["bearer", token]`); confirm against Deepgram's browser docs or SDK source before relying on it.
- The keyterm field name for `nova-3` inside the agent `listen` provider.
- A currently available Aura voice model id.
- Whether managed LLM usage is billed to the Deepgram account (affects only cost, not design).
