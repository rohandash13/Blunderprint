# Chess Coach: Design Doc

Status: draft for review · Date: 2026-11-08 · Owner: Rohan Dash
Working name: **Blunderprint** (rename freely)

## 1. One-sentence pitch

Find the mistakes a chess player keeps repeating, by analyzing thousands of their games at scale and comparing what they *tend* to play against what is actually best.

## 2. Why this project (resume goal)

Target: SWE internships / new-grad roles at large tech companies.

A scan of Google, Microsoft, Amazon, NVIDIA and Meta postings showed these recurring asks: data structures and algorithms, Java/Python/C++, concurrency and distributed systems, "design and implement a complex system", plus cloud, databases and prior project/internship experience.

The current resume already covers Python, AWS/Azure, SQL, LLM tooling and internships. It does **not** yet show concurrency, distributed-systems design, or a performance-measured backend. This project is built to fill that gap, with the ML model as the original, demo-able layer on top.

Success = a repo and 3 to 4 resume bullets backed by **measured** numbers (see section 9), in a story that reads as one system, not a list of technologies.

## 3. Scope

### Goals
- A Java backend that ingests a player's games, fans out engine analysis across a pool of workers, caches results, and serves a report.
- A Python service that predicts what a player at a given rating is likely to play, plus the analysis that turns engine output into a "recurring mistakes" report.
- Honest, reproducible measurements: throughput scaling, cache effectiveness, model accuracy vs baseline, and whether the coach's findings predict future mistakes.
- Runs locally with one command (Docker Compose); deployed to AWS at the end.

### Non-goals
- Writing a chess engine. Stockfish is used as an external process.
- A polished consumer product or a rich frontend. Output is a JSON API plus a CLI/notebook report; a minimal web page only if time remains.
- Languages beyond Python and Java in the core (see section 8 for the one conditional exception).
- Real-time/live game coaching.

## 4. Architecture

```
            +--------------------+
Lichess --> |  Ingestion (Java)  |-- games, positions --> Postgres
 API/DB     +--------------------+                          |
                      |                                     |
                      v                                     |
            +--------------------+     job queue            |
            |  Job queue         |<-------------------------+
            |  (Postgres table)  |
            +--------------------+
                      |
          claims jobs | (SKIP LOCKED)
                      v
        +-----------------------------+
        | Worker pool (Java threads)  |   each worker owns one
        | Stockfish via UCI subprocess|   Stockfish process
        +-----------------------------+
                      | eval results (cached by position)
                      v
                  Postgres  <------ batch predict ------>  Python ML service
                      |                                    (FastAPI + PyTorch)
                      v
            +--------------------+
            |  Report builder    |  REST API: /players/{u}/analyze, /report
            +--------------------+
```

### Components

**Java backend (Spring Boot).** Owns ingestion, orchestration, caching and the API.
- *Ingestion:* pulls a player's games from the Lichess public API (polite rate limiting, optional token) and parses PGN into positions. For model training, a separate offline loader reads monthly dumps from the Lichess open database.
- *Job queue:* a Postgres table claimed with `SELECT ... FOR UPDATE SKIP LOCKED`. One fewer moving part than a broker, and it still demonstrates real queue semantics (claim, retry, timeout, idempotency). Swapping to SQS later is optional.
- *Worker pool:* a fixed thread pool; each worker owns one long-lived Stockfish process speaking UCI. Analysis uses a fixed depth or node limit so results are reproducible and cacheable.
- *Cache:* evaluations keyed by `(normalized FEN, engine version, depth, multipv)` in Postgres. Repeated positions (openings, common endgames) are free after the first hit.
- *API:* `POST /players/{username}/analyze` starts a job; `GET /players/{username}/report` returns the result; `GET /jobs/{id}` shows progress.

**Python ML + analysis service (FastAPI, PyTorch, python-chess).**
- *Human-move model:* given a position and a rating bucket, outputs a probability distribution over legal moves, i.e. what a player at that level tends to play. Input: board planes (12x8x8 piece placement), side to move, castling/en-passant flags, rating bucket. Output: policy over moves.
- *Baselines first:* a trivial baseline (most-played move in that position or "engine's best move") and a simple MLP before the CNN, so the model's value is measured, not assumed.
- *Mistake analysis:* for each move a user played, compute centipawn loss against Stockfish's best line. A move is a **recurring-mistake candidate** when it loses significant eval *and* the model says it is a common human choice at that rating.
- *Pattern tagging:* group candidates into simple, explainable categories (hanging piece, missed tactic, opening-phase error, endgame technique, low-clock move) using rule-based checks on the position, so every tag can be justified.

**Report.** Per player: top recurring mistake patterns, example positions with the played move vs the best move, and eval swing. JSON first; a simple CLI or notebook rendering; a small web page only if time remains.

## 5. Data

| Source | Use | Notes |
|---|---|---|
| Lichess open database (monthly PGN dumps) | Train and evaluate the human-move model | Public, CC0. Use a bounded sample (e.g. a few million positions) to stay within local compute. |
| Lichess public API | Fetch a specific player's games for analysis | Respect rate limits; cache raw games locally. |
| Stockfish (external process) | Position evaluation and best moves | GPLv3; run as a separate process, do not bundle modified code. |

