# Blunderprint

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
- **Move model (Python).** A rating-conditioned MLP (772 board features + rating embedding → 4096 from-to moves)
  predicts what a player at a given rating would play. A mistake the model rates as *likely* for the player's
  rating is a habit worth drilling, not a one-off.
- **Voice coach (React + Deepgram).** The browser talks to Deepgram's Voice Agent API directly with a short-lived
  token minted by the backend. The LLM never judges chess: nine client-side functions (`play_move`,
  `get_hint`, `explain_line`, `try_move`, ...) compute verdicts, hints and engine lines in code and hand the
  agent facts to narrate. Hints follow a ladder (idea → piece → square); the answer is revealed only when the
  player asks.

## Results

Every number below is produced by a script in this repo; the output files are in `results/`.

| What | Result | Reproduce |
|------|--------|-----------|
| Move prediction, top-1 on 50K held-out positions (player-disjoint split, 500K training positions) | **27.1%** MLP vs 21.1% linear vs 6.9% uniform | `cd ml && python -m blunderprint_ml.evaluate` → `results/model_eval.json` |
| Analysis throughput, 30 games at depth 12 | **44 → 120 positions/sec** from 1 to 8 workers | `python scripts/loadtest.py` → `results/loadtest_batched.json` |
| Batched DB writes | database share of worker time **26% → 9%** | `results/loadtest_timing.json` vs `results/loadtest_batched.json` |

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
cd ml && pip install -e . && MODEL_CKPT=checkpoints/mlp.pt uvicorn blunderprint_ml.service:app --port 8000
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

## Layout

```
backend/   Spring Boot service: ingest, queue, Stockfish workers, scoring, reports, engine + voice endpoints
ml/        dataset builder, model training/evaluation, FastAPI inference service
frontend/  React voice coach
scripts/   load tests and profiling that produce results/
docs/      design specs and implementation plans
```
