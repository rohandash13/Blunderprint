# Blunderprint Implementation Plan

**Goal:** Build a system that analyzes a Lichess player's games at scale (Java + Stockfish worker pool) and uses a Python human-move model to surface the mistakes that player keeps repeating, with measured performance and a validation experiment.

**Architecture:** A Java (Spring Boot) service ingests games, enqueues position evaluations into a Postgres-backed queue (`FOR UPDATE SKIP LOCKED`), and a pool of worker threads (one Stockfish UCI process each) evaluates them into an evaluation cache. A Python (FastAPI + PyTorch) service predicts how likely a player at a given rating is to play each move and tags mistakes with rule-based categories. Java computes centipawn loss, asks Python for probabilities and tags, stores results, and serves a report.

**Tech Stack:** Java 21, Spring Boot 3.3, JdbcTemplate, Flyway, Postgres 16, chesslib, Testcontainers; Python 3.11+, python-chess, PyTorch, FastAPI, pytest; Stockfish (external process); Docker Compose; AWS EC2 (final deploy).

Spec: `docs/design/specs/2026-11-08-blunderprint-design.md`

## Global Constraints

- Core languages are **Python and Java only**. Rust is added only if Task 14's profiling gate says so (Task 21).
- Stockfish runs as an **external process**, fixed depth, `Threads=1` per worker. Never bundle modified Stockfish code.
- Evaluation cache key is `(normalized FEN, engine version, depth, multipv)`. Normalized FEN = first 4 FEN fields.
- Evaluations are stored from the **side-to-move** perspective; mate scores map to `±(10000 - |n|)`; centipawn loss clamps scores to ±1000.
- Dataset splits are **by player** (hash of player name), never by position. A game is used only if both players fall in the same split.
- A "mistake" is `cpl >= 100`. A "recurring-mistake candidate" is a mistake with `p_played >= 0.15` (both configurable).
- Be polite to Lichess: one streaming request at a time, honor 429 by failing loudly, optional token via `LICHESS_TOKEN`.
- **No number goes on the resume unless a script in `scripts/` or `ml/` reproduces it.**
- Everything runs locally with `docker compose up`; AWS deploy is last.

## Deviations from the spec (decided while planning)

- The `time_trouble` tag is kept; it needs Lichess `clocks=true` and a `clock_cs` column.
- Java sends Python each move's data (FEN, played/best move, CPL, clock) and Python returns `p_played` and `tags`. Java owns storage and aggregation.
- Model baselines: uniform-over-legal-moves and a linear model, then an MLP. A CNN is optional (Task 13, last step).
- **Added after measuring (Task 10):** the worker pool claims `workers.batch-size` (default 4) jobs per call and writes their results in one transaction (`JobQueueRepository.completeBatch`), and records engine/claim/complete timings (`/admin/workers/stats`). The baseline showed 7.5 ms of database time per job at 1 worker (about 25% of worker time); batching cut it to about 2 ms and raised throughput 12-28% on the same 3,450 positions. See `results/loadtest_timing.json` (before) and `results/loadtest_batched.json` (after).
- Implementation deviations: (a) the dataset builder skips parsing the moves of games that fall outside the needed splits at the header level, and computes legal masks and legal-move counts (`L`, `nlegal`) only for the eval splits (val/test); (b) the model service returns 422 `{id, reason}` naming the offending move id for invalid input (bad FEN, illegal played or best move); (c) `AnalysisService` marks a run `FAILED` after 3 failed scoring attempts, or immediately on a 4xx from the model service, instead of retrying forever.

## File Structure

```
blunderprint/
  .gitignore
  README.md
  docker-compose.yml
  backend/
    pom.xml
    Dockerfile
    src/main/resources/application.yml
    src/main/resources/db/migration/V1__schema.sql
    src/main/java/com/blunderprint/
      BlunderprintApplication.java
      chess/Fen.java                    # FEN key normalization
      chess/ReplayedMove.java           # record
      chess/GameReplayer.java           # SAN string -> per-ply data
      engine/UciParser.java             # parse "info"/"bestmove" lines
      engine/EngineResult.java          # record
      engine/StockfishEngine.java       # one UCI subprocess
      lichess/LichessGame.java          # record
      lichess/LichessClient.java        # fetch + parse ndjson
      store/Job.java                    # record
      store/JobQueueRepository.java     # enqueue / claim / complete / fail / reap
      ingest/IngestService.java         # games -> moves -> jobs
      worker/WorkerPool.java            # N threads, N Stockfish processes
      analysis/Cpl.java                 # centipawn-loss math
      analysis/AnalysisService.java     # progress + scoring tick
      model/ModelClient.java            # HTTP client to Python
      report/ReportService.java         # aggregation
      api/AnalysisController.java       # REST endpoints
    src/test/java/com/blunderprint/...    # mirrors main
  ml/
    pyproject.toml
    src/blunderprint_ml/
      encoding.py     # board -> 772 features, move -> index
      data.py         # PGN dump -> player-split .npy arrays
      models.py       # Linear, MLP
      train.py        # training loop + checkpoint
      evaluate.py     # per-rating top-1 vs baselines
      tags.py         # rule-based mistake tags
      inference.py    # p_played from model
      service.py      # FastAPI app
    tests/
  scripts/
    loadtest.py
    pick_players.py
    validate_coach.py
    profile_encode.py
  results/            # committed JSON/PNG outputs
```

---

# Phase 0: Scaffold

### Task 0: Repo, Postgres, Spring Boot skeleton, Python skeleton

**Files:**
- Create: `.gitignore`, `docker-compose.yml`, `backend/pom.xml`, `backend/src/main/resources/application.yml`, `backend/src/main/java/com/blunderprint/BlunderprintApplication.java`, `backend/src/test/java/com/blunderprint/PostgresIT.java`, `backend/src/test/java/com/blunderprint/SmokeIT.java`, `ml/pyproject.toml`, `ml/src/blunderprint_ml/__init__.py`, `ml/tests/test_smoke.py`

**Interfaces:**
- Produces: `PostgresIT` abstract base class (singleton Postgres container, Spring context, `workers.autostart=false`) that every later integration test extends.

- [ ] **Step 1: Create the repo and ignore file**

```bash
# repo already exists: cd into your clone of Blunderprint
mkdir -p backend/src/main/java/com/blunderprint backend/src/main/resources/db/migration backend/src/test/java/com/blunderprint ml/src/blunderprint_ml ml/tests scripts results docs/design/specs docs/design/plans
```

`.gitignore`:
```
target/
__pycache__/
*.pyc
.venv/
.pytest_cache/
data/
checkpoints/
*.npy
*.pgn
*.pgn.zst
*.egg-info/
.idea/
```

- [ ] **Step 2: Docker Compose with Postgres only (backend and model services are added in Task 19)**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: chess
      POSTGRES_PASSWORD: chess
      POSTGRES_DB: blunderprint
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chess -d blunderprint"]
      interval: 3s
      timeout: 3s
      retries: 20
```

- [ ] **Step 3: Maven project**

`backend/pom.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
  </parent>
  <groupId>com.blunderprint</groupId>
  <artifactId>backend</artifactId>
  <version>0.1.0</version>
  <properties>
    <java.version>21</java.version>
  </properties>
  <repositories>
    <!-- chesslib is published on JitPack, not Maven Central -->
    <repository>
      <id>jitpack.io</id>
      <url>https://jitpack.io</url>
    </repository>
  </repositories>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-jdbc</artifactId></dependency>
    <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-core</artifactId></dependency>
    <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-database-postgresql</artifactId></dependency>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><scope>runtime</scope></dependency>
    <dependency><groupId>com.github.bhlangonijr</groupId><artifactId>chesslib</artifactId><version>1.3.4</version></dependency>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-test</artifactId><scope>test</scope></dependency>
    <dependency><groupId>org.testcontainers</groupId><artifactId>postgresql</artifactId><scope>test</scope></dependency>
    <dependency><groupId>org.testcontainers</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope></dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin><groupId>org.springframework.boot</groupId><artifactId>spring-boot-maven-plugin</artifactId></plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <configuration>
          <!-- run unit tests (*Test) and integration tests (*IT) with `mvn test` -->
          <includes>
            <include>**/*Test.java</include>
            <include>**/*IT.java</include>
          </includes>
        </configuration>
      </plugin>
    </plugins>
  </build>
</project>
```

`backend/src/main/resources/application.yml`:
```yaml
spring:
  datasource:
    url: ${DB_URL:jdbc:postgresql://localhost:5432/blunderprint}
    username: ${DB_USER:chess}
    password: ${DB_PASSWORD:chess}
  flyway:
    enabled: true
engine:
  path: ${STOCKFISH_PATH:stockfish}
  version: ${ENGINE_VERSION:stockfish-local}
  depth: 12
workers:
  count: 2
  autostart: true
  reaper-timeout-seconds: 120
  max-attempts: 3
lichess:
  base-url: https://lichess.org
  token: ${LICHESS_TOKEN:}
model:
  url: ${MODEL_URL:http://localhost:8000}
report:
  mistake-cpl: 100
  min-p-played: 0.15
```

`BlunderprintApplication.java`:
```java
package com.blunderprint;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class BlunderprintApplication {
    public static void main(String[] args) {
        SpringApplication.run(BlunderprintApplication.class, args);
    }
}
```

- [ ] **Step 4: Failing smoke test and test base class**

`backend/src/test/java/com/blunderprint/PostgresIT.java`:
```java
package com.blunderprint;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest
public abstract class PostgresIT {
    static final PostgreSQLContainer<?> PG = new PostgreSQLContainer<>("postgres:16");
    static { PG.start(); }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", PG::getJdbcUrl);
        r.add("spring.datasource.username", PG::getUsername);
        r.add("spring.datasource.password", PG::getPassword);
        r.add("workers.autostart", () -> "false");
    }

    @Autowired protected JdbcTemplate jdbc;

    @BeforeEach
    void cleanDb() {
        jdbc.execute("TRUNCATE move_analysis, move, analysis_run, game, eval_cache, eval_job RESTART IDENTITY CASCADE");
    }
}
```

`backend/src/test/java/com/blunderprint/SmokeIT.java`:
```java
package com.blunderprint;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

class SmokeIT extends PostgresIT {
    @Test
    void schemaIsMigrated() {
        assertEquals(0L, jdbc.queryForObject("select count(*) from eval_job", Long.class));
    }
}
```

- [ ] **Step 5: Run to verify it fails** (no migration yet)

Run: `cd backend && mvn -q test -Dtest=SmokeIT`
Expected: FAIL (`relation "move_analysis" does not exist` or similar). Task 1 adds the schema, so this test is expected to stay red until then.

- [ ] **Step 6: Python skeleton**

`ml/pyproject.toml`:
```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[project]
name = "blunderprint-ml"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "chess>=1.10",
  "numpy>=1.26",
  "torch>=2.2",
  "fastapi>=0.110",
  "uvicorn>=0.29",
  "pydantic>=2.6",
  "zstandard>=0.22",
  "requests>=2.31",
  "matplotlib>=3.8",
  "psycopg2-binary>=2.9",
]