Split by **player/game**, never by position, so train/test leakage doesn't inflate accuracy.

## 6. Key design decisions

1. **Postgres as the queue.** Fewer components, easy local setup, real concurrency semantics. Trade-off: lower throughput ceiling than Kafka/SQS, which is fine at this scale and gets noted in the README.
2. **Fixed-depth analysis.** Deterministic and cacheable. Trade-off: weaker than time-based analysis in sharp positions; depth is configurable and recorded with every cached result.
3. **Model scores moves; Stockfish judges them.** The model never claims a move is "good." It only says what is *likely*. Stockfish says what is *right*. The product is the gap between the two.
4. **Rule-based pattern tags over a learned classifier.** Explainable output and no labeled dataset needed.
5. **Java and Python talk over HTTP.** A simple boundary: Java sends batches of positions, Python returns move probabilities. Batch size is tuned and measured.

## 7. Testing and correctness

- **Unit tests:** PGN parsing, FEN normalization, cache-key construction, centipawn-loss math, tag rules.
- **Queue tests:** concurrent workers never double-claim a job; a crashed worker's job is retried; duplicate submissions are idempotent.
- **Engine integration test:** a handful of known positions with known best moves (mate-in-N puzzles).
- **Model tests:** deterministic seeds, shape checks, and a fixed held-out evaluation script that anyone can rerun.
- **Load test:** a script that analyzes N games with 1, 2, 4, 8 workers and records throughput.

## 8. Conditional Rust component (decide in week 3, not before)

Add a small Rust module (exposed to Python via PyO3) **only if** profiling shows feature preprocessing is the bottleneck of the training loop, for example more than about 40% of wall-clock time. Baseline is python-chess; the module must produce byte-identical feature tensors (verified by a test) and report the speedup.

If profiling shows it is *not* the bottleneck, skip it and record the profile in the README as evidence. The core stack stays Python + Java either way.

## 9. Metrics (the source of resume numbers)

Record these as they are measured. **Do not write any number on the resume that isn't from a rerunnable script in the repo.**

| Metric | How measured |
|---|---|
| Analysis throughput (positions/sec) at 1, 2, 4, 8 workers | Load-test script; plot the scaling curve |
| Cache hit rate and time saved on re-analysis | Counters; run same player twice |
| End-to-end latency for a 100-game player report | Timed run, cold vs warm cache |
| Human-move top-1 accuracy per rating bucket, model vs baseline | Held-out games, split by player |
| **Does the coach work?** Flagged patterns recur in a user's *later* games more than a control rate | Hold out each test player's most recent ~20% of games; compare recurrence of flagged vs unflagged patterns |
| (If Rust is built) preprocessing speedup vs python-chess | Same inputs, wall-clock |

The last "does the coach work" validation is the most valuable result: it moves the project from "I built a pipeline" to "I tested whether it helps."

## 10. Timeline (about 4 weeks)

| Week | Deliverable | Done when |
|---|---|---|
| 1 | Java ingestion + Postgres schema + Stockfish worker pool analyzing one game end to end | A game goes in; per-move evals are stored; tests pass |
| 2 | Job queue, multi-worker concurrency, evaluation cache, load-test script | Scaling curve and cache numbers exist |
| 3 | Python model: data loader, baselines, MLP/CNN, accuracy per rating bucket; profile for the Rust decision | Model beats baseline on a held-out player split |
| 4 | Mistake analysis + tagging, report API, Docker Compose, AWS deploy, README with architecture diagram and results | `docker compose up` works; README tells the story; validation experiment run |

**Cut order if time runs short:** web page, then Rust, then AWS deploy (keep Docker Compose), then CNN (keep MLP). Never cut the measurements.

## 11. Risks

- **Compute for training.** Mitigation: bounded sample, small model, run baselines first.
- **Lichess rate limits.** Mitigation: cache raw games, fetch gradually, use the open dumps for bulk data.
- **Model gains are small.** Mitigation: the project's value does not depend on beating a research model. The baseline-vs-model comparison and the coach validation are reported honestly either way.
- **Scope creep.** Mitigation: the cut order above.

## 12. Resume framing (fill in only with measured numbers)

- Built a Java service that fans out chess-engine analysis across a worker pool with a Postgres-backed job queue and evaluation cache, scaling from `[X]` to `[Y]` positions/sec across `[N]` workers.
- Trained a PyTorch model on `[N]` million Lichess positions to predict human moves by rating, reaching `[X]%` top-1 accuracy vs `[Y]%` baseline.
- Identified recurring mistake patterns per player and validated them on held-out later games: flagged patterns recurred `[X]x` more than control.
- Containerized with Docker Compose and deployed on AWS; README documents architecture, benchmarks and methodology.

## 13. Open questions

- Backend framework: Spring Boot (assumed) vs plain Java with a lightweight HTTP library.
- Target number of training positions, to be set after a first compute test.
- Whether to link this repo from the existing `ai-chess-coach` project as a successor.
