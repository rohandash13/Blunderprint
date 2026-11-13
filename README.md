# Blunderprint

**Live demo:** https://useblunderprint.vercel.app (voice needs a microphone; try `Knight_ofthelight73`)

Finds the chess mistakes a player keeps repeating, then coaches them through those positions by voice.

Give it a Lichess username. It downloads the player's games, runs every position through Stockfish, scores each
mistake with a neural network trained on how players at that rating actually move, groups the mistakes into
patterns (hanging pieces, missed tactics, endgame technique, ...), and opens a voice coach that drills the player
on their own positions.

## Architecture

```
            Lichess API
                 │
   ┌─────────────▼──────────────┐      ┌──────────────────────────┐
   │ Java 21 · Spring Boot      │ HTTP │ Python · FastAPI · PyTorch│
   │  ingest → job queue        ├─────►│  /analyze: p(move|rating)│
   │  Stockfish worker pool     │      │  + rule-based tags       │
   │  scoring · report · engine │      └──────────────────────────┘
   └──────┬──────────────▲──────┘
          │ JDBC         │ REST (/players, /engine, /voice/token)
   ┌──────▼──────┐  ┌────┴──────────────────────────────────────┐
   │ PostgreSQL  │  │ React · TypeScript · chess.js             │
   │ games, moves│  │  report table, animated board              │
   │ job queue   │  │  Deepgram Voice Agent (browser WebSocket) │
   │ eval cache  │  └───────────────────────────────────────────┘
   └─────────────┘
```

- **Analysis pipeline (Java).** Games are replayed into positions; each unique position becomes a job in a
  Postgres queue (`FOR UPDATE SKIP LOCKED`). A pool of Stockfish workers drains it and writes to a shared
  `eval_cache` keyed by position, engine version, depth and MultiPV, so repeated positions are never re-analyzed.
  Centipawn loss is computed per move once all evaluations are in.
- **Move model (Python).** A rating-conditioned residual CNN (board planes + rating embedding → from-to moves)
  predicts what a player at a given rating would play. A mistake the model rates as *likely* for the player's
  rating is a habit worth drilling, not a one-off.
- **Voice coach (React + Deepgram).** The browser talks to Deepgram's Voice Agent API directly with a short-lived
  token minted by the backend. The LLM never judges chess: eleven client-side functions (`play_move`,
  `get_hint`, `explain_line`, `try_move`, ...) compute verdicts, hints and engine lines in code and hand the
  agent facts to narrate. Hints follow a ladder (idea → piece → square); the answer is revealed only when the
  player asks.
- **Difficulty, measured by the engine and judged against the player's rating.** Mistakes are graded by the drop
  in winning chances (the Lichess win-chance curve), so a quiet positional error counts and a 20-pawn swing in an
  already-won game doesn't dominate. For each repeatable mistake, one MultiPV-2 Stockfish search records the
  shallowest depth from which the engine stops changing its mind, whether the best move is the only good one, and
  whether it simply wins free material. That gives an estimated rating at which players usually find the move;
  levels compare it with the player's own rating (slip: they should see it; deep: a stretch). An earlier version
  used the move model's probability here and rated a free-queen capture as "deep" (the model gave it 0.3%); the
  engine trace puts it at about 900 Elo, a slip for a 2400 player. Each mistake belongs to one primary pattern,
  including a new **positional** pattern; clock errors stay out of drills; and the coach describes difficulty in
  words ("a quiet positional move, the kind that's hard to find even at your level"), never percentages.
- **Line playout.** Every move the player suggests plays on the board, followed by up to 9 plies, ending with you to move, of the engine's
  best line (blue for the opponent, green for the player) and a plain-language eval ("Your opponent has a clear
  edge, about 2 pawns"). ◀ ▶ and the arrow keys step through it; so does saying "go back".

## Results

Every number below is produced by a script in this repo; the output files are in `results/`.

| What | Result | Reproduce |
|------|--------|-----------|
| Move prediction, masked top-1 on 50K held-out positions from 2026-10 (player-disjoint split, 5M training positions) | **43.85% CNN** vs 35.21% retrained MLP vs 26.28% deployed MLP vs 6.78% uniform; CNN wins every rating bucket | `cd ml && python -m blunderprint_ml.evaluate --data data/lichess_2026-10 --ckpt mlp_2016=checkpoints/mlp.pt --ckpt mlp_2026=checkpoints/mlp_2026.pt --ckpt cnn=checkpoints/cnn.pt` → `results/model_eval.json`; rebuild/training commands in [ml/EXPERIMENT.md](ml/EXPERIMENT.md) |
| Analysis throughput, 30 games at depth 12 | **44 → 120 positions/sec** from 1 to 8 workers | `python scripts/loadtest.py` → `results/loadtest_batched.json` |
| Batched DB writes | database share of worker time **26% → 9%** | `results/loadtest_timing.json` vs `results/loadtest_batched.json` |
| Difficulty of a 2400+-rated blitz player's 77 repeatable mistakes | of the 63 the engine trace could rate: **56%** slips, 30% tricky, 14% deep for that rating; **75%** of all 77 have a quiet, non-tactical best move | `curl -X POST localhost:8080/admin/players/Knight_ofthelight73/rescore`, then `python scripts/difficulty_report.py --username Knight_ofthelight73` → `results/difficulty_levels.json` |

## Running locally

Requirements: Docker, JDK 21, Maven, Python 3.11+, Node 20+, a Stockfish binary, and a Deepgram API key with
the Member role (for voice).

```bash
docker compose up -d postgres
```

```bash
cp .env.example .env   # then set DEEPGRAM_API_KEY
```

Model service (port 8000):

```bash
cd ml && pip install -e ".[dev,train]" && MODEL_CKPT=checkpoints/cnn.pt uvicorn blunderprint_ml.service:app --port 8000
```

Backend (port 8080):

```bash
cd backend && STOCKFISH_PATH=/path/to/stockfish mvn spring-boot:run
```

Frontend (port 5173):

```bash
cd frontend && npm install && npm run dev
```

Analyze a player, then open http://localhost:5173, load their report and press **Start voice**:

```bash
curl -X POST localhost:8080/analysis -H "Content-Type: application/json" -d '{"username":"SOME_USER","maxGames":100}'
```

## Tests

```bash
cd backend && mvn test
```

```bash
cd ml && pytest
```

```bash
cd frontend && npm test
```

## Deployment

Vercel (React frontend, `frontend/`, rewrites `/players`, `/engine`, `/voice` to the API) -> Render web service
(Spring Boot + Stockfish, `backend/Dockerfile`) -> Render private service (PyTorch model, `ml/Dockerfile`) ->
Neon Postgres. `render.yaml` is the Blueprint for both Render services.

- Backend env: `DATABASE_URL` (Neon `postgresql://user:pass@host/db?sslmode=require`), `DEEPGRAM_API_KEY`,
  `MODEL_HOSTPORT` (set from the model service), `DEMO_MODE`, `WORKERS_COUNT`, `JAVA_OPTS`.
- `DEMO_MODE=true` returns 403 for `/admin/**` and `POST /analysis`, and `GET /voice/token` is rate-limited
  (`voice.rate.per-ip-per-hour`, default 20, and `voice.rate.per-day`, default 300).


## Layout

```
backend/   Spring Boot service: ingest, queue, Stockfish workers, scoring, reports, engine + voice endpoints
ml/        dataset builder, model training/evaluation, FastAPI inference service
frontend/  React voice coach
scripts/   load tests and profiling that produce results/
docs/      design specs and implementation plans
```