[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.setuptools.packages.find]
where = ["src"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`ml/src/blunderprint_ml/__init__.py`: empty file.

`ml/tests/test_smoke.py`:
```python
def test_import():
    import blunderprint_ml  # noqa: F401
```

- [ ] **Step 7: Verify Python env**

```bash
cd ml && python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]" && pytest -q
```
Expected: `1 passed`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold backend, ml, compose"
```

---

# Phase 1: Java core, one game analyzed end to end

### Task 1: Database schema

**Files:**
- Create: `backend/src/main/resources/db/migration/V1__schema.sql`
- Test: `backend/src/test/java/com/blunderprint/SmokeIT.java` (from Task 0)

**Interfaces:**
- Produces tables: `game`, `analysis_run`, `move`, `eval_cache`, `eval_job`, `move_analysis`. Later tasks use these exact column names.

- [ ] **Step 1: Write the migration**

```sql
create table game (
  id text primary key,
  white text not null,
  black text not null,
  white_rating int,
  black_rating int,
  perf text,
  result text,
  played_at timestamptz
);

create table analysis_run (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  engine text not null,
  depth int not null,
  status text not null default 'RUNNING',   -- RUNNING | SCORING | DONE
  created_at timestamptz not null default now()
);

create table move (
  id bigserial primary key,
  run_id uuid not null references analysis_run(id),
  game_id text not null references game(id),
  ply int not null,
  fullmove int not null,
  mover text not null,                       -- 'w' | 'b'
  rating int,
  before_fen text not null,
  before_key text not null,
  after_key text not null,
  played_uci text not null,
  played_san text not null,
  clock_cs int,
  unique (run_id, game_id, ply)
);
create index move_run on move (run_id);

create table eval_cache (
  fen_key text not null,
  engine text not null,
  depth int not null,
  multipv int not null default 1,
  best_uci text,
  score_cp int not null,                     -- side-to-move perspective
  pv text,
  primary key (fen_key, engine, depth, multipv)
);

create table eval_job (
  id bigserial primary key,
  fen_key text not null,
  engine text not null,
  depth int not null,
  status text not null default 'PENDING',    -- PENDING | RUNNING | DONE | FAILED
  attempts int not null default 0,
  locked_by text,
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (fen_key, engine, depth)
);
create index eval_job_pending on eval_job (id) where status = 'PENDING';

create table move_analysis (
  move_id bigint primary key references move(id),
  cpl int not null,
  best_uci text,
  p_played double precision,
  tags text[] not null default '{}'
);
```

- [ ] **Step 2: Run the smoke test**

Run: `cd backend && mvn -q test -Dtest=SmokeIT`
Expected: PASS (Docker must be running for Testcontainers).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: database schema"
```

### Task 2: FEN keys and game replay

**Files:**
- Create: `backend/src/main/java/com/blunderprint/chess/Fen.java`, `ReplayedMove.java`, `GameReplayer.java`
- Test: `backend/src/test/java/com/blunderprint/chess/FenTest.java`, `GameReplayerTest.java`

**Interfaces:**
- Produces: `Fen.key(String fen): String`, `Fen.forEngine(String key): String`
- Produces: `record ReplayedMove(int ply, int fullmove, String mover, String beforeFen, String beforeKey, String afterKey, String playedUci, String playedSan)`
- Produces: `GameReplayer.replay(String sanMoves): List<ReplayedMove>` (all plies, both colors; `mover` is `"w"` or `"b"`)

- [ ] **Step 1: Write the failing tests**

`FenTest.java`:
```java
package com.blunderprint.chess;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

class FenTest {
    @Test
    void keyDropsMoveCounters() {
        assertEquals("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
            Fen.key("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"));
    }

    @Test
    void forEngineAppendsCounters() {
        assertEquals("8/8/8/8/8/8/8/K6k w - - 0 1", Fen.forEngine("8/8/8/8/8/8/8/K6k w - -"));
    }
}
```

`GameReplayerTest.java`:
```java
package com.blunderprint.chess;

import static org.junit.jupiter.api.Assertions.*;
import java.util.List;
import org.junit.jupiter.api.Test;

class GameReplayerTest {
    @Test
    void replaysSanIntoUciAndKeys() {
        List<ReplayedMove> m = GameReplayer.replay("e4 e5 Nf3");
        assertEquals(3, m.size());
        assertEquals("e2e4", m.get(0).playedUci());
        assertEquals("w", m.get(0).mover());
        assertEquals(1, m.get(0).fullmove());
        assertEquals("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", m.get(0).beforeKey());
        assertTrue(m.get(0).afterKey().startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq"));
        assertEquals("b", m.get(1).mover());
        assertEquals("e7e5", m.get(1).playedUci());
        assertEquals("g1f3", m.get(2).playedUci());
        assertEquals(2, m.get(2).fullmove());
        assertEquals("Nf3", m.get(2).playedSan());
        // after-key of ply n equals before-key of ply n+1
        assertEquals(m.get(0).afterKey(), m.get(1).beforeKey());
    }

    @Test
    void castlingIsUciKingMove() {
        List<ReplayedMove> m = GameReplayer.replay("e4 e5 Nf3 Nc6 Bc4 Bc5 O-O");
        assertEquals("e1g1", m.get(6).playedUci());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest='FenTest,GameReplayerTest'`
Expected: FAIL (compile error: classes missing).

- [ ] **Step 3: Implement**

`Fen.java`:
```java
package com.blunderprint.chess;

public final class Fen {
    private Fen() {}

    /** First four FEN fields: placement, side, castling, en passant. */
    public static String key(String fen) {
        String[] p = fen.trim().split("\\s+");
        return p[0] + " " + p[1] + " " + p[2] + " " + p[3];
    }

    public static String forEngine(String key) {
        return key + " 0 1";
    }
}
```

`ReplayedMove.java`:
```java
package com.blunderprint.chess;

public record ReplayedMove(int ply, int fullmove, String mover, String beforeFen, String beforeKey,
                           String afterKey, String playedUci, String playedSan) {}
```

`GameReplayer.java`:
```java
package com.blunderprint.chess;

import com.github.bhlangonijr.chesslib.Board;
import com.github.bhlangonijr.chesslib.Piece;
import com.github.bhlangonijr.chesslib.Side;
import com.github.bhlangonijr.chesslib.move.Move;
import com.github.bhlangonijr.chesslib.move.MoveList;
import java.util.ArrayList;
import java.util.List;

public final class GameReplayer {
    private GameReplayer() {}

    public static List<ReplayedMove> replay(String sanMoves) {
        String[] sans = sanMoves.trim().split("\\s+");
        MoveList list = new MoveList();
        list.loadFromSan(sanMoves);
        if (list.size() != sans.length) {
            throw new IllegalArgumentException("SAN parse mismatch: " + list.size() + " vs " + sans.length);
        }
        Board board = new Board();
        List<ReplayedMove> out = new ArrayList<>();
        int ply = 0;
        for (Move m : list) {
            String mover = board.getSideToMove() == Side.WHITE ? "w" : "b";
            String beforeFen = board.getFen();
            board.doMove(m);
            out.add(new ReplayedMove(ply, ply / 2 + 1, mover, beforeFen, Fen.key(beforeFen),
                Fen.key(board.getFen()), uci(m), sans[ply]));
            ply++;
        }
        return out;
    }

    private static String uci(Move m) {
        String s = m.getFrom().value().toLowerCase() + m.getTo().value().toLowerCase();
        if (m.getPromotion() != Piece.NONE) {
            s += switch (m.getPromotion().getPieceType()) {
                case QUEEN -> "q";
                case ROOK -> "r";
                case BISHOP -> "b";
                case KNIGHT -> "n";
                default -> "";
            };
        }
        return s;
    }
}
```
If a chesslib method name differs in 1.3.4 (`loadFromSan`, `getPieceType`, `value()`), fix it per the compiler error. The tests above are the contract.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && mvn -q test -Dtest='FenTest,GameReplayerTest'`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: FEN keys and SAN game replay"
```

### Task 3: UCI parsing and Stockfish engine

**Files:**
- Create: `backend/src/main/java/com/blunderprint/engine/EngineResult.java`, `UciParser.java`, `StockfishEngine.java`
- Test: `backend/src/test/java/com/blunderprint/engine/UciParserTest.java`, `StockfishEngineIT.java`

**Interfaces:**
- Produces: `record EngineResult(String bestUci, int scoreCp, String pv)`. `bestUci` is null for terminal positions. `scoreCp` is side-to-move perspective with mate mapped as in Global Constraints.
- Produces: `UciParser.parseInfo(String line): Optional<UciParser.Info>`, `record Info(int depth, Integer cp, Integer mate, String pv)`, `UciParser.toCentipawns(Integer cp, Integer mate): int`
- Produces: `new StockfishEngine(String path)` (throws `IOException`), `EngineResult analyze(String fenKey, int depth) throws IOException`, `close()`

- [ ] **Step 1: Write the failing tests**

`UciParserTest.java`:
```java
package com.blunderprint.engine;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class UciParserTest {
    @Test
    void parsesCentipawnInfo() {
        var i = UciParser.parseInfo(
            "info depth 12 seldepth 18 multipv 1 score cp 34 nodes 1000 nps 500000 pv e2e4 e7e5 g1f3").orElseThrow();
        assertEquals(12, i.depth());
        assertEquals(34, i.cp());
        assertNull(i.mate());
        assertEquals("e2e4 e7e5 g1f3", i.pv());
    }

    @Test
    void parsesMateInfo() {
        var i = UciParser.parseInfo("info depth 5 multipv 1 score mate 1 pv a1a8").orElseThrow();
        assertEquals(1, i.mate());
        assertEquals(9999, UciParser.toCentipawns(i.cp(), i.mate()));
    }

    @Test
    void mateAgainstUsIsNegative() {
        assertEquals(-9998, UciParser.toCentipawns(null, -2));
        assertEquals(-10000, UciParser.toCentipawns(null, 0));
    }

    @Test
    void ignoresBoundsAndNonScoreLines() {
        assertTrue(UciParser.parseInfo("info depth 9 score cp 10 lowerbound pv e2e4").isEmpty());
        assertTrue(UciParser.parseInfo("info string NNUE evaluation using nn.nnue").isEmpty());
        assertTrue(UciParser.parseInfo("info depth 9 currmove e2e4 currmovenumber 1").isEmpty());
        assertTrue(UciParser.parseInfo("bestmove e2e4").isEmpty());
    }

    @Test
    void ignoresSecondaryPv() {
        assertTrue(UciParser.parseInfo("info depth 9 multipv 2 score cp 10 pv d2d4").isEmpty());
    }

    @Test
    void acceptsDepthZeroTerminalScore() {
        var i = UciParser.parseInfo("info depth 0 score mate 0").orElseThrow();
        assertEquals(-10000, UciParser.toCentipawns(i.cp(), i.mate()));
    }
}
```

`StockfishEngineIT.java` (skipped unless a Stockfish binary is configured):
```java
package com.blunderprint.engine;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

@EnabledIfEnvironmentVariable(named = "STOCKFISH_PATH", matches = ".+")
class StockfishEngineIT {
    @Test
    void findsBackRankMateInOne() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            EngineResult r = sf.analyze("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -", 8);
            assertEquals("a1a8", r.bestUci());
            assertEquals(9999, r.scoreCp());
        }
    }

    @Test
    void terminalPositionHasNoBestMove() throws Exception {
        try (var sf = new StockfishEngine(System.getenv("STOCKFISH_PATH"))) {
            // Black is checkmated (back-rank).
            EngineResult r = sf.analyze("R5k1/5ppp/8/8/8/8/5PPP/6K1 b - -", 8);
            assertNull(r.bestUci());
            assertEquals(-10000, r.scoreCp());
        }
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest=UciParserTest`
Expected: FAIL (compile error).

- [ ] **Step 3: Implement**

`EngineResult.java`:
```java
package com.blunderprint.engine;

public record EngineResult(String bestUci, int scoreCp, String pv) {}
```

`UciParser.java`:
```java
package com.blunderprint.engine;

import java.util.Arrays;
import java.util.Optional;

public final class UciParser {
    private UciParser() {}

    public record Info(int depth, Integer cp, Integer mate, String pv) {}

    public static Optional<Info> parseInfo(String line) {
        if (!line.startsWith("info ")) return Optional.empty();
        String[] t = line.trim().split("\\s+");
        Integer depth = null, cp = null, mate = null;
        String pv = null;
        int multipv = 1;
        for (int i = 1; i < t.length; i++) {
            switch (t[i]) {
                case "depth" -> depth = Integer.parseInt(t[++i]);
                case "multipv" -> multipv = Integer.parseInt(t[++i]);
                case "score" -> {
                    String kind = t[++i];
                    int v = Integer.parseInt(t[++i]);
                    if (kind.equals("cp")) cp = v; else mate = v;
                    if (i + 1 < t.length && (t[i + 1].equals("lowerbound") || t[i + 1].equals("upperbound"))) {
                        return Optional.empty();
                    }
                }
                case "pv" -> {
                    pv = String.join(" ", Arrays.copyOfRange(t, i + 1, t.length));
                    i = t.length;
                }
                default -> { }
            }
        }
        if (multipv != 1 || depth == null || (cp == null && mate == null)) return Optional.empty();
        return Optional.of(new Info(depth, cp, mate, pv));
    }

    /** Mate in n (n>0) = 10000-n; being mated in n (n<=0) = -(10000-|n|). */
    public static int toCentipawns(Integer cp, Integer mate) {
        if (mate == null) return cp;
        int sign = mate > 0 ? 1 : -1;
        return sign * (10000 - Math.abs(mate));
    }
}
```

`StockfishEngine.java`:
```java
package com.blunderprint.engine;

import com.blunderprint.chess.Fen;
import java.io.*;
import java.util.List;

public class StockfishEngine implements AutoCloseable {
    private final Process process;
    private final BufferedReader in;
    private final BufferedWriter out;

    public StockfishEngine(String path) throws IOException {
        process = new ProcessBuilder(List.of(path)).redirectErrorStream(true).start();
        in = new BufferedReader(new InputStreamReader(process.getInputStream()));
        out = new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));
        send("uci");
        waitFor("uciok");
        send("setoption name Threads value 1");
        send("setoption name Hash value 64");
        send("isready");
        waitFor("readyok");
    }

    public EngineResult analyze(String fenKey, int depth) throws IOException {
        send("position fen " + Fen.forEngine(fenKey));
        send("go depth " + depth);
        UciParser.Info last = null;
        String line;
        while ((line = in.readLine()) != null) {
            if (line.startsWith("bestmove")) {
                String[] t = line.split("\\s+");
                String best = t[1].equals("(none)") ? null : t[1];
                if (last == null) throw new IOException("no score for " + fenKey);
                return new EngineResult(best, UciParser.toCentipawns(last.cp(), last.mate()), last.pv());
            }
            var parsed = UciParser.parseInfo(line);
            if (parsed.isPresent()) last = parsed.get();
        }
        throw new IOException("engine closed unexpectedly");
    }

    private void send(String cmd) throws IOException {
        out.write(cmd);
        out.newLine();
        out.flush();
    }

    private void waitFor(String token) throws IOException {
        String line;
        while ((line = in.readLine()) != null) {
            if (line.startsWith(token)) return;
        }
        throw new IOException("engine closed while waiting for " + token);
    }

    @Override
    public void close() {
        try { send("quit"); } catch (IOException ignored) { }
        process.destroy();
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && mvn -q test -Dtest=UciParserTest` → PASS (6 tests).
Then with Stockfish installed: `STOCKFISH_PATH=/path/to/stockfish mvn -q test -Dtest=StockfishEngineIT` → PASS (2 tests). (Windows PowerShell: `$env:STOCKFISH_PATH="C:\path\stockfish.exe"; mvn -q test -Dtest=StockfishEngineIT`.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: UCI parser and Stockfish engine wrapper"
```

### Task 4: Lichess client

**Files:**
- Create: `backend/src/main/java/com/blunderprint/lichess/LichessGame.java`, `LichessClient.java`
- Test: `backend/src/test/java/com/blunderprint/lichess/LichessClientTest.java`

**Interfaces:**
- Produces: `record LichessGame(String id, String white, String black, Integer whiteRating, Integer blackRating, String perf, String result, java.time.Instant playedAt, String sanMoves, java.util.List<Integer> clocksCs)`
- Produces: `LichessClient.fetchGames(String username, int max): List<LichessGame>`; package-visible `static Optional<LichessGame> parseLine(String json)`.
- `result` is `"1-0"`, `"0-1"` or `"1/2-1/2"`.

- [ ] **Step 1: Write the failing test**

```java
package com.blunderprint.lichess;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class LichessClientTest {
    private static final String LINE = """
        {"id":"abc12345","rated":true,"perf":"blitz","createdAt":1700000000000,"status":"mate","winner":"white",
         "players":{"white":{"user":{"name":"Alice"},"rating":1500},"black":{"user":{"name":"Bob"},"rating":1480}},
         "moves":"e4 e5 Nf3","clocks":[18000,18000,17900]}""".replace("\n", "");

    @Test
    void parsesGameLine() {
        LichessGame g = LichessClient.parseLine(LINE).orElseThrow();
        assertEquals("abc12345", g.id());
        assertEquals("Alice", g.white());
        assertEquals(1480, g.blackRating());
        assertEquals("1-0", g.result());
        assertEquals("blitz", g.perf());
        assertEquals("e4 e5 Nf3", g.sanMoves());
        assertEquals(java.util.List.of(18000, 18000, 17900), g.clocksCs());
    }

    @Test
    void drawHasHalfPointResult() {
        String draw = LINE.replace("\"winner\":\"white\",", "");
        assertEquals("1/2-1/2", LichessClient.parseLine(draw).orElseThrow().result());
    }

    @Test
    void skipsGamesWithoutNamedPlayersOrMoves() {
        assertTrue(LichessClient.parseLine(LINE.replace("\"user\":{\"name\":\"Bob\"},", "")).isEmpty());
        assertTrue(LichessClient.parseLine(LINE.replace("\"moves\":\"e4 e5 Nf3\"", "\"moves\":\"\"")).isEmpty());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest=LichessClientTest` → FAIL (compile error).

- [ ] **Step 3: Implement**

`LichessGame.java`:
```java
package com.blunderprint.lichess;

import java.time.Instant;
import java.util.List;

public record LichessGame(String id, String white, String black, Integer whiteRating, Integer blackRating,
                          String perf, String result, Instant playedAt, String sanMoves, List<Integer> clocksCs) {}
```

`LichessClient.java`:
```java
package com.blunderprint.lichess;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class LichessClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    private final String baseUrl;
    private final String token;

    public LichessClient(@Value("${lichess.base-url}") String baseUrl, @Value("${lichess.token:}") String token) {
        this.baseUrl = baseUrl;
        this.token = token;
    }

    public List<LichessGame> fetchGames(String username, int max) {
        String url = baseUrl + "/api/games/user/" + URLEncoder.encode(username, StandardCharsets.UTF_8)
            + "?max=" + max + "&rated=true&perfType=blitz,rapid,classical&moves=true&clocks=true&pgnInJson=false";
        // Lichess rejects default client user agents on this endpoint (404), so identify ourselves.
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(url))
            .header("Accept", "application/x-ndjson")
            .header("User-Agent", "blunderprint/0.1");
        if (!token.isBlank()) rb.header("Authorization", "Bearer " + token);
        try {
            HttpResponse<java.util.stream.Stream<String>> resp =
                http.send(rb.build(), HttpResponse.BodyHandlers.ofLines());
            if (resp.statusCode() == 429) throw new IllegalStateException("Lichess rate limit (429): wait a minute");
            if (resp.statusCode() != 200) throw new IllegalStateException("Lichess HTTP " + resp.statusCode());
            List<LichessGame> games = new ArrayList<>();
            try (var lines = resp.body()) {
                lines.filter(l -> !l.isBlank()).forEach(l -> parseLine(l).ifPresent(games::add));
            }
            return games;
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException("Lichess request failed", e);
        }
    }

    static Optional<LichessGame> parseLine(String json) {
        try {
            JsonNode n = MAPPER.readTree(json);
            JsonNode w = n.path("players").path("white");
            JsonNode b = n.path("players").path("black");
            String moves = n.path("moves").asText("");
            if (w.path("user").path("name").isMissingNode() || b.path("user").path("name").isMissingNode()
                || moves.isBlank()) {
                return Optional.empty();
            }
            String winner = n.path("winner").asText("");
            String result = winner.equals("white") ? "1-0" : winner.equals("black") ? "0-1" : "1/2-1/2";
            List<Integer> clocks = new ArrayList<>();
            n.path("clocks").forEach(c -> clocks.add(c.asInt()));
            return Optional.of(new LichessGame(
                n.path("id").asText(),
                w.path("user").path("name").asText(), b.path("user").path("name").asText(),
                w.has("rating") ? w.get("rating").asInt() : null,
                b.has("rating") ? b.get("rating").asInt() : null,
                n.path("perf").asText(null), result,
                Instant.ofEpochMilli(n.path("createdAt").asLong()), moves, clocks));
        } catch (IOException e) {
            return Optional.empty();
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && mvn -q test -Dtest=LichessClientTest` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Lichess ndjson client"
```

### Task 5: Job queue repository

**Files:**
- Create: `backend/src/main/java/com/blunderprint/store/Job.java`, `JobQueueRepository.java`
- Test: `backend/src/test/java/com/blunderprint/store/JobQueueRepositoryIT.java`

**Interfaces:**
- Produces: `record Job(long id, String fenKey, String engine, int depth, int attempts)`
- Produces `JobQueueRepository`:
  - `int enqueueForRun(UUID runId)`: enqueue every distinct `before_key`/`after_key` of the run not already in `eval_cache` (idempotent; resets FAILED rows to PENDING); returns number of rows inserted or reset
  - `List<Job> claim(String workerId, int limit)`
  - `void complete(Job job, EngineResult result)`
  - `void fail(long jobId, String error, int maxAttempts)`
  - `int reapStale(int timeoutSeconds, int maxAttempts)`
- Engine name and depth come from the `analysis_run` row, so the run must exist first (Task 6 creates it).

- [ ] **Step 1: Write the failing test**

```java
package com.blunderprint.store;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.engine.EngineResult;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class JobQueueRepositoryIT extends PostgresIT {
    @Autowired JobQueueRepository queue;

    private UUID seedRun(String... keys) {
        UUID run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, 'u', 'sf', 10)", run);
        jdbc.update("insert into game(id, white, black) values ('g1', 'u', 'x')");
        int ply = 0;
        for (String k : keys) {
            jdbc.update("""
                insert into move(run_id, game_id, ply, fullmove, mover, before_fen, before_key, after_key, played_uci, played_san)
                values (?, 'g1', ?, 1, 'w', ?, ?, ?, 'e2e4', 'e4')""", run, ply++, k + " 0 1", k, k + "-after");
        }
        return run;
    }

    @Test
    void enqueueIsIdempotentAndSkipsCached() {
        UUID run = seedRun("a", "b");
        assertEquals(4, queue.enqueueForRun(run));      // a, b, a-after, b-after
        assertEquals(0, queue.enqueueForRun(run));      // nothing new
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('a','sf',10,0)");
        jdbc.execute("delete from eval_job");
        assertEquals(3, queue.enqueueForRun(run));      // 'a' is cached
    }

    @Test
    void claimCompleteStoresEvalAndMarksDone() {
        queue.enqueueForRun(seedRun("a"));
        List<Job> jobs = queue.claim("w1", 10);
        assertEquals(2, jobs.size());
        queue.complete(jobs.get(0), new EngineResult("e2e4", 25, "e2e4 e7e5"));
        assertEquals(1L, jdbc.queryForObject("select count(*) from eval_cache", Long.class));
        assertEquals("DONE", jdbc.queryForObject("select status from eval_job where id=?", String.class, jobs.get(0).id()));
        assertTrue(queue.claim("w2", 10).isEmpty());   // the other job is RUNNING
    }

    @Test
    void failRetriesThenGivesUp() {
        queue.enqueueForRun(seedRun("a"));
        Job j = queue.claim("w1", 1).get(0);
        queue.fail(j.id(), "boom", 2);
        assertEquals("PENDING", jdbc.queryForObject("select status from eval_job where id=?", String.class, j.id()));
        Job again = queue.claim("w1", 1).stream().filter(x -> x.id() == j.id()).findFirst().orElseThrow();
        queue.fail(again.id(), "boom", 2);
        assertEquals("FAILED", jdbc.queryForObject("select status from eval_job where id=?", String.class, j.id()));
        assertEquals(1, queue.enqueueForRun(jdbc.queryForObject("select id from analysis_run", UUID.class)));  // FAILED reset
    }

    @Test
    void reapsStaleRunningJobs() {
        queue.enqueueForRun(seedRun("a"));
        Job j = queue.claim("w1", 1).get(0);
        jdbc.update("update eval_job set locked_at = now() - interval '10 minutes' where id=?", j.id());
        assertEquals(1, queue.reapStale(60, 3));
        assertEquals("PENDING", jdbc.queryForObject("select status from eval_job where id=?", String.class, j.id()));
    }

    @Test
    void concurrentWorkersNeverDoubleClaim() throws Exception {
        UUID run = seedRun(java.util.stream.IntStream.range(0, 100).mapToObj(i -> "k" + i).toArray(String[]::new));
        assertEquals(200, queue.enqueueForRun(run));
        Set<Long> seen = ConcurrentHashMap.newKeySet();
        List<Long> dupes = Collections.synchronizedList(new ArrayList<>());
        ExecutorService pool = Executors.newFixedThreadPool(8);
        List<Future<?>> fs = new ArrayList<>();
        for (int w = 0; w < 8; w++) {
            String id = "w" + w;
            fs.add(pool.submit(() -> {
                List<Job> batch;
                while (!(batch = queue.claim(id, 5)).isEmpty()) {
                    for (Job job : batch) if (!seen.add(job.id())) dupes.add(job.id());
                }
            }));
        }
        for (Future<?> f : fs) f.get(30, TimeUnit.SECONDS);
        pool.shutdown();
        assertTrue(dupes.isEmpty(), "double-claimed: " + dupes);
        assertEquals(200, seen.size());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest=JobQueueRepositoryIT` → FAIL (compile error).

- [ ] **Step 3: Implement**

`Job.java`:
```java
package com.blunderprint.store;

public record Job(long id, String fenKey, String engine, int depth, int attempts) {}
```

`JobQueueRepository.java`:
```java
package com.blunderprint.store;

import com.blunderprint.engine.EngineResult;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
public class JobQueueRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public JobQueueRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    public int enqueueForRun(UUID runId) {
        return jdbc.update("""
            insert into eval_job (fen_key, engine, depth)
            select distinct x.k, r.engine, r.depth
            from analysis_run r,
                 (select before_key k, run_id from move where run_id = ?
                  union select after_key, run_id from move where run_id = ?) x
            where r.id = ? and x.run_id = r.id
              and not exists (select 1 from eval_cache c
                              where c.fen_key = x.k and c.engine = r.engine and c.depth = r.depth and c.multipv = 1)
            on conflict (fen_key, engine, depth)
            do update set status = 'PENDING', attempts = 0, locked_by = null, locked_at = null
            where eval_job.status = 'FAILED'
            """, runId, runId, runId);
    }

    public List<Job> claim(String workerId, int limit) {
        return jdbc.query("""
            update eval_job set status = 'RUNNING', locked_by = ?, locked_at = now()
            where id in (select id from eval_job where status = 'PENDING' order by id limit ? for update skip locked)
            returning id, fen_key, engine, depth, attempts
            """, (rs, i) -> new Job(rs.getLong("id"), rs.getString("fen_key"), rs.getString("engine"),
                rs.getInt("depth"), rs.getInt("attempts")), workerId, limit);
    }

    public void complete(Job job, EngineResult r) {
        tx.executeWithoutResult(s -> {
            jdbc.update("""
                insert into eval_cache (fen_key, engine, depth, multipv, best_uci, score_cp, pv)
                values (?, ?, ?, 1, ?, ?, ?) on conflict do nothing
                """, job.fenKey(), job.engine(), job.depth(), r.bestUci(), r.scoreCp(), r.pv());
            jdbc.update("update eval_job set status = 'DONE', locked_by = null, locked_at = null where id = ?", job.id());
        });
    }

    public void fail(long jobId, String error, int maxAttempts) {
        jdbc.update("""
            update eval_job set attempts = attempts + 1, last_error = ?, locked_by = null, locked_at = null,
                status = case when attempts + 1 >= ? then 'FAILED' else 'PENDING' end
            where id = ?
            """, error, maxAttempts, jobId);
    }

    public int reapStale(int timeoutSeconds, int maxAttempts) {
        return jdbc.update("""
            update eval_job set attempts = attempts + 1, locked_by = null, locked_at = null,
                status = case when attempts + 1 >= ? then 'FAILED' else 'PENDING' end
            where status = 'RUNNING' and locked_at < now() - make_interval(secs => ?)
            """, maxAttempts, timeoutSeconds);
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && mvn -q test -Dtest=JobQueueRepositoryIT` → PASS (5 tests). If `concurrentWorkersNeverDoubleClaim` ever fails, the claim query is wrong. Do not weaken the test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Postgres-backed job queue with SKIP LOCKED"
```

### Task 6: Ingestion service

**Files:**
- Create: `backend/src/main/java/com/blunderprint/ingest/IngestService.java`
- Test: `backend/src/test/java/com/blunderprint/ingest/IngestServiceIT.java`

**Interfaces:**
- Consumes: `LichessClient.fetchGames`, `GameReplayer.replay`, `JobQueueRepository.enqueueForRun`
- Produces: `IngestService.ingest(String username, int maxGames, int depth): IngestResult`; `record IngestResult(UUID runId, int games, int moves, int jobsEnqueued)`
- Only the **user's** moves are stored (`mover` matches the user's color). Username matching is case-insensitive. Engine name comes from `engine.version`.

- [ ] **Step 1: Write the failing test**

```java
package com.blunderprint.ingest;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

import com.blunderprint.PostgresIT;
import com.blunderprint.lichess.LichessClient;
import com.blunderprint.lichess.LichessGame;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

class IngestServiceIT extends PostgresIT {
    @Autowired IngestService ingest;
    @MockBean LichessClient lichess;

    private LichessGame game() {
        return new LichessGame("g1", "Alice", "Bob", 1500, 1480, "blitz", "1-0", Instant.now(),
            "e4 e5 Nf3 Nc6", List.of(18000, 18000, 17900, 17800));
    }

    @Test
    void storesOnlyTheUsersMovesAndEnqueuesJobs() {
        when(lichess.fetchGames("alice", 10)).thenReturn(List.of(game()));
        var res = ingest.ingest("alice", 10, 10);
        assertEquals(1, res.games());
        assertEquals(2, res.moves());                       // plies 0 and 2
        assertEquals(4, res.jobsEnqueued());                // 2 before-keys + 2 after-keys, all distinct
        assertEquals(1500, jdbc.queryForObject("select distinct rating from move", Integer.class));
        assertEquals(18000, jdbc.queryForObject("select clock_cs from move where ply = 0", Integer.class));
        assertEquals(17900, jdbc.queryForObject("select clock_cs from move where ply = 2", Integer.class));
    }

    @Test
    void blackPlayerGetsTheOddPlies() {
        when(lichess.fetchGames("BOB", 10)).thenReturn(List.of(game()));
        var res = ingest.ingest("BOB", 10, 10);
        assertEquals(2, res.moves());
        assertEquals(1480, jdbc.queryForObject("select distinct rating from move", Integer.class));
        assertEquals(List.of(1, 3), jdbc.queryForList("select ply from move order by ply", Integer.class));
    }

    @Test
    void reIngestingReusesGameRowAndCachedEvals() {
        when(lichess.fetchGames("alice", 10)).thenReturn(List.of(game()));
        ingest.ingest("alice", 10, 10);
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) select fen_key, engine, depth, 0 from eval_job");
        var second = ingest.ingest("alice", 10, 10);
        assertEquals(0, second.jobsEnqueued());
        assertEquals(1L, jdbc.queryForObject("select count(*) from game", Long.class));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest=IngestServiceIT` → FAIL (compile error).

- [ ] **Step 3: Implement**

```java
package com.blunderprint.ingest;

import com.blunderprint.chess.GameReplayer;
import com.blunderprint.chess.ReplayedMove;
import com.blunderprint.lichess.LichessClient;
import com.blunderprint.lichess.LichessGame;
import com.blunderprint.store.JobQueueRepository;
import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IngestService {
    public record IngestResult(UUID runId, int games, int moves, int jobsEnqueued) {}

    private final LichessClient lichess;
    private final JdbcTemplate jdbc;
    private final JobQueueRepository queue;
    private final String engine;

    public IngestService(LichessClient lichess, JdbcTemplate jdbc, JobQueueRepository queue,
                         @Value("${engine.version}") String engine) {
        this.lichess = lichess;
        this.jdbc = jdbc;
        this.queue = queue;
        this.engine = engine;
    }

    @Transactional
    public IngestResult ingest(String username, int maxGames, int depth) {
        List<LichessGame> games = lichess.fetchGames(username, maxGames);
        UUID runId = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, ?, ?, ?)",
            runId, username, engine, depth);
        int moveCount = 0;
        for (LichessGame g : games) {
            boolean userIsWhite = g.white().equalsIgnoreCase(username);
            if (!userIsWhite && !g.black().equalsIgnoreCase(username)) continue;
            jdbc.update("""
                insert into game(id, white, black, white_rating, black_rating, perf, result, played_at)
                values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing
                """, g.id(), g.white(), g.black(), g.whiteRating(), g.blackRating(), g.perf(), g.result(),
                Timestamp.from(g.playedAt()));
            Integer rating = userIsWhite ? g.whiteRating() : g.blackRating();
            String userSide = userIsWhite ? "w" : "b";
            for (ReplayedMove m : GameReplayer.replay(g.sanMoves())) {
                if (!m.mover().equals(userSide)) continue;
                Integer clock = m.ply() < g.clocksCs().size() ? g.clocksCs().get(m.ply()) : null;
                jdbc.update("""
                    insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key,
                                     after_key, played_uci, played_san, clock_cs)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, runId, g.id(), m.ply(), m.fullmove(), m.mover(), rating, m.beforeFen(), m.beforeKey(),
                    m.afterKey(), m.playedUci(), m.playedSan(), clock);
                moveCount++;
            }
        }
        int jobs = queue.enqueueForRun(runId);
        return new IngestResult(runId, games.size(), moveCount, jobs);
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && mvn -q test -Dtest=IngestServiceIT` → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: ingest games into moves and eval jobs"
```

---

# Phase 2: Concurrency, API, measurements

### Task 7: Worker pool

**Files:**
- Create: `backend/src/main/java/com/blunderprint/worker/WorkerPool.java`
- Test: `backend/src/test/java/com/blunderprint/worker/WorkerPoolIT.java`

**Interfaces:**
- Consumes: `JobQueueRepository.claim/complete/fail/reapStale`, `StockfishEngine`
- Produces: `WorkerPool.start(int n)`, `WorkerPool.stop()`, `WorkerPool.size(): int`. Autostarts `workers.count` threads on boot when `workers.autostart=true`. A scheduled reaper runs every 30 s.
- A worker whose engine throws closes it, records the failure on the job, and starts a fresh engine for the next job.

- [ ] **Step 1: Write the failing test** (needs a Stockfish binary; skipped without `STOCKFISH_PATH`)

```java
package com.blunderprint.worker;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.store.JobQueueRepository;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.TestPropertySource;

@EnabledIfEnvironmentVariable(named = "STOCKFISH_PATH", matches = ".+")
@TestPropertySource(properties = {"engine.path=${STOCKFISH_PATH}", "engine.version=sf-test"})
class WorkerPoolIT extends PostgresIT {
    @Autowired WorkerPool pool;
    @Autowired JobQueueRepository queue;

    @Test
    void workersDrainTheQueueIntoTheCache() throws Exception {
        UUID run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, 'u', 'sf-test', 6)", run);
        jdbc.update("insert into game(id, white, black) values ('g1', 'u', 'x')");
        jdbc.update("""
            insert into move(run_id, game_id, ply, fullmove, mover, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', 0, 1, 'w', 'x', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -',
                    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -', 'e2e4', 'e4')""", run);
        assertEquals(2, queue.enqueueForRun(run));
        pool.start(2);
        long deadline = System.currentTimeMillis() + 30_000;
        while (System.currentTimeMillis() < deadline
            && jdbc.queryForObject("select count(*) from eval_cache", Long.class) < 2) {
            Thread.sleep(200);
        }
        pool.stop();
        assertEquals(2L, jdbc.queryForObject("select count(*) from eval_cache", Long.class));
        assertEquals(2L, jdbc.queryForObject("select count(*) from eval_job where status = 'DONE'", Long.class));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && STOCKFISH_PATH=/path/to/stockfish mvn -q test -Dtest=WorkerPoolIT` → FAIL (compile error).

- [ ] **Step 3: Implement**

```java
package com.blunderprint.worker;

import com.blunderprint.engine.EngineResult;
import com.blunderprint.engine.StockfishEngine;
import com.blunderprint.store.Job;
import com.blunderprint.store.JobQueueRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class WorkerPool {
    private static final Logger log = LoggerFactory.getLogger(WorkerPool.class);

    private final JobQueueRepository queue;
    private final String enginePath;
    private final int defaultCount;
    private final boolean autostart;
    private final int reaperTimeoutSeconds;
    private final int maxAttempts;
    private final List<Thread> threads = new ArrayList<>();
    private volatile boolean running = false;

    public WorkerPool(JobQueueRepository queue,
                      @Value("${engine.path}") String enginePath,
                      @Value("${workers.count}") int defaultCount,
                      @Value("${workers.autostart}") boolean autostart,
                      @Value("${workers.reaper-timeout-seconds}") int reaperTimeoutSeconds,
                      @Value("${workers.max-attempts}") int maxAttempts) {
        this.queue = queue;
        this.enginePath = enginePath;
        this.defaultCount = defaultCount;
        this.autostart = autostart;
        this.reaperTimeoutSeconds = reaperTimeoutSeconds;
        this.maxAttempts = maxAttempts;
    }

    @PostConstruct
    void init() {
        if (autostart) start(defaultCount);
    }

    public synchronized void start(int n) {
        stop();
        running = true;
        for (int i = 0; i < n; i++) {
            String id = "w" + i;
            threads.add(Thread.ofPlatform().daemon(true).name("sf-" + id).start(() -> loop(id)));
        }
        log.info("started {} workers", n);
    }

    @PreDestroy
    public synchronized void stop() {
        running = false;
        for (Thread t : threads) t.interrupt();
        for (Thread t : threads) {
            try { t.join(10_000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        threads.clear();
    }

    public synchronized int size() {
        return threads.size();
    }

    @Scheduled(fixedDelay = 30_000)
    void reap() {
        int n = queue.reapStale(reaperTimeoutSeconds, maxAttempts);
        if (n > 0) log.warn("reaped {} stale jobs", n);
    }

    private void loop(String workerId) {
        StockfishEngine engine = null;
        try {
            while (running) {
                List<Job> jobs = queue.claim(workerId, 1);
                if (jobs.isEmpty()) {
                    Thread.sleep(200);
                    continue;
                }
                for (Job job : jobs) {
                    try {
                        if (engine == null) engine = new StockfishEngine(enginePath);
                        EngineResult r = engine.analyze(job.fenKey(), job.depth());
                        queue.complete(job, r);
                    } catch (Exception e) {
                        log.warn("{} failed job {}: {}", workerId, job.id(), e.toString());
                        queue.fail(job.id(), String.valueOf(e), maxAttempts);
                        if (engine != null) engine.close();
                        engine = null;
                    }
                }
            }
        } catch (InterruptedException ignored) {
            // stop requested
        } finally {
            if (engine != null) engine.close();
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && STOCKFISH_PATH=/path/to/stockfish mvn -q test -Dtest=WorkerPoolIT` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Stockfish worker pool"
```

### Task 8: CPL math and scoring tick

**Files:**
- Create: `backend/src/main/java/com/blunderprint/analysis/Cpl.java`, `AnalysisService.java`, `backend/src/main/java/com/blunderprint/model/ModelClient.java`
- Test: `backend/src/test/java/com/blunderprint/analysis/CplTest.java`, `AnalysisServiceIT.java`, `backend/src/test/java/com/blunderprint/model/ModelClientTest.java`

**Interfaces:**
- Produces: `Cpl.compute(int bestScoreBefore, int scoreAfterOpponentView): int` = `max(0, clamp(best) - clamp(-after))`, clamp to ±1000
- Produces: `record ModelClient.MoveIn(long id, String fen, Integer rating, String playedUci, String bestUci, int cpl, Integer clockCs)`, `record ModelClient.MoveOut(long id, double pPlayed, List<String> tags)`, `ModelClient.analyze(List<MoveIn>): List<MoveOut>`
- Produces: `AnalysisService.progress(UUID runId): Progress` where `record Progress(String status, long totalFens, long doneFens, long failedFens)`; scheduled `tick()` (every 2 s) that moves runs RUNNING → SCORING → DONE once all of a run's evals are cached or FAILED
- Python wire format (Task 16 must match): request `{"moves":[{"id":1,"fen":"...","rating":1500,"played_uci":"e2e4","best_uci":"d2d4","cpl":120,"clock_cs":3000}]}`, response `[{"id":1,"p_played":0.31,"tags":["opening_error"]}]`

- [ ] **Step 1: Write the failing tests**

`CplTest.java`:
```java
package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

class CplTest {
    @Test void playedBestMoveIsZero() { assertEquals(0, Cpl.compute(50, -50)); }
    @Test void losingMoveHasPositiveLoss() { assertEquals(150, Cpl.compute(50, 100)); }   // played = -100
    @Test void neverNegative() { assertEquals(0, Cpl.compute(50, -80)); }
    @Test void bothSidesMateScoresClampToTwoThousand() { assertEquals(2000, Cpl.compute(9999, 9999)); }
    @Test void missedMateToEqualIsOneThousand() { assertEquals(1000, Cpl.compute(9999, 0)); }
}
```

`ModelClientTest.java`:
```java
package com.blunderprint.model;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ModelClientTest {
    @Test
    void postsMovesAndParsesResponse() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://model");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://model/analyze"))
            .andExpect(jsonPath("$.moves[0].played_uci").value("e2e4"))
            .andExpect(jsonPath("$.moves[0].clock_cs").value(3000))
            .andRespond(withSuccess("[{\"id\":7,\"p_played\":0.31,\"tags\":[\"opening_error\"]}]", MediaType.APPLICATION_JSON));
        var out = new ModelClient(b.build()).analyze(
            List.of(new ModelClient.MoveIn(7, "fen", 1500, "e2e4", "d2d4", 120, 3000)));
        assertEquals(1, out.size());
        assertEquals(7, out.get(0).id());
        assertEquals(0.31, out.get(0).pPlayed(), 1e-9);
        assertEquals(List.of("opening_error"), out.get(0).tags());
        server.verify();
    }
}
```

`AnalysisServiceIT.java`:
```java
package com.blunderprint.analysis;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

import com.blunderprint.PostgresIT;
import com.blunderprint.model.ModelClient;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

class AnalysisServiceIT extends PostgresIT {
    @Autowired AnalysisService analysis;
    @MockBean ModelClient model;

    private UUID seed() {
        UUID run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, 'u', 'sf', 10)", run);
        jdbc.update("insert into game(id, white, black) values ('g1', 'u', 'x')");
        jdbc.update("""
            insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', 0, 1, 'w', 1500, 'A 0 1', 'A', 'B', 'e2e4', 'e4')""", run);
        return run;
    }

    @Test
    void progressCountsCachedFens() {
        UUID run = seed();
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('A','sf',10,30)");
        jdbc.update("insert into eval_job(fen_key, engine, depth) values ('B','sf',10)");
        var p = analysis.progress(run);
        assertEquals(2, p.totalFens());
        assertEquals(1, p.doneFens());
        assertEquals("RUNNING", p.status());
    }

    @Test
    void tickScoresAndMarksDone() {
        UUID run = seed();
        // best before = +30 for mover; after-position (opponent view) = +200  => played = -200 => cpl 230
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('A','sf',10,'d2d4',30)");
        jdbc.update("insert into eval_cache(fen_key, engine, depth, best_uci, score_cp) values ('B','sf',10,'e7e5',200)");
        when(model.analyze(anyList())).thenAnswer(inv -> {
            List<ModelClient.MoveIn> in = inv.getArgument(0);
            return List.of(new ModelClient.MoveOut(in.get(0).id(), 0.4, List.of("opening_error")));
        });
        analysis.tick();
        var row = jdbc.queryForMap("select cpl, best_uci, p_played, tags from move_analysis");
        assertEquals(230, row.get("cpl"));
        assertEquals("d2d4", row.get("best_uci"));
        assertEquals(0.4, (Double) row.get("p_played"), 1e-9);
        assertEquals("DONE", analysis.progress(run).status());
    }

    @Test
    void tickWaitsWhileEvalsAreOutstanding() {
        UUID run = seed();
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('A','sf',10,30)");
        jdbc.update("insert into eval_job(fen_key, engine, depth, status) values ('B','sf',10,'RUNNING')");
        analysis.tick();
        assertEquals("RUNNING", analysis.progress(run).status());
    }

    @Test
    void tickSkipsMovesWhoseEvalsFailed() {
        UUID run = seed();
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) values ('A','sf',10,30)");
        jdbc.update("insert into eval_job(fen_key, engine, depth, status) values ('B','sf',10,'FAILED')");
        when(model.analyze(anyList())).thenReturn(List.of());
        analysis.tick();
        assertEquals("DONE", analysis.progress(run).status());
        assertEquals(0L, jdbc.queryForObject("select count(*) from move_analysis", Long.class));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest='CplTest,ModelClientTest,AnalysisServiceIT'` → FAIL (compile error).

- [ ] **Step 3: Implement**

`Cpl.java`:
```java
package com.blunderprint.analysis;

public final class Cpl {
    private Cpl() {}

    private static int clamp(int v) { return Math.max(-1000, Math.min(1000, v)); }

    /**
     * @param bestScoreBefore  eval of the position before the move, mover's perspective
     * @param scoreAfterOpponentView  eval of the position after the move, opponent's perspective
     */
    public static int compute(int bestScoreBefore, int scoreAfterOpponentView) {
        return Math.max(0, clamp(bestScoreBefore) - clamp(-scoreAfterOpponentView));
    }
}
```

`ModelClient.java`:
```java
package com.blunderprint.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class ModelClient {
    public record MoveIn(long id, String fen, Integer rating,
                         @JsonProperty("played_uci") String playedUci,
                         @JsonProperty("best_uci") String bestUci,
                         int cpl,
                         @JsonProperty("clock_cs") Integer clockCs) {}

    public record MoveOut(long id, @JsonProperty("p_played") double pPlayed, List<String> tags) {}

    private final RestClient client;

    @Autowired
    public ModelClient(@Value("${model.url}") String url) {
        this(RestClient.builder().baseUrl(url).build());
    }

    ModelClient(RestClient client) {
        this.client = client;
    }

    public List<MoveOut> analyze(List<MoveIn> moves) {
        return client.post().uri("/analyze").body(Map.of("moves", moves))
            .retrieve().body(new ParameterizedTypeReference<List<MoveOut>>() {});
    }
}
```
`ModelClientTest` is in the same package and calls the package-visible constructor.

`AnalysisService.java`:
```java
package com.blunderprint.analysis;

import com.blunderprint.model.ModelClient;
import com.blunderprint.model.ModelClient.MoveIn;
import com.blunderprint.model.ModelClient.MoveOut;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class AnalysisService {
    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
    private static final int MODEL_BATCH = 256;

    public record Progress(String status, long totalFens, long doneFens, long failedFens) {}

    private record Scored(long moveId, String fen, Integer rating, String playedUci, String bestUci,
                          int cpl, Integer clockCs) {}

    private final JdbcTemplate jdbc;
    private final ModelClient model;

    public AnalysisService(JdbcTemplate jdbc, ModelClient model) {
        this.jdbc = jdbc;
        this.model = model;
    }

    public Progress progress(UUID runId) {
        String status = jdbc.queryForObject("select status from analysis_run where id = ?", String.class, runId);
        var row = jdbc.queryForMap("""
            with r as (select engine, depth from analysis_run where id = ?),
                 keys as (select before_key k from move where run_id = ? union select after_key from move where run_id = ?)
            select count(*) total,
                   count(c.fen_key) done,
                   count(*) filter (where c.fen_key is null and j.status = 'FAILED') failed
            from keys
            cross join r
            left join eval_cache c on c.fen_key = keys.k and c.engine = r.engine and c.depth = r.depth and c.multipv = 1
            left join eval_job j on j.fen_key = keys.k and j.engine = r.engine and j.depth = r.depth
            """, runId, runId, runId);
        return new Progress(status, ((Number) row.get("total")).longValue(),
            ((Number) row.get("done")).longValue(), ((Number) row.get("failed")).longValue());
    }

    @Scheduled(fixedDelay = 2000)
    public void tick() {
        List<UUID> runs = jdbc.queryForList(
            "select id from analysis_run where status in ('RUNNING','SCORING') order by created_at", UUID.class);
        for (UUID run : runs) {
            Progress p = progress(run);
            if (p.doneFens() + p.failedFens() < p.totalFens()) continue;
            try {
                jdbc.update("update analysis_run set status = 'SCORING' where id = ?", run);
                score(run);
                jdbc.update("update analysis_run set status = 'DONE' where id = ?", run);
            } catch (Exception e) {
                log.warn("scoring run {} failed, will retry: {}", run, e.toString());
            }
        }
    }

    private void score(UUID run) {
        List<Scored> rows = jdbc.query("""
            select m.id, m.before_fen, m.rating, m.played_uci, m.clock_cs, eb.best_uci,
                   eb.score_cp as best_score, ea.score_cp as after_score
            from move m
            join analysis_run r on r.id = m.run_id
            join eval_cache eb on eb.fen_key = m.before_key and eb.engine = r.engine and eb.depth = r.depth and eb.multipv = 1
            join eval_cache ea on ea.fen_key = m.after_key and ea.engine = r.engine and ea.depth = r.depth and ea.multipv = 1
            where m.run_id = ?
            """, (rs, i) -> new Scored(rs.getLong("id"), rs.getString("before_fen"),
                (Integer) rs.getObject("rating"), rs.getString("played_uci"), rs.getString("best_uci"),
                Cpl.compute(rs.getInt("best_score"), rs.getInt("after_score")), (Integer) rs.getObject("clock_cs")), run);

        for (Scored s : rows) {
            jdbc.update("""
                insert into move_analysis(move_id, cpl, best_uci) values (?, ?, ?)
                on conflict (move_id) do update set cpl = excluded.cpl, best_uci = excluded.best_uci
                """, s.moveId(), s.cpl(), s.bestUci());
        }
        for (int i = 0; i < rows.size(); i += MODEL_BATCH) {
            List<MoveIn> batch = new ArrayList<>();
            for (Scored s : rows.subList(i, Math.min(rows.size(), i + MODEL_BATCH))) {
                batch.add(new MoveIn(s.moveId(), s.fen(), s.rating(), s.playedUci(), s.bestUci(), s.cpl(), s.clockCs()));
            }
            for (MoveOut o : model.analyze(batch)) {
                jdbc.update(con -> {
                    var ps = con.prepareStatement("update move_analysis set p_played = ?, tags = ? where move_id = ?");
                    ps.setDouble(1, o.pPlayed());
                    ps.setArray(2, con.createArrayOf("text", o.tags().toArray()));
                    ps.setLong(3, o.id());
                    return ps;
                });
            }
        }
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && mvn -q test -Dtest='CplTest,ModelClientTest,AnalysisServiceIT'` → PASS (5 + 1 + 4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: centipawn loss, scoring tick, model client"
```

### Task 9: REST API and admin endpoints

**Files:**
- Create: `backend/src/main/java/com/blunderprint/api/AnalysisController.java`
- Test: `backend/src/test/java/com/blunderprint/api/AnalysisControllerIT.java`

**Interfaces:**
- Consumes: `IngestService.ingest`, `AnalysisService.progress`, `JobQueueRepository.enqueueForRun`, `WorkerPool.start/size`
- Produces endpoints:
  - `POST /analysis` body `{"username":"x","maxGames":100,"depth":12}` → `202 {"runId","games","moves","jobsEnqueued"}` (depth defaults to `engine.depth`)
  - `GET /analysis/{runId}` → `{"status","totalFens","doneFens","failedFens"}`
  - `POST /analysis/{runId}/reenqueue` → `{"jobsEnqueued"}`
  - `POST /admin/workers` body `{"count":4}` → `{"workers":4}`
  - `GET /health` → `{"ok":true}`

- [ ] **Step 1: Write the failing test**

```java
package com.blunderprint.api;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.ingest.IngestService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc
class AnalysisControllerIT extends PostgresIT {
    @Autowired MockMvc mvc;
    @MockBean IngestService ingest;

    @Test
    void postAnalysisReturnsAcceptedWithRunId() throws Exception {
        UUID id = UUID.randomUUID();
        when(ingest.ingest("alice", 50, 12)).thenReturn(new IngestService.IngestResult(id, 5, 200, 380));
        mvc.perform(post("/analysis").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"alice\",\"maxGames\":50,\"depth\":12}"))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.runId").value(id.toString()))
            .andExpect(jsonPath("$.jobsEnqueued").value(380));
    }

    @Test
    void healthIsOk() throws Exception {
        mvc.perform(get("/health")).andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
    }

    @Test
    void unknownRunIs404() throws Exception {
        mvc.perform(get("/analysis/" + UUID.randomUUID())).andExpect(status().isNotFound());
    }

    @Test
    void adminWorkersResizesPool() throws Exception {
        mvc.perform(post("/admin/workers").contentType(MediaType.APPLICATION_JSON).content("{\"count\":0}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.workers").value(0));
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest=AnalysisControllerIT` → FAIL (404/compile).

- [ ] **Step 3: Implement**

```java
package com.blunderprint.api;

import com.blunderprint.analysis.AnalysisService;
import com.blunderprint.ingest.IngestService;
import com.blunderprint.store.JobQueueRepository;
import com.blunderprint.worker.WorkerPool;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class AnalysisController {
    public record AnalyzeRequest(String username, Integer maxGames, Integer depth) {}
    public record WorkersRequest(int count) {}

    private final IngestService ingest;
    private final AnalysisService analysis;
    private final JobQueueRepository queue;
    private final WorkerPool pool;
    private final int defaultDepth;

    public AnalysisController(IngestService ingest, AnalysisService analysis, JobQueueRepository queue,
                              WorkerPool pool, @Value("${engine.depth}") int defaultDepth) {
        this.ingest = ingest;
        this.analysis = analysis;
        this.queue = queue;
        this.pool = pool;
        this.defaultDepth = defaultDepth;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true);
    }

    @PostMapping("/analysis")
    public ResponseEntity<IngestService.IngestResult> start(@RequestBody AnalyzeRequest req) {
        int max = req.maxGames() == null ? 100 : req.maxGames();
        int depth = req.depth() == null ? defaultDepth : req.depth();
        return ResponseEntity.accepted().body(ingest.ingest(req.username(), max, depth));
    }

    @GetMapping("/analysis/{runId}")
    public ResponseEntity<AnalysisService.Progress> progress(@PathVariable UUID runId) {
        try {
            return ResponseEntity.ok(analysis.progress(runId));
        } catch (EmptyResultDataAccessException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/analysis/{runId}/reenqueue")
    public Map<String, Integer> reenqueue(@PathVariable UUID runId) {
        return Map.of("jobsEnqueued", queue.enqueueForRun(runId));
    }

    @PostMapping("/admin/workers")
    public Map<String, Integer> workers(@RequestBody WorkersRequest req) {
        pool.start(req.count());
        return Map.of("workers", pool.size());
    }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && mvn -q test -Dtest=AnalysisControllerIT` → PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: REST API for analysis runs and worker control"
```

### Task 10: Load test and scaling measurements

**Files:**
- Create: `scripts/loadtest.py`
- Output: `results/loadtest.json`, `results/loadtest.png`

**Interfaces:**
- Consumes: the running backend at `http://localhost:8080` and Postgres on `localhost:5432` (credentials `chess`/`chess`).
- Produces: per worker count `{workers, seconds, fens, fens_per_sec}`, plus a warm-cache run `{enqueued, total, cache_hit_rate, seconds}`, and the machine's CPU count.

- [ ] **Step 1: Start the stack manually**

```bash
docker compose up -d postgres
cd backend && STOCKFISH_PATH=/path/to/stockfish mvn spring-boot:run
```
In another terminal, check `curl localhost:8080/health` → `{"ok":true}`. The model service is not required for this script.

- [ ] **Step 2: Write the script**

`scripts/loadtest.py`:
```python
"""Measure analysis throughput at several worker counts and the warm-cache hit rate.

Usage: python scripts/loadtest.py --username SOME_LICHESS_USER --games 40 --depth 12
"""
import argparse
import json
import os
import time

import matplotlib.pyplot as plt
import psycopg2
import requests

BASE = "http://localhost:8080"


def wait_until_done(run_id: str, timeout: int = 3600) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        p = requests.get(f"{BASE}/analysis/{run_id}").json()
        if p["doneFens"] + p["failedFens"] >= p["totalFens"]:
            return p
        time.sleep(0.5)
    raise TimeoutError("analysis did not finish")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--username", required=True)
    ap.add_argument("--games", type=int, default=40)
    ap.add_argument("--depth", type=int, default=12)
    ap.add_argument("--workers", type=int, nargs="+", default=[1, 2, 4, 8])
    args = ap.parse_args()

    db = psycopg2.connect(host="localhost", dbname="blunderprint", user="chess", password="chess")
    db.autocommit = True

    requests.post(f"{BASE}/admin/workers", json={"count": 0})
    first = requests.post(f"{BASE}/analysis", json={
        "username": args.username, "maxGames": args.games, "depth": args.depth}).json()
    run_id = first["runId"]
    print(f"run {run_id}: {first['moves']} moves from {first['games']} games")

    results = []
    for n in args.workers:
        with db.cursor() as cur:
            cur.execute("truncate eval_cache, eval_job")
        requests.post(f"{BASE}/admin/workers", json={"count": 0})
        requests.post(f"{BASE}/analysis/{run_id}/reenqueue")
        t0 = time.time()
        requests.post(f"{BASE}/admin/workers", json={"count": n})
        prog = wait_until_done(run_id)
        secs = time.time() - t0
        row = {"workers": n, "seconds": round(secs, 2), "fens": prog["doneFens"],
               "fens_per_sec": round(prog["doneFens"] / secs, 2)}
        print(row)
        results.append(row)

    # Warm cache: same player again without truncating.
    again = requests.post(f"{BASE}/analysis", json={
        "username": args.username, "maxGames": args.games, "depth": args.depth}).json()
    t0 = time.time()
    prog = wait_until_done(again["runId"])
    warm = {"enqueued": again["jobsEnqueued"], "total": prog["totalFens"],
            "cache_hit_rate": round(1 - again["jobsEnqueued"] / max(prog["totalFens"], 1), 4),
            "seconds": round(time.time() - t0, 2)}
    print("warm:", warm)

    out = {"username": args.username, "games": args.games, "depth": args.depth,
           "cpu_count": os.cpu_count(), "scaling": results, "warm_cache": warm}
    os.makedirs("results", exist_ok=True)
    with open("results/loadtest.json", "w") as f:
        json.dump(out, f, indent=2)

    plt.figure(figsize=(5, 3.5))
    plt.plot([r["workers"] for r in results], [r["fens_per_sec"] for r in results], marker="o")
    plt.xlabel("Stockfish workers")
    plt.ylabel("positions / second")
    plt.title(f"Analysis throughput (depth {args.depth}, {os.cpu_count()} CPUs)")
    plt.tight_layout()
    plt.savefig("results/loadtest.png", dpi=150)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run it**

```bash
python scripts/loadtest.py --username YOUR_LICHESS_USERNAME --games 40 --depth 12
```
Expected: printed rows for 1/2/4/8 workers, a warm-cache line with `cache_hit_rate` near 1.0, and `results/loadtest.json` plus `results/loadtest.png`. Throughput should rise with workers until it saturates at your CPU count. If it does not scale at all, investigate (queue contention, `Threads` option, DB pool) before moving on, because this is your main systems result.

- [ ] **Step 4: Commit**

```bash
git add scripts/loadtest.py results/loadtest.json results/loadtest.png && git commit -m "feat: load test and scaling results"
```

---

# Phase 3: Python human-move model

### Task 11: Feature and move encoding

**Files:**
- Create: `ml/src/blunderprint_ml/encoding.py`
- Test: `ml/tests/test_encoding.py`

**Interfaces:**
- Produces: `N_FEATURES = 772`, `N_MOVES = 4096`, `N_BUCKETS = 10`
- Produces: `encode_board(board: chess.Board) -> np.ndarray` (uint8, shape `(772,)`), always from the mover's perspective (board mirrored when Black is to move; the first 768 values are 12 piece planes × 64 squares, the last 4 are castling rights: mover-K, mover-Q, opp-K, opp-Q)
- Produces: `move_index(move: chess.Move, black_to_move: bool) -> int` (`from*64+to`, mirrored for Black), `legal_mask(board) -> np.ndarray` (bool, `(4096,)`), `rating_bucket(rating: int | None) -> int` (`clamp((r-800)//200, 0, 9)`; `None` → bucket for 1500)

- [ ] **Step 1: Write the failing tests**

```python
import chess
import numpy as np

from blunderprint_ml.encoding import (
    N_FEATURES, N_MOVES, encode_board, legal_mask, move_index, rating_bucket,
)


def test_shapes_and_start_position_piece_count():
    x = encode_board(chess.Board())
    assert x.shape == (N_FEATURES,) and x.dtype == np.uint8
    assert x[:768].sum() == 32
    assert x[768:].tolist() == [1, 1, 1, 1]


def test_black_to_move_is_mirrored_so_mover_is_always_white():
    b = chess.Board()
    b.push_san("e4")                    # black to move
    x = encode_board(b)
    # Mover's pawns (black, mirrored to "white") occupy rank 2 => squares 8..15 in plane 0.
    assert x[0 * 64 + 8: 0 * 64 + 16].sum() == 8


def test_move_index_matches_for_mirrored_equivalent_moves():
    assert move_index(chess.Move.from_uci("e2e4"), False) == 12 * 64 + 28
    assert move_index(chess.Move.from_uci("e7e5"), True) == 12 * 64 + 28


def test_legal_mask_counts_start_moves():
    assert legal_mask(chess.Board()).sum() == 20
    assert legal_mask(chess.Board()).shape == (N_MOVES,)


def test_promotions_collapse_to_one_index():
    b = chess.Board("8/P6k/8/8/8/8/8/K7 w - - 0 1")
    mask = legal_mask(b)
    assert mask[move_index(chess.Move.from_uci("a7a8q"), False)]
    assert move_index(chess.Move.from_uci("a7a8q"), False) == move_index(chess.Move.from_uci("a7a8n"), False)


def test_rating_bucket():
    assert rating_bucket(500) == 0
    assert rating_bucket(1500) == 3
    assert rating_bucket(2900) == 9
    assert rating_bucket(None) == 3
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ml && pytest tests/test_encoding.py -q` → FAIL (`ModuleNotFoundError`).

- [ ] **Step 3: Implement**

```python
"""Position and move encoding. Always from the mover's perspective: Black-to-move
positions are mirrored so the mover is 'white'."""
import chess
import numpy as np

N_FEATURES = 772
N_MOVES = 4096
N_BUCKETS = 10


def encode_board(board: chess.Board) -> np.ndarray:
    b = board.mirror() if board.turn == chess.BLACK else board
    x = np.zeros(N_FEATURES, dtype=np.uint8)
    for sq, piece in b.piece_map().items():
        plane = (piece.piece_type - 1) + (0 if piece.color == chess.WHITE else 6)
        x[plane * 64 + sq] = 1
    x[768] = b.has_kingside_castling_rights(chess.WHITE)
    x[769] = b.has_queenside_castling_rights(chess.WHITE)
    x[770] = b.has_kingside_castling_rights(chess.BLACK)
    x[771] = b.has_queenside_castling_rights(chess.BLACK)
    return x


def move_index(move: chess.Move, black_to_move: bool) -> int:
    f, t = move.from_square, move.to_square
    if black_to_move:
        f, t = chess.square_mirror(f), chess.square_mirror(t)
    return f * 64 + t


def legal_mask(board: chess.Board) -> np.ndarray:
    mask = np.zeros(N_MOVES, dtype=bool)
    black = board.turn == chess.BLACK
    for m in board.legal_moves:
        mask[move_index(m, black)] = True
    return mask


def rating_bucket(rating: int | None) -> int:
    r = 1500 if rating is None else rating
    return int(min(max((r - 800) // 200, 0), N_BUCKETS - 1))
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ml && pytest tests/test_encoding.py -q` → `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: board and move encoding"
```

### Task 12: Dataset builder with player-level split

**Files:**
- Create: `ml/src/blunderprint_ml/data.py`
- Test: `ml/tests/test_data.py`
- Operational: download one Lichess monthly dump from https://database.lichess.org (standard rated games, `.pgn.zst`) into `ml/data/`. Start with a small month. A few GB compressed is plenty; the builder stops after the position caps.

**Interfaces:**
- Consumes: `encode_board`, `move_index`, `legal_mask`, `rating_bucket`
- Produces: `split_of(name: str) -> str` (`"test"` if `md5 % 10 == 0`, `"val"` if `== 1`, else `"train"`)
- Produces: `game_split(white: str, black: str) -> str | None` (the shared split, or `None` if they differ)
- Produces: `build(pgn_path, out_dir, caps={"train":500_000,"val":20_000,"test":50_000}, min_ply=10, sample_prob=0.33, seed=0, min_base_seconds=180)` writing, per split, `X_{split}.npy` (uint8 N×772), `y_{split}.npy` (int16), `rb_{split}.npy` (uint8), `ply_{split}.npy`, and for `val`/`test` only `nlegal_{split}.npy` (int16) and `L_{split}.npy` (`np.packbits` of the legal mask, N×512 uint8), plus `meta.json` with counts and the dump file name.

- [ ] **Step 1: Write the failing test**

```python
import json
import random

import chess
import chess.pgn
import numpy as np

from blunderprint_ml.data import build, game_split, split_of


def _names_in(split: str, n: int) -> list[str]:
    out, i = [], 0
    while len(out) < n:
        name = f"player{i}"
        if split_of(name) == split:
            out.append(name)
        i += 1
    return out


def _write_games(path, white, black, n_games, seed=0):
    rng = random.Random(seed)
    with open(path, "w") as f:
        for _ in range(n_games):
            board = chess.Board()
            game = chess.pgn.Game()
            game.headers.update({"White": white, "Black": black, "WhiteElo": "1500", "BlackElo": "1480",
                                 "TimeControl": "300+0", "Result": "1/2-1/2"})
            node = game
            for _ in range(60):
                if board.is_game_over():
                    break
                m = rng.choice(list(board.legal_moves))
                board.push(m)
                node = node.add_variation(m)
            print(game, file=f, end="\n\n")


def test_split_is_deterministic_and_ten_percent_buckets():
    assert split_of("abc") == split_of("abc")
    names = [f"n{i}" for i in range(2000)]
    test_share = sum(split_of(n) == "test" for n in names) / len(names)
    assert 0.06 < test_share < 0.14


def test_game_split_requires_same_bucket():
    a, b = _names_in("train", 2)
    c = _names_in("test", 1)[0]
    assert game_split(a, b) == "train"
    assert game_split(a, c) is None


def test_build_writes_arrays_and_respects_split(tmp_path):
    tr = _names_in("train", 2)
    te = _names_in("test", 2)
    pgn = tmp_path / "g.pgn"
    _write_games(pgn, tr[0], tr[1], 6, seed=1)
    with open(pgn, "a") as f:
        pass
    pgn2 = tmp_path / "g2.pgn"
    _write_games(pgn2, te[0], te[1], 6, seed=2)
    combined = tmp_path / "all.pgn"
    combined.write_text(pgn.read_text() + pgn2.read_text())

    out = tmp_path / "out"
    build(str(combined), str(out), caps={"train": 100, "val": 10, "test": 100}, sample_prob=1.0, min_ply=10)

    meta = json.loads((out / "meta.json").read_text())
    assert meta["counts"]["train"] > 0 and meta["counts"]["test"] > 0 and meta["counts"]["val"] == 0
    X = np.load(out / "X_train.npy")
    y = np.load(out / "y_train.npy")
    assert X.shape == (meta["counts"]["train"], 772)
    assert y.min() >= 0 and y.max() < 4096
    assert np.load(out / "L_test.npy").shape == (meta["counts"]["test"], 512)
    assert not (out / "L_train.npy").exists()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ml && pytest tests/test_data.py -q` → FAIL (`ImportError`).

- [ ] **Step 3: Implement**

```python
"""Build player-split training arrays from a Lichess PGN dump (.pgn or .pgn.zst)."""
import hashlib
import io
import json
import os
import random
import re

import chess
import chess.pgn
import numpy as np

from .encoding import N_FEATURES, encode_board, legal_mask, move_index, rating_bucket

DEFAULT_CAPS = {"train": 500_000, "val": 20_000, "test": 50_000}


def split_of(name: str) -> str:
    h = int(hashlib.md5(name.encode()).hexdigest(), 16) % 10
    return "test" if h == 0 else "val" if h == 1 else "train"


def game_split(white: str, black: str) -> str | None:
    s = split_of(white)
    return s if s == split_of(black) else None


def _open(path: str):
    if path.endswith(".zst"):
        import zstandard
        return io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(open(path, "rb")), encoding="utf-8")
    return open(path, encoding="utf-8")


def _base_seconds(tc: str) -> int:
    m = re.match(r"^(\d+)\+\d+$", tc or "")
    return int(m.group(1)) if m else 0


def build(pgn_path: str, out_dir: str, caps: dict | None = None, min_ply: int = 10,
          sample_prob: float = 0.33, seed: int = 0, min_base_seconds: int = 180) -> None:
    caps = caps or DEFAULT_CAPS
    os.makedirs(out_dir, exist_ok=True)
    rng = random.Random(seed)
    X = {s: np.zeros((caps[s], N_FEATURES), dtype=np.uint8) for s in caps}
    y = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    rb = {s: np.zeros(caps[s], dtype=np.uint8) for s in caps}
    nl = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    ply_arr = {s: np.zeros(caps[s], dtype=np.int16) for s in caps}
    L = {s: np.zeros((caps[s], 512), dtype=np.uint8) for s in ("val", "test") if s in caps}
    n = {s: 0 for s in caps}

    with _open(pgn_path) as fh:
        while any(n[s] < caps[s] for s in caps):
            game = chess.pgn.read_game(fh)
            if game is None:
                break
            h = game.headers
            white, black = h.get("White", "?"), h.get("Black", "?")
            split = game_split(white, black)
            if split is None or split not in caps or n[split] >= caps[split]:
                continue
            if not (h.get("WhiteElo", "").isdigit() and h.get("BlackElo", "").isdigit()):
                continue
            if _base_seconds(h.get("TimeControl", "")) < min_base_seconds:
                continue
            board = game.board()
            for ply, move in enumerate(game.mainline_moves()):
                if ply >= min_ply and n[split] < caps[split] and rng.random() < sample_prob:
                    rating = int(h["WhiteElo"] if board.turn == chess.WHITE else h["BlackElo"])
                    i = n[split]
                    X[split][i] = encode_board(board)
                    y[split][i] = move_index(move, board.turn == chess.BLACK)
                    rb[split][i] = rating_bucket(rating)
                    mask = legal_mask(board)
                    nl[split][i] = int(mask.sum())
                    ply_arr[split][i] = ply
                    if split in L:
                        L[split][i] = np.packbits(mask)
                    n[split] += 1
                board.push(move)

    for s in caps:
        k = n[s]
        np.save(os.path.join(out_dir, f"X_{s}.npy"), X[s][:k])
        np.save(os.path.join(out_dir, f"y_{s}.npy"), y[s][:k])
        np.save(os.path.join(out_dir, f"rb_{s}.npy"), rb[s][:k])
        np.save(os.path.join(out_dir, f"nlegal_{s}.npy"), nl[s][:k])
        np.save(os.path.join(out_dir, f"ply_{s}.npy"), ply_arr[s][:k])
        if s in L:
            np.save(os.path.join(out_dir, f"L_{s}.npy"), L[s][:k])
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump({"counts": n, "source": os.path.basename(pgn_path), "min_ply": min_ply,
                   "sample_prob": sample_prob, "seed": seed}, f, indent=2)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn")
    ap.add_argument("--out", default="data/processed")
    args = ap.parse_args()
    build(args.pgn, args.out)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ml && pytest tests/test_data.py -q` → `3 passed`.

- [ ] **Step 5: Build the real dataset and record timing (this feeds Task 14)**

```bash
cd ml && time python -m blunderprint_ml.data data/lichess_db_standard_rated_YYYY-MM.pgn.zst --out data/processed
```
Expected: `data/processed/` contains the `.npy` files and `meta.json` with counts near the caps. Write down the wall-clock time and the counts.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: player-split dataset builder"
```

### Task 13: Models, training, evaluation vs baselines

**Files:**
- Create: `ml/src/blunderprint_ml/models.py`, `train.py`, `evaluate.py`
- Test: `ml/tests/test_models.py`
- Output: `ml/checkpoints/linear.pt`, `ml/checkpoints/mlp.pt`, `results/model_eval.json`

**Interfaces:**
- Produces: `LinearModel(n_buckets=10, emb=16)` and `MLP(hidden=1024, n_buckets=10, emb=16)`, both `forward(x: uint8 Tensor [B,772], rb: long Tensor [B]) -> Tensor [B,4096]` logits
- Produces: `masked_top1(logits, packed_mask, y) -> (correct: Tensor[bool])`; `train(model_name, data_dir, out_path, epochs=5, batch=1024, lr=1e-3, seed=0) -> dict` (history with `val_top1` per epoch); checkpoints saved as `{"model": name, "state_dict": ..., "config": {...}}`
- Produces: `load_checkpoint(path) -> nn.Module` (eval mode)
- Produces: `evaluate.py` writing `results/model_eval.json` with, per model (`uniform`, `linear`, `mlp`), overall top-1 and `by_bucket` top-1 on the **test** split

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np
import torch

from blunderprint_ml.models import MLP, LinearModel, load_checkpoint, masked_top1
from blunderprint_ml.train import train


def test_forward_shapes():
    x = torch.zeros(3, 772, dtype=torch.uint8)
    rb = torch.tensor([0, 3, 9])
    assert LinearModel()(x, rb).shape == (3, 4096)
    assert MLP(hidden=32)(x, rb).shape == (3, 4096)


def test_masked_top1_only_considers_legal_moves():
    logits = torch.zeros(1, 4096)
    logits[0, 5] = 10.0          # illegal but highest
    logits[0, 7] = 1.0           # legal
    mask = np.zeros((1, 4096), dtype=bool)
    mask[0, 7] = True
    packed = torch.from_numpy(np.packbits(mask, axis=1))
    assert masked_top1(logits, packed, torch.tensor([7])).tolist() == [True]


def _tiny_dataset(path, n=256, seed=0):
    rng = np.random.default_rng(seed)
    path.mkdir(parents=True, exist_ok=True)
    for split, k in (("train", n), ("val", 64), ("test", 64)):
        X = (rng.random((k, 772)) < 0.05).astype(np.uint8)
        X[:, :8] = (rng.random((k, 8)) < 0.5).astype(np.uint8)
        y = (X[:, 0] + 2 * X[:, 1]).astype(np.int16)              # 4 balanced classes, learnable from 2 features
        np.save(path / f"X_{split}.npy", X)
        np.save(path / f"y_{split}.npy", y)
        np.save(path / f"rb_{split}.npy", rng.integers(0, 10, k).astype(np.uint8))
        if split != "train":
            mask = np.zeros((k, 4096), dtype=bool)
            mask[:, :4] = True
            np.save(path / f"L_{split}.npy", np.packbits(mask, axis=1))


def test_training_improves_and_checkpoint_roundtrips(tmp_path):
    _tiny_dataset(tmp_path / "d")
    hist = train("mlp", str(tmp_path / "d"), str(tmp_path / "m.pt"), epochs=8, batch=64, lr=3e-3, hidden=64)
    assert hist["val_top1"][-1] >= hist["val_top1"][0]
    assert hist["val_top1"][-1] > 0.5           # well above 1/4 chance over the 4 balanced classes
    model = load_checkpoint(str(tmp_path / "m.pt"))
    out = model(torch.zeros(2, 772, dtype=torch.uint8), torch.tensor([1, 2]))
    assert out.shape == (2, 4096)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ml && pytest tests/test_models.py -q` → FAIL (`ImportError`).

- [ ] **Step 3: Implement models**

`models.py`:
```python
import numpy as np
import torch
import torch.nn as nn

from .encoding import N_BUCKETS, N_FEATURES, N_MOVES


class LinearModel(nn.Module):
    def __init__(self, n_buckets: int = N_BUCKETS, emb: int = 16):
        super().__init__()
        self.emb = nn.Embedding(n_buckets, emb)
        self.out = nn.Linear(N_FEATURES + emb, N_MOVES)

    def forward(self, x, rb):
        return self.out(torch.cat([x.float(), self.emb(rb)], dim=1))


class MLP(nn.Module):
    def __init__(self, hidden: int = 1024, n_buckets: int = N_BUCKETS, emb: int = 16):
        super().__init__()
        self.emb = nn.Embedding(n_buckets, emb)
        self.net = nn.Sequential(
            nn.Linear(N_FEATURES + emb, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, N_MOVES),
        )

    def forward(self, x, rb):
        return self.net(torch.cat([x.float(), self.emb(rb)], dim=1))


def build_model(name: str, **config) -> nn.Module:
    if name == "linear":
        return LinearModel()
    if name == "mlp":
        return MLP(hidden=config.get("hidden", 1024))
    raise ValueError(name)


def masked_top1(logits: torch.Tensor, packed_mask: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
    mask = np.unpackbits(packed_mask.cpu().numpy(), axis=1)[:, :N_MOVES].astype(bool)
    masked = logits.masked_fill(~torch.from_numpy(mask).to(logits.device), float("-inf"))
    return masked.argmax(dim=1) == y


def load_checkpoint(path: str) -> nn.Module:
    ck = torch.load(path, map_location="cpu")
    model = build_model(ck["model"], **ck["config"])
    model.load_state_dict(ck["state_dict"])
    model.eval()
    return model
```

`train.py`:
```python
import os

import numpy as np
import torch
import torch.nn.functional as F

from .models import build_model, masked_top1


def _load(data_dir, split, with_mask):
    d = lambda n: np.load(os.path.join(data_dir, f"{n}_{split}.npy"))
    out = {"X": torch.from_numpy(d("X")), "y": torch.from_numpy(d("y").astype(np.int64)),
           "rb": torch.from_numpy(d("rb").astype(np.int64))}
    if with_mask:
        out["L"] = torch.from_numpy(d("L"))
    return out


@torch.no_grad()
def _val_top1(model, data, batch=4096):
    model.eval()
    correct = 0
    for i in range(0, len(data["y"]), batch):
        sl = slice(i, i + batch)
        logits = model(data["X"][sl], data["rb"][sl])
        correct += masked_top1(logits, data["L"][sl], data["y"][sl]).sum().item()
    return correct / max(len(data["y"]), 1)


def train(model_name, data_dir, out_path, epochs=5, batch=1024, lr=1e-3, seed=0, hidden=1024):
    torch.manual_seed(seed)
    tr, va = _load(data_dir, "train", False), _load(data_dir, "val", True)
    config = {"hidden": hidden} if model_name == "mlp" else {}
    model = build_model(model_name, **config)
    opt = torch.optim.AdamW(model.parameters(), lr=lr)
    n = len(tr["y"])
    hist = {"train_loss": [], "val_top1": []}
    best = -1.0
    for epoch in range(epochs):
        model.train()
        perm = torch.randperm(n)
        total = 0.0
        for i in range(0, n, batch):
            idx = perm[i:i + batch]
            logits = model(tr["X"][idx], tr["rb"][idx])
            loss = F.cross_entropy(logits, tr["y"][idx])
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item() * len(idx)
        acc = _val_top1(model, va)
        hist["train_loss"].append(total / n)
        hist["val_top1"].append(acc)
        print(f"epoch {epoch + 1}/{epochs} loss={total / n:.4f} val_top1={acc:.4f}")
        if acc > best:
            best = acc
            os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
            torch.save({"model": model_name, "state_dict": model.state_dict(), "config": config}, out_path)
    return hist


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["linear", "mlp"], required=True)
    ap.add_argument("--data", default="data/processed")
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=int, default=5)
    ap.add_argument("--batch", type=int, default=1024)
    ap.add_argument("--lr", type=float, default=1e-3)
    args = ap.parse_args()
    train(args.model, args.data, args.out, args.epochs, args.batch, args.lr)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ml && pytest tests/test_models.py -q` → `3 passed`.

- [ ] **Step 5: Write `evaluate.py`**

```python
"""Evaluate baselines and trained models on the held-out test split (player-disjoint)."""
import json
import os

import numpy as np
import torch

from .models import load_checkpoint, masked_top1


def evaluate(data_dir: str, checkpoints: dict[str, str], out_path: str) -> dict:
    X = torch.from_numpy(np.load(os.path.join(data_dir, "X_test.npy")))
    y = torch.from_numpy(np.load(os.path.join(data_dir, "y_test.npy")).astype(np.int64))
    rb = torch.from_numpy(np.load(os.path.join(data_dir, "rb_test.npy")).astype(np.int64))
    L = torch.from_numpy(np.load(os.path.join(data_dir, "L_test.npy")))
    nlegal = np.load(os.path.join(data_dir, "nlegal_test.npy"))

    def summarize(correct: np.ndarray) -> dict:
        by_bucket = {int(b): float(correct[rb.numpy() == b].mean()) for b in np.unique(rb.numpy())}
        return {"top1": float(correct.mean()), "by_bucket": by_bucket}

    results = {"n_test": int(len(y))}
    uniform = 1.0 / nlegal
    results["uniform"] = {"top1": float(uniform.mean()),
                          "by_bucket": {int(b): float(uniform[rb.numpy() == b].mean())
                                        for b in np.unique(rb.numpy())}}
    for name, path in checkpoints.items():
        model = load_checkpoint(path)
        correct = []
        with torch.no_grad():
            for i in range(0, len(y), 4096):
                sl = slice(i, i + 4096)
                correct.append(masked_top1(model(X[sl], rb[sl]), L[sl], y[sl]).numpy())
        results[name] = summarize(np.concatenate(correct))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    return results


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/processed")
    ap.add_argument("--linear", default="checkpoints/linear.pt")
    ap.add_argument("--mlp", default="checkpoints/mlp.pt")
    ap.add_argument("--out", default="../results/model_eval.json")
    args = ap.parse_args()
    r = evaluate(args.data, {"linear": args.linear, "mlp": args.mlp}, args.out)
    print(json.dumps({k: (v["top1"] if isinstance(v, dict) else v) for k, v in r.items()}, indent=2))
```

- [ ] **Step 6: Train and evaluate for real**

```bash
cd ml
python -m blunderprint_ml.train --model linear --data data/processed --out checkpoints/linear.pt --epochs 5
python -m blunderprint_ml.train --model mlp --data data/processed --out checkpoints/mlp.pt --epochs 8
python -m blunderprint_ml.evaluate
```
Expected: `results/model_eval.json` exists. Order should be uniform < linear < mlp on top-1. If the MLP does not beat linear, train more epochs or increase `hidden` before concluding anything; report the numbers honestly either way.

- [ ] **Step 7 (optional, only if time remains): small CNN**

Add `class CNN(nn.Module)` in `models.py` (reshape the first 768 inputs to 12×8×8, three 3×3 conv layers of 64 channels, flatten, concat castling bits and bucket embedding, linear to 4096), register it in `build_model`, train, and add it to `evaluate.py`'s checkpoint dict. Skip it if the MLP result already supports the story.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: baselines, MLP, training and evaluation; results/model_eval.json"
```

### Task 14: Profile preprocessing (Rust decision gate)

**Files:**
- Create: `scripts/profile_encode.py`
- Output: `results/profile_encode.txt`

**Interfaces:**
- Produces: a printed and saved report of the fraction of dataset-build wall-clock time spent in `encode_board`. **Gate:** if the fraction is **> 0.40**, do Task 21; otherwise skip it and keep this report as evidence.

- [ ] **Step 1: Write the script**

```python
"""Profile dataset building on a small slice to decide whether a Rust encoder is justified.

Usage (from repo root): python scripts/profile_encode.py ml/data/<dump>.pgn.zst
"""
import cProfile
import pstats
import sys
import tempfile

sys.path.insert(0, "ml/src")
from blunderprint_ml.data import build  # noqa: E402


def main(pgn: str) -> None:
    prof = cProfile.Profile()
    with tempfile.TemporaryDirectory() as out:
        prof.enable()
        build(pgn, out, caps={"train": 20_000, "val": 0, "test": 0}, sample_prob=0.33)
        prof.disable()
    stats = pstats.Stats(prof)
    total = stats.total_tt
    encode = sum(v[3] for k, v in stats.stats.items() if k[2] == "encode_board")   # cumulative time
    frac = encode / total
    report = f"total={total:.1f}s encode_board_cumulative={encode:.1f}s fraction={frac:.2f}\n"
    report += "GATE: build the Rust encoder (Task 21)\n" if frac > 0.40 else "GATE: skip Rust; profile shows encoding is not the bottleneck\n"
    print(report)
    with open("results/profile_encode.txt", "w") as f:
        f.write(report)


if __name__ == "__main__":
    main(sys.argv[1])
```
`caps` with `val`/`test` of 0 makes the builder skip those splits quickly (`n[s] < caps[s]` is false). If `build` raises on a zero cap, set them to 1.

- [ ] **Step 2: Run it**

```bash
python scripts/profile_encode.py ml/data/lichess_db_standard_rated_YYYY-MM.pgn.zst
```
Expected: a `fraction=` value and a `GATE:` line. Record it. Decide: continue straight to Phase 4 (most likely PGN parsing dominates, so Rust is skipped).

- [ ] **Step 3: Commit**

```bash
git add scripts/profile_encode.py results/profile_encode.txt && git commit -m "chore: profile preprocessing for the Rust gate"
```

---

# Phase 4: Mistake analysis and report

### Task 15: Rule-based mistake tags

**Files:**
- Create: `ml/src/blunderprint_ml/tags.py`
- Test: `ml/tests/test_tags.py`

**Interfaces:**
- Produces: `MISTAKE_CPL = 100`, `tag_move(board_before: chess.Board, played: chess.Move, best: chess.Move | None, cpl: int, clock_cs: int | None) -> list[str]`
- Tags: `hanging_piece`, `missed_tactic`, `opening_error`, `endgame_technique`, `time_trouble`, `other`. Returns `[]` when `cpl < MISTAKE_CPL`. Returns `["other"]` if it is a mistake but no rule fires.

- [ ] **Step 1: Write the failing tests**

```python
import chess

from blunderprint_ml.tags import tag_move


def mv(u):
    return chess.Move.from_uci(u)


def test_not_a_mistake_has_no_tags():
    assert tag_move(chess.Board(), mv("e2e4"), mv("d2d4"), 50, None) == []


def test_hanging_piece():
    b = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2")
    tags = tag_move(b, mv("d1g4"), mv("e4d5"), 400, None)      # queen walks into Bc8xg4
    assert "hanging_piece" in tags


def test_safe_capture_is_not_hanging():
    b = chess.Board("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2")
    assert "hanging_piece" not in tag_move(b, mv("e4d5"), mv("e4e5"), 120, None)


def test_missed_tactic_when_best_is_check_and_played_is_quiet():
    b = chess.Board("6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30")
    tags = tag_move(b, mv("g2g3"), mv("a1a8"), 1000, None)
    assert "missed_tactic" in tags


def test_opening_error():
    assert "opening_error" in tag_move(chess.Board(), mv("e2e4"), mv("d2d4"), 150, None)


def test_endgame_technique():
    b = chess.Board("8/8/4k3/8/8/4K3/4P3/8 w - - 0 60")
    assert "endgame_technique" in tag_move(b, mv("e3d3"), mv("e3f3"), 150, None)


def test_time_trouble():
    b = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3")
    assert "time_trouble" in tag_move(b, mv("a2a3"), mv("f1b5"), 120, 1000)


def test_falls_back_to_other():
    b = chess.Board("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 13")
    assert tag_move(b, mv("a2a3"), mv("f1b5"), 120, None) == ["other"]
```
The last position sets the fullmove counter to 13 so `opening_error` does not fire, with plenty of pieces so `endgame_technique` does not fire, and a quiet move/quiet best move so `missed_tactic` does not fire.

- [ ] **Step 2: Run to verify failure**

Run: `cd ml && pytest tests/test_tags.py -q` → FAIL (`ImportError`).

- [ ] **Step 3: Implement**

```python
"""Rule-based, explainable mistake tags."""
import chess

MISTAKE_CPL = 100
_VALUE = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def _hanging_after(board_before: chess.Board, move: chess.Move) -> bool:
    b = board_before.copy()
    mover = b.turn
    b.push(move)
    opp = not mover
    for sq, piece in b.piece_map().items():
        if piece.color != mover or piece.piece_type in (chess.KING, chess.PAWN):
            continue
        attackers = b.attackers(opp, sq)
        if not attackers:
            continue
        defenders = b.attackers(mover, sq)
        cheapest = min(_VALUE.get(b.piece_type_at(a), 100) for a in attackers)   # a king attacker counts as 100
        if not defenders or cheapest < _VALUE[piece.piece_type]:
            return True
    return False


def _forcing(board: chess.Board, move: chess.Move) -> bool:
    return board.is_capture(move) or board.gives_check(move)


def _non_pawn_pieces(board: chess.Board) -> int:
    return sum(1 for p in board.piece_map().values() if p.piece_type not in (chess.PAWN, chess.KING))


def tag_move(board_before: chess.Board, played: chess.Move, best: chess.Move | None,
             cpl: int, clock_cs: int | None) -> list[str]:
    if cpl < MISTAKE_CPL:
        return []
    tags = []
    if _hanging_after(board_before, played):
        tags.append("hanging_piece")
    if best is not None and cpl >= 200 and _forcing(board_before, best) and not _forcing(board_before, played):
        tags.append("missed_tactic")
    if board_before.fullmove_number <= 10:
        tags.append("opening_error")
    if _non_pawn_pieces(board_before) <= 4:
        tags.append("endgame_technique")
    if clock_cs is not None and clock_cs < 3000:
        tags.append("time_trouble")
    return tags or ["other"]
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ml && pytest tests/test_tags.py -q` → `8 passed`. If `test_hanging_piece` fails, print `b.attackers(chess.BLACK, chess.G4)` for the position after `d1g4`: the bishop on c8 must attack g4, since the d7 pawn has moved to d5.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: rule-based mistake tags"
```

### Task 16: Inference and FastAPI service

**Files:**
- Create: `ml/src/blunderprint_ml/inference.py`, `ml/src/blunderprint_ml/service.py`
- Test: `ml/tests/test_service.py`

**Interfaces:**
- Consumes: `load_checkpoint`, `encode_board`, `legal_mask`, `move_index`, `rating_bucket`, `tag_move`
- Produces: `p_played(model, fen: str, rating: int | None, played_uci: str) -> float` (softmax over legal moves; promotions of the same from/to share one index, so the probability is for the from/to pair)
- Produces: FastAPI `app` with `GET /health` and `POST /analyze` matching the wire format in Task 8. Model path from env `MODEL_CKPT` (default `checkpoints/mlp.pt`), loaded at startup.

- [ ] **Step 1: Write the failing tests**

```python
import chess
import numpy as np
import torch
from fastapi.testclient import TestClient

from blunderprint_ml.inference import p_played, legal_distribution
from blunderprint_ml.models import MLP


def _model():
    torch.manual_seed(0)
    return MLP(hidden=32).eval()


def test_distribution_sums_to_one_over_legal_moves():
    dist = legal_distribution(_model(), chess.STARTING_FEN, 1500)
    assert abs(sum(dist.values()) - 1.0) < 1e-5
    assert len(dist) == 20


def test_p_played_in_unit_interval_and_matches_distribution():
    m = _model()
    p = p_played(m, chess.STARTING_FEN, 1500, "e2e4")
    assert 0.0 < p < 1.0
    assert abs(p - legal_distribution(m, chess.STARTING_FEN, 1500)[chess.Move.from_uci("e2e4")]) < 1e-9


def test_service_analyze_roundtrip(tmp_path, monkeypatch):
    ck = tmp_path / "m.pt"
    torch.save({"model": "mlp", "state_dict": _model().state_dict(), "config": {"hidden": 32}}, ck)
    monkeypatch.setenv("MODEL_CKPT", str(ck))
    from blunderprint_ml import service
    with TestClient(service.create_app()) as client:
        assert client.get("/health").json() == {"ok": True}
        body = {"moves": [{"id": 5, "fen": chess.STARTING_FEN, "rating": 1500, "played_uci": "e2e4",
                           "best_uci": "d2d4", "cpl": 150, "clock_cs": None}]}
        out = client.post("/analyze", json=body).json()
        assert out[0]["id"] == 5
        assert 0.0 < out[0]["p_played"] < 1.0
        assert "opening_error" in out[0]["tags"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ml && pytest tests/test_service.py -q` → FAIL (`ImportError`).

- [ ] **Step 3: Implement**

`inference.py`:
```python
import chess
import numpy as np
import torch

from .encoding import encode_board, legal_mask, move_index, rating_bucket


@torch.no_grad()
def legal_distribution(model, fen: str, rating: int | None) -> dict[chess.Move, float]:
    board = chess.Board(fen)
    x = torch.from_numpy(encode_board(board)).unsqueeze(0)
    rb = torch.tensor([rating_bucket(rating)])
    logits = model(x, rb)[0]
    mask = torch.from_numpy(legal_mask(board))
    probs = torch.softmax(logits.masked_fill(~mask, float("-inf")), dim=0).numpy()
    black = board.turn == chess.BLACK
    return {m: float(probs[move_index(m, black)]) for m in board.legal_moves}


def p_played(model, fen: str, rating: int | None, played_uci: str) -> float:
    board = chess.Board(fen)
    played = chess.Move.from_uci(played_uci)
    black = board.turn == chess.BLACK
    x = torch.from_numpy(encode_board(board)).unsqueeze(0)
    with torch.no_grad():
        logits = model(x, torch.tensor([rating_bucket(rating)]))[0]
        mask = torch.from_numpy(legal_mask(board))
        probs = torch.softmax(logits.masked_fill(~mask, float("-inf")), dim=0).numpy()
    return float(probs[move_index(played, black)])
```
Note on the distribution test: `legal_distribution` returns per-legal-move entries, and promotions that share a from/to index would each carry the same shared probability. The start position has no promotions, so the sum-to-one test is exact there.

`service.py`:
```python
import os
from contextlib import asynccontextmanager

import chess
from fastapi import FastAPI
from pydantic import BaseModel

from .inference import p_played
from .models import load_checkpoint
from .tags import tag_move


class MoveIn(BaseModel):
    id: int
    fen: str
    rating: int | None = None
    played_uci: str
    best_uci: str | None = None
    cpl: int
    clock_cs: int | None = None


class AnalyzeRequest(BaseModel):
    moves: list[MoveIn]


class MoveOut(BaseModel):
    id: int
    p_played: float
    tags: list[str]


def create_app() -> FastAPI:
    state = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        state["model"] = load_checkpoint(os.environ.get("MODEL_CKPT", "checkpoints/mlp.pt"))
        yield

    app = FastAPI(lifespan=lifespan)

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.post("/analyze", response_model=list[MoveOut])
    def analyze(req: AnalyzeRequest):
        out = []
        for m in req.moves:
            board = chess.Board(m.fen)
            played = chess.Move.from_uci(m.played_uci)
            best = chess.Move.from_uci(m.best_uci) if m.best_uci else None
            out.append(MoveOut(
                id=m.id,
                p_played=p_played(state["model"], m.fen, m.rating, m.played_uci),
                tags=tag_move(board, played, best, m.cpl, m.clock_cs),
            ))
        return out

    return app


app = create_app()
```
Run it with `uvicorn blunderprint_ml.service:app --port 8000` (from `ml/`, with `MODEL_CKPT` pointing at the trained checkpoint).

- [ ] **Step 4: Run to verify pass**

Run: `cd ml && pytest tests/test_service.py -q` → `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: move-probability inference and FastAPI service"
```

### Task 17: Report builder and endpoints

**Files:**
- Create: `backend/src/main/java/com/blunderprint/report/ReportService.java`
- Modify: `backend/src/main/java/com/blunderprint/api/AnalysisController.java` (add two endpoints and a constructor argument)
- Test: `backend/src/test/java/com/blunderprint/report/ReportServiceIT.java`

**Interfaces:**
- Consumes: tables `analysis_run`, `move`, `move_analysis`; config `report.mistake-cpl`, `report.min-p-played`
- Produces: `ReportService.report(String username): Optional<Report>`, using the most recent `DONE` run for the user. `record Report(String username, UUID runId, int movesAnalyzed, int mistakes, int candidates, List<PatternSummary> patterns)`, `record PatternSummary(String tag, int count, double avgCpl, List<Example> examples)`, `record Example(String gameId, int ply, String fen, String played, String best, int cpl, double pPlayed)` (top 3 per tag by cpl; candidates only, i.e. cpl ≥ mistake threshold and `p_played` ≥ min-p)
- Produces: `ReportService.mistakes(String username): List<MistakeRow>` where `record MistakeRow(String gameId, long playedAtEpochSec, int ply, int cpl, Double pPlayed, List<String> tags)`, for **all** moves of the latest DONE run (used by Task 18)
- Produces endpoints: `GET /players/{username}/report` (404 if none), `GET /players/{username}/mistakes`

- [ ] **Step 1: Write the failing test**

```java
package com.blunderprint.report;

import static org.junit.jupiter.api.Assertions.*;

import com.blunderprint.PostgresIT;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class ReportServiceIT extends PostgresIT {
    @Autowired ReportService reports;

    private void seed(UUID run, String status) {
        jdbc.update("insert into analysis_run(id, username, engine, depth, status) values (?, 'alice', 'sf', 10, ?)", run, status);
        jdbc.update("insert into game(id, white, black, played_at) values ('g1', 'alice', 'x', now()) on conflict do nothing");
    }

    private void move(UUID run, int ply, int cpl, Double p, String tags) {
        long id = jdbc.queryForObject("""
            insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key, after_key, played_uci, played_san)
            values (?, 'g1', ?, ?, 'w', 1500, 'FEN', 'k', 'k2', 'e2e4', 'e4') returning id""", Long.class, run, ply, ply / 2 + 1);
        jdbc.update("insert into move_analysis(move_id, cpl, best_uci, p_played, tags) values (?, ?, 'd2d4', ?, ?::text[])",
            id, cpl, p, tags);
    }

    @Test
    void aggregatesCandidatesByTag() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 0, 20, 0.5, "{}");                                   // fine move
        move(run, 2, 300, 0.40, "{hanging_piece,time_trouble}");       // candidate
        move(run, 4, 150, 0.20, "{hanging_piece}");                    // candidate
        move(run, 6, 500, 0.01, "{missed_tactic}");                    // mistake but unlikely human move => not a candidate
        var r = reports.report("alice").orElseThrow();
        assertEquals(4, r.movesAnalyzed());
        assertEquals(3, r.mistakes());
        assertEquals(2, r.candidates());
        var hanging = r.patterns().stream().filter(p -> p.tag().equals("hanging_piece")).findFirst().orElseThrow();
        assertEquals(2, hanging.count());
        assertEquals(225.0, hanging.avgCpl(), 1e-9);
        assertEquals(300, hanging.examples().get(0).cpl());           // worst first
        assertTrue(r.patterns().stream().noneMatch(p -> p.tag().equals("missed_tactic")));
    }

    @Test
    void usesLatestDoneRunOnly() {
        UUID done = UUID.randomUUID();
        seed(done, "DONE");
        move(done, 0, 300, 0.5, "{hanging_piece}");
        UUID running = UUID.randomUUID();
        seed(running, "RUNNING");
        assertEquals(done, reports.report("alice").orElseThrow().runId());
    }

    @Test
    void emptyWhenNothingDone() {
        assertTrue(reports.report("nobody").isEmpty());
    }

    @Test
    void mistakesListReturnsAllMoves() {
        UUID run = UUID.randomUUID();
        seed(run, "DONE");
        move(run, 0, 20, 0.5, "{}");
        move(run, 2, 300, 0.4, "{hanging_piece}");
        var rows = reports.mistakes("alice");
        assertEquals(2, rows.size());
        assertEquals(java.util.List.of("hanging_piece"), rows.get(1).tags());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest=ReportServiceIT` → FAIL (compile error).

- [ ] **Step 3: Implement `ReportService.java`**

```java
package com.blunderprint.report;

import java.sql.Array;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class ReportService {
    public record Example(String gameId, int ply, String fen, String played, String best, int cpl, double pPlayed) {}
    public record PatternSummary(String tag, int count, double avgCpl, List<Example> examples) {}
    public record Report(String username, UUID runId, int movesAnalyzed, int mistakes, int candidates,
                         List<PatternSummary> patterns) {}
    public record MistakeRow(String gameId, long playedAtEpochSec, int ply, int cpl, Double pPlayed, List<String> tags) {}

    private final JdbcTemplate jdbc;
    private final int mistakeCpl;
    private final double minP;

    public ReportService(JdbcTemplate jdbc, @Value("${report.mistake-cpl}") int mistakeCpl,
                         @Value("${report.min-p-played}") double minP) {
        this.jdbc = jdbc;
        this.mistakeCpl = mistakeCpl;
        this.minP = minP;
    }

    private Optional<UUID> latestDoneRun(String username) {
        List<UUID> ids = jdbc.queryForList("""
            select id from analysis_run where lower(username) = lower(?) and status = 'DONE'
            order by created_at desc limit 1""", UUID.class, username);
        return ids.stream().findFirst();
    }

    public Optional<Report> report(String username) {
        Optional<UUID> maybe = latestDoneRun(username);
        if (maybe.isEmpty()) return Optional.empty();
        UUID run = maybe.get();
        var counts = jdbc.queryForMap("""
            select count(*) moves,
                   count(*) filter (where a.cpl >= ?) mistakes,
                   count(*) filter (where a.cpl >= ? and a.p_played >= ?) candidates
            from move m join move_analysis a on a.move_id = m.id where m.run_id = ?
            """, mistakeCpl, mistakeCpl, minP, run);

        Map<String, List<Example>> byTag = new LinkedHashMap<>();
        Map<String, double[]> stats = new HashMap<>();     // tag -> [count, sumCpl]
        jdbc.query("""
            select tag, m.game_id, m.ply, m.before_fen, m.played_uci, a.best_uci, a.cpl, a.p_played
            from move m join move_analysis a on a.move_id = m.id, unnest(a.tags) as tag
            where m.run_id = ? and a.cpl >= ? and a.p_played >= ?
            order by a.cpl desc
            """, rs -> {
                String tag = rs.getString("tag");
                stats.computeIfAbsent(tag, t -> new double[2]);
                stats.get(tag)[0] += 1;
                stats.get(tag)[1] += rs.getInt("cpl");
                List<Example> ex = byTag.computeIfAbsent(tag, t -> new ArrayList<>());
                if (ex.size() < 3) {
                    ex.add(new Example(rs.getString("game_id"), rs.getInt("ply"), rs.getString("before_fen"),
                        rs.getString("played_uci"), rs.getString("best_uci"), rs.getInt("cpl"), rs.getDouble("p_played")));
                }
            }, run, mistakeCpl, minP);

        List<PatternSummary> patterns = new ArrayList<>();
        for (var e : stats.entrySet()) {
            patterns.add(new PatternSummary(e.getKey(), (int) e.getValue()[0], e.getValue()[1] / e.getValue()[0],
                byTag.get(e.getKey())));
        }
        patterns.sort(Comparator.comparingInt(PatternSummary::count).reversed());
        return Optional.of(new Report(username, run, ((Number) counts.get("moves")).intValue(),
            ((Number) counts.get("mistakes")).intValue(), ((Number) counts.get("candidates")).intValue(), patterns));
    }

    public List<MistakeRow> mistakes(String username) {
        return latestDoneRun(username).map(run -> jdbc.query("""
            select m.game_id, extract(epoch from g.played_at)::bigint as t, m.ply, a.cpl, a.p_played, a.tags
            from move m join move_analysis a on a.move_id = m.id join game g on g.id = m.game_id
            where m.run_id = ? order by g.played_at, m.ply
            """, (rs, i) -> {
                Array arr = rs.getArray("tags");
                List<String> tags = arr == null ? List.of() : Arrays.asList((String[]) arr.getArray());
                return new MistakeRow(rs.getString("game_id"), rs.getLong("t"), rs.getInt("ply"), rs.getInt("cpl"),
                    (Double) rs.getObject("p_played"), tags);
            }, run)).orElse(List.of());
    }
}
```

- [ ] **Step 4: Add the endpoints to the controller**

In `AnalysisController.java`, add the import `com.blunderprint.report.ReportService`, add a `ReportService reports` field and constructor parameter, and add:
```java
    @GetMapping("/players/{username}/report")
    public ResponseEntity<ReportService.Report> report(@PathVariable String username) {
        return reports.report(username).map(ResponseEntity::ok).orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/players/{username}/mistakes")
    public java.util.List<ReportService.MistakeRow> mistakes(@PathVariable String username) {
        return reports.mistakes(username);
    }
```
Also update `AnalysisControllerIT` only if it constructs the controller manually (it does not; it uses Spring wiring).

- [ ] **Step 5: Run to verify pass**

Run: `cd backend && mvn -q test` → all backend tests PASS (`ReportServiceIT`: 4 tests).

- [ ] **Step 6: End-to-end manual check with the real model**

```bash
docker compose up -d postgres
cd ml && MODEL_CKPT=checkpoints/mlp.pt uvicorn blunderprint_ml.service:app --port 8000 &
cd backend && STOCKFISH_PATH=/path/to/stockfish mvn spring-boot:run &
curl -s -X POST localhost:8080/analysis -H 'content-type: application/json' -d '{"username":"YOUR_USER","maxGames":10,"depth":12}'
# poll GET /analysis/{runId} until status is DONE, then:
curl -s localhost:8080/players/YOUR_USER/report
```
Expected: JSON with `patterns` sorted by count, each with up to 3 examples. Sanity-check two examples by loading their `fen` in a board viewer.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: report builder and player endpoints"
```

---

# Phase 5: Validation experiment

### Task 18: Does the coach work?

**Files:**
- Create: `scripts/pick_players.py`, `scripts/validate_coach.py`
- Test: `ml/tests/test_validation_math.py` (the pure comparison function lives in `ml/src/blunderprint_ml/validation.py`)
- Output: `results/validation.json`

**Interfaces:**
- Produces: `validation.tag_rates(rows, tags) -> dict[str, float]` where each row is a dict `{ "tags": [...], "cpl": int, "p_played": float|None }` and the rate is "candidate mistakes with that tag per 100 moves" (candidate = cpl ≥ 100 and p_played ≥ 0.15)
- Produces: `validation.compare(fit_rows, holdout_rows, population_rates, tags) -> {"own_mae": float, "population_mae": float}`: MAE across tags of predicting the holdout tag rates from (a) the player's own fit rates versus (b) the population mean rates
- Produces: `scripts/pick_players.py` printing usernames that appear ≥ N times as players in the **test** split of a PGN dump (never seen in training)
- Experiment design (from the spec): per test-split player, sort moves chronologically, first 80% = fit, last 20% = holdout; **success = `own_mae` < `population_mae`, aggregated over players**

- [ ] **Step 1: Write the failing test**

```python
from blunderprint_ml.validation import compare, tag_rates

TAGS = ["hanging_piece", "missed_tactic"]


def rows(n_hanging, n_other, n_total):
    r = [{"tags": ["hanging_piece"], "cpl": 200, "p_played": 0.5} for _ in range(n_hanging)]
    r += [{"tags": ["missed_tactic"], "cpl": 200, "p_played": 0.5} for _ in range(n_other)]
    r += [{"tags": [], "cpl": 10, "p_played": 0.5} for _ in range(n_total - n_hanging - n_other)]
    return r


def test_tag_rates_per_100_moves_and_candidate_filter():
    r = rows(5, 0, 100) + [{"tags": ["hanging_piece"], "cpl": 200, "p_played": 0.01}]   # unlikely move: excluded
    assert tag_rates(r, TAGS)["hanging_piece"] == 5 / 101 * 100
    assert tag_rates(r, TAGS)["missed_tactic"] == 0.0


def test_own_history_beats_population_when_player_is_consistent():
    fit, hold = rows(20, 1, 100), rows(18, 2, 100)
    population = {"hanging_piece": 5.0, "missed_tactic": 5.0}
    res = compare(fit, hold, population, TAGS)
    assert res["own_mae"] < res["population_mae"]


def test_population_wins_when_player_is_inconsistent():
    fit, hold = rows(20, 1, 100), rows(1, 20, 100)
    population = {"hanging_piece": 10.0, "missed_tactic": 10.0}
    res = compare(fit, hold, population, TAGS)
    assert res["own_mae"] > res["population_mae"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ml && pytest tests/test_validation_math.py -q` → FAIL (`ImportError`).

- [ ] **Step 3: Implement `validation.py`**

```python
MISTAKE_CPL = 100
MIN_P = 0.15
TAGS = ["hanging_piece", "missed_tactic", "opening_error", "endgame_technique", "time_trouble", "other"]


def tag_rates(rows: list[dict], tags: list[str]) -> dict[str, float]:
    n = max(len(rows), 1)
    out = {}
    for t in tags:
        c = sum(1 for r in rows if t in r["tags"] and r["cpl"] >= MISTAKE_CPL
                and r["p_played"] is not None and r["p_played"] >= MIN_P)
        out[t] = c / n * 100
    return out


def compare(fit_rows, holdout_rows, population_rates, tags) -> dict:
    own = tag_rates(fit_rows, tags)
    hold = tag_rates(holdout_rows, tags)
    own_mae = sum(abs(own[t] - hold[t]) for t in tags) / len(tags)
    pop_mae = sum(abs(population_rates[t] - hold[t]) for t in tags) / len(tags)
    return {"own_mae": own_mae, "population_mae": pop_mae}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd ml && pytest tests/test_validation_math.py -q` → `3 passed`.

- [ ] **Step 5: Write `scripts/pick_players.py`**

```python
"""Print usernames from the TEST split of a dump with at least --min-games games in the sample.

Usage: python scripts/pick_players.py ml/data/<dump>.pgn.zst --min-games 15 --limit 40 > players.txt
"""
import argparse
import collections
import sys

import chess.pgn

sys.path.insert(0, "ml/src")
from blunderprint_ml.data import _open, split_of  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pgn")
    ap.add_argument("--min-games", type=int, default=15)
    ap.add_argument("--limit", type=int, default=40)
    ap.add_argument("--scan-games", type=int, default=300_000)
    args = ap.parse_args()
    counts = collections.Counter()
    with _open(args.pgn) as fh:
        for _ in range(args.scan_games):
            g = chess.pgn.read_game(fh)
            if g is None:
                break
            for side in ("White", "Black"):
                name = g.headers.get(side, "?")
                if split_of(name) == "test":
                    counts[name] += 1
    for name, c in counts.most_common():
        if c >= args.min_games and args.limit > 0:
            print(name)
            args.limit -= 1


if __name__ == "__main__":
    main()
```
The dump covers all players for one month, so players with many games in a dump usually have enough history on Lichess; the validation script fetches their games fresh through the backend (up to 400) rather than relying on the dump.

- [ ] **Step 6: Write `scripts/validate_coach.py`**

```python
"""Does the coach work? Per test-split player: fit on first 80% of games, predict tag rates in the last 20%.

Usage: python scripts/validate_coach.py players.txt --games 300 --depth 12
"""
import argparse
import json
import statistics
import sys
import time

import requests

sys.path.insert(0, "ml/src")
from blunderprint_ml.validation import TAGS, compare, tag_rates  # noqa: E402

BASE = "http://localhost:8080"


def analyze(user: str, games: int, depth: int) -> list[dict]:
    r = requests.post(f"{BASE}/analysis", json={"username": user, "maxGames": games, "depth": depth}).json()
    run = r["runId"]
    while True:
        p = requests.get(f"{BASE}/analysis/{run}").json()
        if p["status"] == "DONE":
            break
        time.sleep(2)
    return requests.get(f"{BASE}/players/{user}/mistakes").json()


def to_rows(raw):
    return [{"tags": m["tags"], "cpl": m["cpl"], "p_played": m["pPlayed"],
             "game": m["gameId"], "t": m["playedAtEpochSec"], "ply": m["ply"]} for m in raw]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("players")
    ap.add_argument("--games", type=int, default=300)
    ap.add_argument("--depth", type=int, default=12)
    args = ap.parse_args()
    users = [u.strip() for u in open(args.players) if u.strip()]

    per_player = {}
    for u in users:
        rows = sorted(to_rows(analyze(u, args.games, args.depth)), key=lambda r: (r["t"], r["ply"]))
        if len(rows) < 500:
            print(f"skip {u}: only {len(rows)} moves")
            continue
        cut = int(len(rows) * 0.8)
        per_player[u] = (rows[:cut], rows[cut:])
        print(f"{u}: fit={cut} holdout={len(rows) - cut}")

    # Population rates come from the FIT portions only (never from any holdout data).
    all_fit = [r for fit, _ in per_player.values() for r in fit]
    population = tag_rates(all_fit, TAGS)

    results = {u: compare(fit, hold, population, TAGS) for u, (fit, hold) in per_player.items()}
    own = [r["own_mae"] for r in results.values()]
    pop = [r["population_mae"] for r in results.values()]
    wins = sum(1 for o, p in zip(own, pop) if o < p)
    summary = {
        "players": len(results),
        "own_mae_mean": statistics.mean(own),
        "population_mae_mean": statistics.mean(pop),
        "players_where_own_history_wins": wins,
        "population_rates_per_100_moves": population,
        "per_player": results,
    }
    with open("results/validation.json", "w") as f:
        json.dump(summary, f, indent=2)
    print(json.dumps({k: v for k, v in summary.items() if k != "per_player"}, indent=2))


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Run it (requires the full stack running as in Task 17, Step 6)**

```bash
python scripts/pick_players.py ml/data/<dump>.pgn.zst --min-games 15 --limit 30 > players.txt
python scripts/validate_coach.py players.txt --games 300 --depth 12
```
Expected: `results/validation.json`. Interpret honestly: if `own_mae_mean < population_mae_mean` and a majority of players show it, the personalized tags carry real signal, and you can write a bullet with those exact numbers. If not, report that result as-is (and say in the README what you'd change). Do not tune the thresholds after seeing holdout results.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: coach validation experiment and results"
```

---

# Phase 6: Packaging and deploy

### Task 19: Docker Compose full stack and README

**Files:**
- Create: `backend/Dockerfile`, `ml/Dockerfile`, `README.md`
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: `docker compose up --build` starts Postgres, the model service (port 8000), and the backend (port 8080) with Stockfish installed in the backend image. The trained checkpoint is mounted from `ml/checkpoints/mlp.pt`.

- [ ] **Step 1: Backend Dockerfile**

`backend/Dockerfile`:
```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
RUN apt-get update && apt-get install -y --no-install-recommends stockfish && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/target/backend-0.1.0.jar app.jar
ENV STOCKFISH_PATH=/usr/games/stockfish
ENTRYPOINT ["java", "-jar", "app.jar"]
```

- [ ] **Step 2: Model Dockerfile**

`ml/Dockerfile`:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml .
COPY src ./src
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -e .
ENV MODEL_CKPT=/models/mlp.pt
EXPOSE 8000
CMD ["uvicorn", "blunderprint_ml.service:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Full compose file**

Replace `docker-compose.yml` with:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: chess
      POSTGRES_PASSWORD: chess
      POSTGRES_DB: blunderprint
    ports: ["5432:5432"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chess -d blunderprint"]
      interval: 3s
      timeout: 3s
      retries: 20

  model:
    build: ./ml
    volumes:
      - ./ml/checkpoints/mlp.pt:/models/mlp.pt:ro
    ports: ["8000:8000"]

  backend:
    build: ./backend
    depends_on:
      postgres:
        condition: service_healthy
      model:
        condition: service_started
    environment:
      DB_URL: jdbc:postgresql://postgres:5432/blunderprint
      MODEL_URL: http://model:8000
      ENGINE_VERSION: stockfish-apt
      LICHESS_TOKEN: ${LICHESS_TOKEN:-}
    ports: ["8080:8080"]
```

- [ ] **Step 4: Verify the whole stack from cold**

```bash
docker compose down -v && docker compose up --build -d
curl -s localhost:8080/health && curl -s localhost:8000/health
curl -s -X POST localhost:8080/analysis -H 'content-type: application/json' -d '{"username":"YOUR_USER","maxGames":5,"depth":10}'
```
Expected: both health endpoints return `{"ok":true}`; the analysis POST returns a `runId`; polling reaches `DONE`; `/players/YOUR_USER/report` returns JSON.

- [ ] **Step 5: README**

`README.md` must contain, in this order, with every number copied from the files in `results/` (never typed from memory):
1. **Problem** (the one-sentence pitch).
2. **Architecture diagram** (the ASCII diagram from the spec, or an exported image) and one line per component saying what it does and why it is in that language.
3. **Results**: scaling table from `results/loadtest.json` plus the warm-cache hit rate; model top-1 table from `results/model_eval.json` (uniform vs linear vs MLP, overall and per rating bucket); the validation summary from `results/validation.json` stated plainly, including if it did not show a benefit; the profile conclusion from `results/profile_encode.txt`.
4. **How to run**: `docker compose up --build`, the three curl calls above, and how to reproduce each result (`scripts/loadtest.py`, `ml` train/evaluate commands, `scripts/validate_coach.py`).
5. **Design decisions and trade-offs**: Postgres as queue (and its throughput ceiling), fixed-depth analysis, model scores / Stockfish judges, rule-based tags.
6. **Limitations**: FEN keys ignore repetition and the 50-move counter; depth-12 analysis is weaker in sharp positions; tag rules are heuristics; the model is a small MLP on a bounded sample.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: dockerize full stack and write README"
```

### Task 20: AWS deploy (single EC2 instance running Docker Compose)

**Files:**
- Create: `deploy/aws.md` (the exact commands you ran, so the deploy is reproducible)

**Interfaces:**
- Produces: the stack reachable at `http://<EC2_PUBLIC_IP>:8080` from **your IP only**.

- [ ] **Step 1: Choose the instance and note the cost**

A compute-optimized instance with 8 vCPUs (for example `c6i.2xlarge`) lets the scaling curve extend to 8 workers. Check the current hourly price in the EC2 console before launching. Plan to run the load test once on it, then stop or terminate the instance.

- [ ] **Step 2: Launch (console or CLI)**

Create a key pair, a security group allowing SSH (22) and the API (8080) from **your public IP only**, and launch Ubuntu 24.04 with at least 30 GB of disk. Do not open Postgres (5432) or the model port (8000).

- [ ] **Step 3: Install Docker and deploy**

```bash
ssh -i key.pem ubuntu@<EC2_PUBLIC_IP>
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu && newgrp docker
git clone <YOUR_REPO_URL> blunderprint && cd blunderprint
# copy the trained checkpoint (from your laptop): scp -i key.pem ml/checkpoints/mlp.pt ubuntu@<IP>:~/blunderprint/ml/checkpoints/
docker compose up --build -d
curl -s localhost:8080/health
```

- [ ] **Step 4: Verify from your laptop**

```bash
curl -s http://<EC2_PUBLIC_IP>:8080/health
```
Expected: `{"ok":true}`. Then run `python scripts/loadtest.py` against the instance (change `BASE` and the DB host in the script to the instance, or run the script on the instance itself) and save the result as `results/loadtest-aws.json`. Add it to the README as a second scaling table.

- [ ] **Step 5: Tear down**

Stop or terminate the instance when finished, and record the commands and rough cost in `deploy/aws.md`.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "docs: AWS deploy steps and results"
```

### Task 21 (conditional): Rust feature encoder

**Do this only if Task 14's gate said "build the Rust encoder".** If it said skip, record that in the README and stop. The core stack stays Python + Java.

**Files:**
- Create: `rust/chess_encoder/Cargo.toml`, `rust/chess_encoder/pyproject.toml`, `rust/chess_encoder/src/lib.rs`
- Modify: `ml/src/blunderprint_ml/encoding.py` (add `encode_fen`), `ml/src/blunderprint_ml/data.py` (use it)
- Test: `ml/tests/test_rust_parity.py`
- Output: `results/rust_speedup.json`

**Interfaces:**
- Produces: Python module `chess_encoder` with `encode_fen(fen: str) -> bytes` of length 772, byte-identical to `encode_board(chess.Board(fen))`.

- [ ] **Step 1: Write the failing parity test**

```python
import random

import chess
import numpy as np
import pytest

chess_encoder = pytest.importorskip("chess_encoder")

from blunderprint_ml.encoding import encode_board


def _positions(n, seed=0):
    rng = random.Random(seed)
    out = []
    while len(out) < n:
        b = chess.Board()
        for _ in range(rng.randint(0, 80)):
            if b.is_game_over():
                break
            b.push(rng.choice(list(b.legal_moves)))
            out.append(b.fen())
    return out[:n]


def test_rust_encoder_matches_python_bytes():
    for fen in _positions(1000):
        expected = encode_board(chess.Board(fen)).tobytes()
        assert chess_encoder.encode_fen(fen) == expected, fen
```

- [ ] **Step 2: Run to verify it is skipped/failing**

Run: `cd ml && pytest tests/test_rust_parity.py -q` → SKIPPED (module not installed). The test fails only after the module exists but disagrees.

- [ ] **Step 3: Implement the crate**

`rust/chess_encoder/Cargo.toml`:
```toml
[package]
name = "chess_encoder"
version = "0.1.0"
edition = "2021"

[lib]
name = "chess_encoder"
crate-type = ["cdylib"]

[dependencies]
pyo3 = { version = "0.22", features = ["extension-module"] }
shakmaty = "0.27"
```

`rust/chess_encoder/pyproject.toml`:
```toml
[build-system]
requires = ["maturin>=1.5,<2"]
build-backend = "maturin"

[project]
name = "chess_encoder"
version = "0.1.0"
requires-python = ">=3.11"
```

`rust/chess_encoder/src/lib.rs`:
```rust
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;
use shakmaty::{fen::Fen, CastlingMode, CastlingSide, Chess, Color, Position};

/// 772 features, mover-relative: 12 piece planes x 64 squares, then castling rights
/// [mover K, mover Q, opponent K, opponent Q]. Mirrors the Python `encode_board`.
#[pyfunction]
fn encode_fen<'py>(py: Python<'py>, fen: &str) -> PyResult<Bound<'py, PyBytes>> {
    let setup: Fen = fen.parse().map_err(|e| PyValueError::new_err(format!("{e}")))?;
    let pos: Chess = setup
        .into_position(CastlingMode::Standard)
        .map_err(|e| PyValueError::new_err(format!("{e}")))?;
    let mover = pos.turn();
    let flip = mover == Color::Black;
    let mut out = [0u8; 772];
    for (sq, piece) in pos.board().iter() {
        let square = if flip { sq.flip_vertical() } else { sq };
        let is_mover = piece.color == mover;
        let plane = (piece.role as usize - 1) + if is_mover { 0 } else { 6 };
        out[plane * 64 + u32::from(square) as usize] = 1;
    }
    let c = pos.castles();
    out[768] = c.has(mover, CastlingSide::KingSide) as u8;
    out[769] = c.has(mover, CastlingSide::QueenSide) as u8;
    out[770] = c.has(!mover, CastlingSide::KingSide) as u8;
    out[771] = c.has(!mover, CastlingSide::QueenSide) as u8;
    Ok(PyBytes::new_bound(py, &out))
}

#[pymodule]
fn chess_encoder(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(encode_fen, m)?)?;
    Ok(())
}
```
If shakmaty's API differs from 0.27 in the names above (`CastlingSide`, `Castles::has`, `flip_vertical`), fix them per the compiler error; the parity test is the contract.

- [ ] **Step 4: Build and run parity**

```bash
cd ml && pip install maturin && maturin develop --release -m ../rust/chess_encoder/Cargo.toml
pytest tests/test_rust_parity.py -q
```
Expected: `1 passed`. If it fails, the assertion message prints the first mismatching FEN. Compare plane indexing and mirroring first.

- [ ] **Step 5: Use it in the dataset builder and measure**

In `encoding.py` add:
```python
try:
    import chess_encoder as _rust
except ImportError:
    _rust = None


def encode_fen(fen: str) -> np.ndarray:
    if _rust is not None:
        return np.frombuffer(_rust.encode_fen(fen), dtype=np.uint8)
    return encode_board(chess.Board(fen))
```
In `data.py`, replace `X[split][i] = encode_board(board)` with `X[split][i] = encode_fen(board.fen())`, and import `encode_fen` alongside the others. Then time the build before and after on the same dump and caps:
```bash
cd ml && time python -m blunderprint_ml.data <dump> --out /tmp/py      # with chess_encoder uninstalled
time python -m blunderprint_ml.data <dump> --out /tmp/rs               # with chess_encoder installed
```
Save both timings and the speedup ratio to `results/rust_speedup.json` as `{"python_seconds": ..., "rust_seconds": ..., "speedup": ...}`. Re-run `pytest -q` to confirm everything still passes.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: optional Rust feature encoder with parity test and speedup"
```

---

## Self-Review (spec coverage)

| Spec item | Task |
|---|---|
| Java ingestion from Lichess API | 4, 6 |
| Postgres job queue, `SKIP LOCKED`, retry, idempotent enqueue | 5 |
| Worker pool, one Stockfish per worker, fixed depth | 3, 7 |
| Evaluation cache keyed by (FEN, engine, depth, multipv) | 1, 5 |
| API: analyze, progress, report | 9, 17 |
| Python human-move model, rating buckets, baselines | 11, 12, 13 |
| Split by player, not position | 12 |
| Mistake analysis: CPL + model probability | 8, 15, 16 |
| Rule-based explainable tags (incl. time trouble) | 15 |
| Throughput scaling, cache hit rate, latency | 10 (latency: time the Task 17 Step 6 run cold vs warm and record it in the README) |
| Model accuracy vs baseline per rating bucket | 13 |
| "Does the coach work" validation | 18 |
| Conditional Rust encoder with profiling gate | 14, 21 |
| Docker Compose; AWS deploy | 19, 20 |
| README with diagram and honest results | 19 |
| Resume numbers only from reproducible scripts | Global Constraints, 19 |

Known gap to close during execution: the spec's "end-to-end latency for a 100-game report, cold vs warm cache" is not its own script; capture it by timing `POST /analysis` through `status: DONE` twice in Task 17 Step 6 (or add a `--latency` flag to `scripts/loadtest.py`).
