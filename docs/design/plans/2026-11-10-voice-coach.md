# Blunderprint Voice Coach Implementation Plan

**Goal:** Let a player talk to their Blunderprint report and drill their recurring mistakes by voice through Deepgram's Voice Agent API, with a script-reproducible latency measurement.

**Architecture:** The Java backend mints 30-second Deepgram tokens (the API key never leaves it) and serves the report. A React + Vite + TypeScript page connects directly to Deepgram's agent WebSocket, streams mic audio, plays agent audio, and executes the agent's four client-side functions against the report. Chess judgement (legality, best move, repeated mistake) is done by chess.js and stored Stockfish data, never by the LLM.

**Tech Stack:** Java 21 / Spring Boot 3.3 (existing), React 18.3, Vite 5, TypeScript 5, Vitest 2, chess.js 1.x, react-chessboard 4.x, Deepgram Voice Agent V1, Python 3.13 (latency analysis).

**Spec:** `docs/design/specs/2026-11-10-voice-coach-design.md`

## Global Constraints

- Deepgram API key: read only by the Java backend from `DEEPGRAM_API_KEY` (repo-root `.env`, git-ignored). It never appears in frontend code, logs, test fixtures, or commits.
- Token endpoint: `GET /voice/token` → `{"token": "<jwt>", "expiresIn": 30}`; grant call `POST https://api.deepgram.com/v1/auth/grant` with header `Authorization: Token <key>` and body `{"ttl_seconds": 30}`; response fields `access_token`, `expires_in`. Missing key or upstream failure → HTTP 503 `{"error": "..."}`.
- Agent WebSocket: `wss://agent.deepgram.com/v1/agent/converse`, browser protocols `["bearer", token]`. Wait for `Welcome` → send `Settings` → wait for `SettingsApplied` → then stream audio.
- Audio: `linear16`, 24000 Hz, mono, in and out (`output.container: "none"`).
- Agent config: listen `{"type":"deepgram","model":"nova-3","keyterms":[...]}`; think provider `open_ai` model `gpt-4o-mini` by default (configurable; no reasoning/"Thinking" models); speak `{"type":"deepgram","version":"v1","model":"aura-2-thalia-en"}`. Never send `language` on the speak provider.
- Function call reply: `{"type":"FunctionCallResponse","id":<id>,"name":<name>,"content":<JSON string>}`. Every `FunctionCallRequest` with `client_side: true` gets a response unless it was cancelled by `FunctionCallCancelled`. A throwing handler replies `{"error": "..."}`.
- KeepAlive: send `{"type":"KeepAlive"}` when no audio has been sent for 7 seconds (Deepgram requires one at least every 8 seconds of silence).
- The LLM never judges chess. Verdicts are exactly `illegal`, `best`, `repeated_mistake`, `other`.
- Report shape (Task V1): `{username, runId, movesAnalyzed, mistakes, candidates, patterns:[{tag, count, avgCpl, examples:[{gameId, ply, fen, played, best, cpl, pPlayed}]}]}`; `played`/`best` are UCI strings.
- Frontend dev server on port 5173 proxies `/voice` and `/players` to the backend on `http://localhost:8080` (no CORS configuration in Java).
- No latency number is claimed unless `blunderprint_ml.voice_latency` reproduces it from saved session files in `results/voice_sessions/`.
- Commits: stage files by explicit path (never `git add -A`; `scripts/hw_ceiling.py` and `results/hw_ceiling_ac.json` stay untracked). Messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Deviation from the spec

- CORS is replaced by a Vite dev proxy (`/voice`, `/players` → `localhost:8080`). Same-origin requests in dev; no Java CORS config to maintain.

## File Structure

```
backend/src/main/java/com/blunderprint/
  report/ReportService.java                 (Task V1, from the main plan's Task 17)
  voice/DeepgramTokenClient.java            (V2) grant-endpoint client
  api/VoiceController.java                  (V2) GET /voice/token
backend/src/main/resources/application.yml  (V2) .env import + deepgram config
backend/src/test/java/com/blunderprint/
  voice/DeepgramTokenClientTest.java        (V2)
  api/VoiceControllerTest.java              (V2)
frontend/                                   (V3+)
  package.json, tsconfig.json, vite.config.ts, index.html
  src/main.tsx, src/App.tsx, src/App.css
  src/types.ts                              report types
  src/chess/moveParse.ts (+ .test.ts)       spoken/typed text -> legal move
  src/chess/verdict.ts (+ .test.ts)         drill answer judgement
  src/coach/functions.ts (+ .test.ts)       agent function defs + handlers
  src/voice/settings.ts (+ .test.ts)        Settings message builder
  src/voice/agentSocket.ts                  WebSocket lifecycle
  src/voice/audio.ts                        mic capture + playback
  src/latency/recorder.ts (+ .test.ts)      LatencyReport capture/export
ml/src/blunderprint_ml/voice_latency.py     (V6) p50/p95 from saved sessions
ml/tests/test_voice_latency.py              (V6)
```

---

### Task V1: Report builder and endpoints

This is Task 17 of `docs/design/plans/2026-11-08-blunderprint.md`, unchanged. Execute that task's steps exactly (its brief is extracted with `task-brief docs/design/plans/2026-11-08-blunderprint.md 17`).

**Interfaces:**
- Produces: `GET /players/{username}/report` (404 if no DONE run) returning the Report shape in Global Constraints; `GET /players/{username}/mistakes`.

- [ ] **Step 1:** Follow Task 17's steps 1–5 (failing `ReportServiceIT`, implement `ReportService`, add the two controller endpoints, run `cd backend && mvn -q test`, commit with message `feat: report builder and endpoints`).

---

### Task V2: Deepgram token endpoint

**Files:**
- Create: `backend/src/main/java/com/blunderprint/voice/DeepgramTokenClient.java`
- Create: `backend/src/main/java/com/blunderprint/api/VoiceController.java`
- Modify: `backend/src/main/resources/application.yml`
- Test: `backend/src/test/java/com/blunderprint/voice/DeepgramTokenClientTest.java`, `backend/src/test/java/com/blunderprint/api/VoiceControllerTest.java`

**Interfaces:**
- Produces: `DeepgramTokenClient.grant(int ttlSeconds) -> Grant(String accessToken, int expiresIn)`; throws `IllegalStateException` if the key is blank; `RestClientException` on upstream errors. `configured() -> boolean`.
- Produces: `GET /voice/token` → 200 `TokenResponse(String token, int expiresIn)` or 503 `{"error": msg}`.

- [ ] **Step 1: Write the failing tests**

`backend/src/test/java/com/blunderprint/voice/DeepgramTokenClientTest.java`:
```java
package com.blunderprint.voice;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

class DeepgramTokenClientTest {
    @Test
    void postsGrantWithTokenHeaderAndParsesResponse() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://dg");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://dg/v1/auth/grant"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("Authorization", "Token test-key"))
            .andExpect(jsonPath("$.ttl_seconds").value(30))
            .andRespond(withSuccess("{\"access_token\":\"jwt-abc\",\"expires_in\":30}", MediaType.APPLICATION_JSON));
        var g = new DeepgramTokenClient(b.build(), "test-key").grant(30);
        assertEquals("jwt-abc", g.accessToken());
        assertEquals(30, g.expiresIn());
        server.verify();
    }

    @Test
    void blankKeyIsReportedBeforeAnyRequest() {
        var client = new DeepgramTokenClient(RestClient.builder().baseUrl("http://dg").build(), " ");
        assertFalse(client.configured());
        assertThrows(IllegalStateException.class, () -> client.grant(30));
    }

    @Test
    void upstreamErrorPropagates() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://dg");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://dg/v1/auth/grant")).andRespond(withUnauthorizedRequest());
        assertThrows(RestClientException.class, () -> new DeepgramTokenClient(b.build(), "bad").grant(30));
    }
}
```

`backend/src/test/java/com/blunderprint/api/VoiceControllerTest.java`:
```java
package com.blunderprint.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.blunderprint.voice.DeepgramTokenClient;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClientException;

class VoiceControllerTest {
    @Test
    void returnsTokenFromGrant() {
        var tokens = mock(DeepgramTokenClient.class);
        when(tokens.grant(30)).thenReturn(new DeepgramTokenClient.Grant("jwt-abc", 30));
        var res = new VoiceController(tokens).token();
        assertEquals(200, res.getStatusCode().value());
        assertEquals(new VoiceController.TokenResponse("jwt-abc", 30), res.getBody());
    }

    @Test
    void missingKeyIs503WithMessage() {
        var tokens = mock(DeepgramTokenClient.class);
        when(tokens.grant(30)).thenThrow(new IllegalStateException("DEEPGRAM_API_KEY is not set"));
        var res = new VoiceController(tokens).token();
        assertEquals(503, res.getStatusCode().value());
        assertEquals(Map.of("error", "DEEPGRAM_API_KEY is not set"), res.getBody());
    }

    @Test
    void upstreamFailureIs503WithoutLeakingDetails() {
        var tokens = mock(DeepgramTokenClient.class);
        when(tokens.grant(30)).thenThrow(new RestClientException("401 Unauthorized: secret detail"));
        var res = new VoiceController(tokens).token();
        assertEquals(503, res.getStatusCode().value());
        assertEquals(Map.of("error", "Deepgram token request failed"), res.getBody());
    }
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && mvn -q test -Dtest=DeepgramTokenClientTest,VoiceControllerTest` → FAIL (compile errors: classes missing).

- [ ] **Step 3: Implement**

`backend/src/main/java/com/blunderprint/voice/DeepgramTokenClient.java`:
```java
package com.blunderprint.voice;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Mints short-lived Deepgram tokens so the browser never sees the API key. */
@Component
public class DeepgramTokenClient {
    public record Grant(@JsonProperty("access_token") String accessToken,
                        @JsonProperty("expires_in") int expiresIn) {}

    private final RestClient client;
    private final String apiKey;

    @Autowired
    public DeepgramTokenClient(@Value("${deepgram.base-url}") String baseUrl,
                               @Value("${deepgram.api-key:}") String apiKey) {
        this(RestClient.builder().baseUrl(baseUrl).requestFactory(timeouts()).build(), apiKey);
    }

    DeepgramTokenClient(RestClient client, String apiKey) {
        this.client = client;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
    }

    private static SimpleClientHttpRequestFactory timeouts() {
        var f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofSeconds(5));
        f.setReadTimeout(Duration.ofSeconds(10));
        return f;
    }

    public boolean configured() {
        return !apiKey.isEmpty();
    }

    public Grant grant(int ttlSeconds) {
        if (!configured()) throw new IllegalStateException("DEEPGRAM_API_KEY is not set");
        return client.post().uri("/v1/auth/grant")
            .header("Authorization", "Token " + apiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("ttl_seconds", ttlSeconds))
            .retrieve()
            .body(Grant.class);
    }
}
```

`backend/src/main/java/com/blunderprint/api/VoiceController.java`:
```java
package com.blunderprint.api;

import com.blunderprint.voice.DeepgramTokenClient;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;

@RestController
public class VoiceController {
    private static final Logger log = LoggerFactory.getLogger(VoiceController.class);
    private static final int TTL_SECONDS = 30;

    public record TokenResponse(String token, int expiresIn) {}

    private final DeepgramTokenClient tokens;

    public VoiceController(DeepgramTokenClient tokens) {
        this.tokens = tokens;
    }

    @GetMapping("/voice/token")
    public ResponseEntity<Object> token() {
        try {
            var g = tokens.grant(TTL_SECONDS);
            return ResponseEntity.ok(new TokenResponse(g.accessToken(), g.expiresIn()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(503).body(Map.of("error", e.getMessage()));
        } catch (RestClientException e) {
            log.warn("deepgram token request failed: {}", e.getClass().getSimpleName());
            return ResponseEntity.status(503).body(Map.of("error", "Deepgram token request failed"));
        }
    }
}
```

`backend/src/main/resources/application.yml` — add under the existing top-level `spring:` key (keep `datasource` and `flyway` as they are):
```yaml
  config:
    import: "optional:file:.env[.properties],optional:file:../.env[.properties]"
```
and append at the end of the file:
```yaml
deepgram:
  api-key: ${DEEPGRAM_API_KEY:}
  base-url: https://api.deepgram.com
```

- [ ] **Step 4: Run to verify pass, then the full suite**

Run: `cd backend && mvn -q test -Dtest=DeepgramTokenClientTest,VoiceControllerTest` → 6 tests pass.
Run: `cd backend && mvn -q test` → BUILD SUCCESS (no regressions; no test contacts Deepgram).

- [ ] **Step 5: Live smoke check (does not go in the test suite)**

Start the backend (`cd backend && mvn spring-boot:run` in the background), then `curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/voice/token` → `200`. Do NOT print the response body (it contains a live token). Stop the backend.

- [ ] **Step 6: Commit**

```bash
git add backend/src/main/java/com/blunderprint/voice/DeepgramTokenClient.java backend/src/main/java/com/blunderprint/api/VoiceController.java backend/src/main/resources/application.yml backend/src/test/java/com/blunderprint/voice/DeepgramTokenClientTest.java backend/src/test/java/com/blunderprint/api/VoiceControllerTest.java
git commit -m "feat: Deepgram token endpoint (key stays server-side)"
```

---

### Task V3: Frontend scaffold, move parsing, verdicts

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/.gitignore`
- Create: `frontend/src/types.ts`, `frontend/src/chess/moveParse.ts`, `frontend/src/chess/verdict.ts`
- Test: `frontend/src/chess/moveParse.test.ts`, `frontend/src/chess/verdict.test.ts`

**Interfaces:**
- Produces: `parseMove(fen: string, input: string): Move | null` (chess.js `Move`), `tokenize(input: string): string[]`
- Produces: `judge(fen, input, bestUci, playedUci): Judgement` with `Judgement = {verdict: Verdict; san?: string; uci?: string; reason?: string}`, `Verdict = "illegal" | "best" | "repeated_mistake" | "other"`, `uciOf(m)`, `sameMove(a, b)`, `sanOf(fen, uci): string`
- Produces: types `Report`, `Pattern`, `Example` in `types.ts`

- [ ] **Step 1: Scaffold the project**

`frontend/package.json`:
```json
{
  "name": "blunderprint-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "chess.js": "^1.0.0",
    "react": "18.3.1",
    "react-chessboard": "^4.7.2",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

`frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`frontend/vite.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/voice": "http://localhost:8080",
      "/players": "http://localhost:8080",
    },
  },
  test: { environment: "node" },
});
```

`frontend/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Blunderprint Coach</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/.gitignore`:
```
node_modules/
dist/
```

`frontend/src/types.ts`:
```ts
export interface Example {
  gameId: string;
  ply: number;
  fen: string;
  played: string; // UCI
  best: string; // UCI
  cpl: number;
  pPlayed: number;
}

export interface Pattern {
  tag: string;
  count: number;
  avgCpl: number;
  examples: Example[];
}

export interface Report {
  username: string;
  runId: string;
  movesAnalyzed: number;
  mistakes: number;
  candidates: number;
  patterns: Pattern[];
}
```

Run: `cd frontend && npm install` → completes; `package-lock.json` is created.

- [ ] **Step 2: Write the failing tests**

`frontend/src/chess/moveParse.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseMove, tokenize } from "./moveParse";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("tokenize", () => {
  it("joins spoken file and rank and maps number words", () => {
    expect(tokenize("Knight to F three.")).toEqual(["knight", "to", "f3"]);
    expect(tokenize("e takes d5")).toEqual(["e", "takes", "d5"]);
  });
});

describe("parseMove", () => {
  it("accepts SAN and UCI directly", () => {
    expect(parseMove(START, "e4")?.san).toBe("e4");
    expect(parseMove(START, "Nf3")?.san).toBe("Nf3");
    expect(parseMove(START, "g1f3")?.san).toBe("Nf3");
  });

  it("parses spoken moves", () => {
    expect(parseMove(START, "knight f3")?.san).toBe("Nf3");
    expect(parseMove(START, "Knight to F3.")?.san).toBe("Nf3");
    expect(parseMove(START, "pawn to e four")?.san).toBe("e4");
  });

  it("parses spoken captures with a from-file", () => {
    const fen = "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2";
    expect(parseMove(fen, "e takes d5")?.san).toBe("exd5");
  });

  it("parses castling", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(parseMove(fen, "castle kingside")?.san).toBe("O-O");
    expect(parseMove(fen, "castles queenside")?.san).toBe("O-O-O");
  });

  it("handles promotion, defaulting to a queen", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(parseMove(fen, "a8")?.promotion).toBe("q");
    expect(parseMove(fen, "a8 promote to knight")?.promotion).toBe("n");
  });

  it("refuses ambiguous, illegal and nonsense input", () => {
    const twoKnights = "k7/8/8/8/8/8/8/1N3N1K w - - 0 1";
    expect(parseMove(twoKnights, "knight d2")).toBeNull();
    expect(parseMove(twoKnights, "b knight d2")?.san).toBe("Nbd2");
    expect(parseMove(START, "knight e5")).toBeNull();
    expect(parseMove(START, "banana")).toBeNull();
    expect(parseMove(START, "")).toBeNull();
  });
});
```

`frontend/src/chess/verdict.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { judge, sameMove, sanOf } from "./verdict";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("judge", () => {
  it("returns each verdict", () => {
    expect(judge(START, "e4", "e2e4", "g1h3").verdict).toBe("best");
    expect(judge(START, "knight h3", "e2e4", "g1h3").verdict).toBe("repeated_mistake");
    expect(judge(START, "d4", "e2e4", "g1h3")).toMatchObject({ verdict: "other", san: "d4", uci: "d2d4" });
    const bad = judge(START, "king e2", "e2e4", "g1h3");
    expect(bad.verdict).toBe("illegal");
    expect(bad.reason).toContain("king e2");
  });

  it("treats a missing promotion letter as a queen", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(judge(fen, "a8", "a7a8", "a1b1").verdict).toBe("best");
    expect(sameMove("a7a8q", "a7a8")).toBe(true);
    expect(sameMove("a7a8n", "a7a8")).toBe(false);
  });
});

describe("sanOf", () => {
  it("converts UCI to SAN in a position", () => {
    expect(sanOf(START, "g1f3")).toBe("Nf3");
    expect(sanOf(START, "e2e5")).toBe("e2e5"); // illegal: falls back to the UCI text
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx vitest run` → FAIL (cannot resolve `./moveParse`, `./verdict`).

- [ ] **Step 4: Implement**

`frontend/src/chess/moveParse.ts`:
```ts
import { Chess, type Move, type PieceSymbol } from "chess.js";

const PIECE_WORDS: Record<string, PieceSymbol> = {
  king: "k", queen: "q", rook: "r", bishop: "b", knight: "n", night: "n", pawn: "p",
};
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
};
const PROMO_WORDS = new Set(["promote", "promotes", "promoting", "promotion", "equals"]);

type MoveInput = string | { from: string; to: string; promotion?: string };

function attempt(fen: string, move: MoveInput): Move | null {
  try {
    return new Chess(fen).move(move);
  } catch {
    return null;
  }
}

/** Lowercase words; "f three" and "f 3" become "f3". */
export function tokenize(input: string): string[] {
  const raw = input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => NUMBER_WORDS[t] ?? t);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const next = raw[i + 1];
    if (/^[a-h]$/.test(t) && next !== undefined && /^[1-8]$/.test(next)) {
      out.push(t + next);
      i++;
    } else {
      out.push(t);
    }
  }
  return out;
}

/** Resolve typed or spoken text to exactly one legal move, or null. */
export function parseMove(fen: string, input: string): Move | null {
  const text = input.trim();
  if (!text) return null;

  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(text);
  if (uci) {
    return attempt(fen, {
      from: uci[1].toLowerCase(),
      to: uci[2].toLowerCase(),
      promotion: (uci[3] ?? "q").toLowerCase(),
    });
  }
  const san = attempt(fen, text);
  if (san) return san;

  const tokens = tokenize(text);
  const legal = new Chess(fen).moves({ verbose: true });

  if (tokens.some((t) => t.startsWith("castl"))) {
    const long = tokens.some((t) => t === "queenside" || t === "long" || t === "queen");
    const target = long ? "O-O-O" : "O-O";
    return legal.find((m) => m.san.replace(/[+#]/g, "") === target) ?? null;
  }

  const squares = tokens.filter((t) => /^[a-h][1-8]$/.test(t));
  if (squares.length === 0) return null;

  const promoAt = tokens.findIndex((t) => PROMO_WORDS.has(t));
  const promotion =
    promoAt >= 0
      ? tokens.slice(promoAt + 1).map((t) => PIECE_WORDS[t]).find((p) => p && p !== "k" && p !== "p") ?? "q"
      : "q";
  const pieceWord = (promoAt >= 0 ? tokens.slice(0, promoAt) : tokens).map((t) => PIECE_WORDS[t]).find(Boolean);
  const fromFile = tokens.find((t) => /^[a-h]$/.test(t));

  let cands =
    squares.length >= 2
      ? legal.filter((m) => m.from === squares[0] && m.to === squares[1])
      : legal.filter((m) => m.to === squares[0]);
  if (pieceWord) {
    cands = cands.filter((m) => m.piece === pieceWord);
  } else if (squares.length < 2) {
    const pawns = cands.filter((m) => m.piece === "p");
    if (pawns.length > 0) cands = pawns;
  }
  if (fromFile) cands = cands.filter((m) => m.from[0] === fromFile);
  if (cands.some((m) => m.promotion)) cands = cands.filter((m) => m.promotion === promotion);

  return cands.length === 1 ? cands[0] : null;
}
```

`frontend/src/chess/verdict.ts`:
```ts
import { Chess } from "chess.js";
import { parseMove } from "./moveParse";

export type Verdict = "illegal" | "best" | "repeated_mistake" | "other";

export interface Judgement {
  verdict: Verdict;
  san?: string;
  uci?: string;
  reason?: string;
}

export function uciOf(m: { from: string; to: string; promotion?: string }): string {
  return m.from + m.to + (m.promotion ?? "");
}

/** Same from/to squares; a missing promotion letter counts as a queen. */
export function sameMove(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.slice(0, 4) === y.slice(0, 4) && (x[4] ?? "q") === (y[4] ?? "q");
}

export function sanOf(fen: string, uci: string): string {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? "q" }).san;
  } catch {
    return uci;
  }
}

export function judge(fen: string, input: string, bestUci: string, playedUci: string): Judgement {
  const move = parseMove(fen, input);
  if (!move) return { verdict: "illegal", reason: `No single legal move matches "${input}"` };
  const uci = uciOf(move);
  const verdict: Verdict = sameMove(uci, bestUci) ? "best" : sameMove(uci, playedUci) ? "repeated_mistake" : "other";
  return { verdict, san: move.san, uci };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd frontend && npx vitest run` → all tests in `moveParse.test.ts` and `verdict.test.ts` pass, no warnings. If a chess.js API detail differs in the installed version (e.g. `move()` returning null instead of throwing), adapt `attempt` to handle both, not the tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/.gitignore frontend/src/types.ts frontend/src/chess/moveParse.ts frontend/src/chess/moveParse.test.ts frontend/src/chess/verdict.ts frontend/src/chess/verdict.test.ts
git commit -m "feat: frontend scaffold, spoken-move parsing and drill verdicts"
```

---

### Task V4: Agent functions and Settings message

**Files:**
- Create: `frontend/src/coach/functions.ts`, `frontend/src/voice/settings.ts`
- Test: `frontend/src/coach/functions.test.ts`, `frontend/src/voice/settings.test.ts`

**Interfaces:**
- Consumes: `judge`, `sanOf`, `uciOf` (V3); `Report`, `Example` (V3)
- Produces: `FUNCTION_DEFS` (array of `{name, description, parameters}`), `CoachState`, `CoachEffects`, `newCoachState(): CoachState`, `handleFunctionCall(name: string, args: Record<string, unknown>, state: CoachState, fx: CoachEffects): Promise<unknown>`
- Produces: `AgentConfig`, `DEFAULT_CONFIG`, `KEYTERMS`, `buildSettings(cfg: AgentConfig, username: string): Record<string, unknown>`

- [ ] **Step 1: Write the failing tests**

`frontend/src/coach/functions.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { FUNCTION_DEFS, handleFunctionCall, newCoachState, type CoachEffects } from "./functions";
import type { Report } from "../types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

const REPORT: Report = {
  username: "alice",
  runId: "r1",
  movesAnalyzed: 400,
  mistakes: 30,
  candidates: 12,
  patterns: [
    {
      tag: "hanging_piece",
      count: 5,
      avgCpl: 412.6,
      examples: [
        { gameId: "g1", ply: 0, fen: START, played: "g1h3", best: "e2e4", cpl: 300, pPlayed: 0.214 },
        { gameId: "g2", ply: 1, fen: AFTER_E4, played: "g8h6", best: "e7e5", cpl: 250, pPlayed: 0.18 },
      ],
    },
  ],
};

function effects(report: Report | null = REPORT): CoachEffects & { shown: string[]; played: string[] } {
  const shown: string[] = [];
  const played: string[] = [];
  return {
    shown,
    played,
    fetchReport: vi.fn(async () => report),
    showPosition: (fen) => shown.push(fen),
    playOnBoard: (uci) => played.push(uci),
  };
}

describe("FUNCTION_DEFS", () => {
  it("declares the four client-side functions with JSON-schema parameters", () => {
    expect(FUNCTION_DEFS.map((f) => f.name)).toEqual(["get_report", "show_mistake", "start_drill", "play_move"]);
    for (const f of FUNCTION_DEFS) {
      expect(f.parameters.type).toBe("object");
      expect("endpoint" in f).toBe(false);
    }
  });
});

describe("handleFunctionCall", () => {
  it("get_report fetches once and summarizes", async () => {
    const s = newCoachState();
    const fx = effects();
    const r = (await handleFunctionCall("get_report", {}, s, fx)) as Record<string, unknown>;
    await handleFunctionCall("get_report", {}, s, fx);
    expect(fx.fetchReport).toHaveBeenCalledTimes(1);
    expect(r).toEqual({
      movesAnalyzed: 400, mistakes: 30, candidates: 12,
      patterns: [{ tag: "hanging_piece", count: 5, avgCpl: 413, examples: 2 }],
    });
  });

  it("get_report reports a missing report instead of inventing one", async () => {
    expect(await handleFunctionCall("get_report", {}, newCoachState(), effects(null))).toEqual({ error: "no report yet" });
  });

  it("show_mistake puts the position on the board and returns SAN facts", async () => {
    const fx = effects();
    const r = await handleFunctionCall("show_mistake", { tag: "hanging_piece", index: 1 }, newCoachState(), fx);
    expect(fx.shown).toEqual([AFTER_E4]);
    expect(r).toEqual({ moveNumber: 1, side: "Black", played: "Nh6", best: "e5", cpl: 250, pPlayed: 0.18 });
  });

  it("show_mistake rejects unknown tags and bad indexes", async () => {
    const s = newCoachState();
    expect(await handleFunctionCall("show_mistake", { tag: "nope", index: 0 }, s, effects()))
      .toEqual({ error: 'no pattern "nope"', available: ["hanging_piece"] });
    expect(await handleFunctionCall("show_mistake", { tag: "hanging_piece", index: 9 }, s, effects()))
      .toEqual({ error: "index out of range", examples: 2 });
  });

  it("start_drill hides the answer and play_move judges with code", async () => {
    const s = newCoachState();
    const fx = effects();
    const ready = await handleFunctionCall("start_drill", { tag: "hanging_piece" }, s, fx);
    expect(ready).toEqual({ status: "Position ready, White to move", moveNumber: 1 });
    expect(JSON.stringify(ready)).not.toContain("e4");

    const v = await handleFunctionCall("play_move", { move: "knight h3" }, s, fx);
    expect(v).toEqual({ verdict: "repeated_mistake", san: "Nh3", bestMove: "e4", yourGameMove: "Nh3" });
    expect(fx.played).toEqual(["g1h3"]);

    const next = await handleFunctionCall("start_drill", { tag: "hanging_piece" }, s, fx);
    expect(next).toEqual({ status: "Position ready, Black to move", moveNumber: 1 });
  });

  it("play_move without a drill and with an illegal move", async () => {
    const s = newCoachState();
    expect(await handleFunctionCall("play_move", { move: "e4" }, s, effects()))
      .toEqual({ error: "no drill in progress; call start_drill first" });
    await handleFunctionCall("start_drill", { tag: "hanging_piece" }, s, effects());
    const v = (await handleFunctionCall("play_move", { move: "king e2" }, s, effects())) as Record<string, unknown>;
    expect(v.verdict).toBe("illegal");
  });

  it("unknown function names are reported", async () => {
    expect(await handleFunctionCall("launch_rockets", {}, newCoachState(), effects())).toEqual({ error: "unknown function launch_rockets" });
  });
});
```

`frontend/src/voice/settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, KEYTERMS, buildSettings } from "./settings";

describe("buildSettings", () => {
  const s = buildSettings(DEFAULT_CONFIG, "alice") as any;

  it("uses linear16 at 24 kHz both ways", () => {
    expect(s.type).toBe("Settings");
    expect(s.audio.input).toEqual({ encoding: "linear16", sample_rate: 24000 });
    expect(s.audio.output).toEqual({ encoding: "linear16", sample_rate: 24000, container: "none" });
  });

  it("configures nova-3 with chess keyterms, the think model, and an Aura voice", () => {
    expect(s.agent.listen.provider).toEqual({ type: "deepgram", model: "nova-3", keyterms: KEYTERMS });
    expect(KEYTERMS).toContain("knight");
    expect(s.agent.think.provider).toEqual({ type: "open_ai", model: "gpt-4o-mini" });
    expect(s.agent.speak.provider).toEqual({ type: "deepgram", version: "v1", model: "aura-2-thalia-en" });
    expect("language" in s.agent.speak.provider).toBe(false);
  });

  it("declares the coach functions and names the player in the prompt", () => {
    expect(s.agent.think.functions.map((f: { name: string }) => f.name)).toEqual(["get_report", "show_mistake", "start_drill", "play_move"]);
    expect(s.agent.think.prompt).toContain("alice");
    expect(s.agent.think.prompt).toContain("play_move");
    expect(typeof s.agent.greeting).toBe("string");
  });

  it("honors a different model", () => {
    const c = buildSettings({ ...DEFAULT_CONFIG, thinkProvider: "anthropic", thinkModel: "claude-haiku-5-5" }, "bob") as any;
    expect(c.agent.think.provider).toEqual({ type: "anthropic", model: "claude-haiku-5-5" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run` → FAIL (cannot resolve `./functions`, `./settings`).

- [ ] **Step 3: Implement**

`frontend/src/coach/functions.ts`:
```ts
import { judge, sanOf } from "../chess/verdict";
import type { Example, Report } from "../types";

export interface FunctionDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export const FUNCTION_DEFS: FunctionDef[] = [
  {
    name: "get_report",
    description: "Get the player's Blunderprint report: their recurring mistake patterns with counts and average centipawn loss. Call this before discussing the player's play.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "show_mistake",
    description: "Show one example position of a mistake pattern on the board and get the facts about it.",
    parameters: {
      type: "object",
      properties: {
        tag: { type: "string", description: "Pattern tag from get_report, e.g. hanging_piece" },
        index: { type: "integer", description: "0-based example index within the pattern" },
      },
      required: ["tag", "index"],
    },
  },
  {
    name: "start_drill",
    description: "Set up a position from one of the player's past mistakes in this pattern, with their move hidden, so they can try again.",
    parameters: {
      type: "object",
      properties: { tag: { type: "string", description: "Pattern tag from get_report" } },
      required: ["tag"],
    },
  },
  {
    name: "play_move",
    description: "Play the move the player said in the current drill. Returns a verdict computed by the engine data: best, repeated_mistake, other, or illegal.",
    parameters: {
      type: "object",
      properties: { move: { type: "string", description: "The move exactly as the player said it, e.g. 'knight f3' or 'Nf3'" } },
      required: ["move"],
    },
  },
];

export interface CoachState {
  report: Report | null;
  drill: { tag: string; example: Example } | null;
  drilled: Set<string>;
}

export interface CoachEffects {
  fetchReport(): Promise<Report | null>;
  showPosition(fen: string, highlight?: { played?: string; best?: string }): void;
  playOnBoard(uci: string): void;
}

export function newCoachState(): CoachState {
  return { report: null, drill: null, drilled: new Set() };
}

const side = (fen: string) => (fen.split(" ")[1] === "w" ? "White" : "Black");
const moveNumber = (fen: string) => Number(fen.split(" ")[5] ?? 1);
const keyOf = (e: Example) => `${e.gameId}:${e.ply}`;

async function ensureReport(state: CoachState, fx: CoachEffects): Promise<Report | null> {
  if (!state.report) state.report = await fx.fetchReport();
  return state.report;
}

export async function handleFunctionCall(
  name: string,
  args: Record<string, unknown>,
  state: CoachState,
  fx: CoachEffects,
): Promise<unknown> {
  if (name === "play_move") {
    if (!state.drill) return { error: "no drill in progress; call start_drill first" };
    const ex = state.drill.example;
    const j = judge(ex.fen, String(args.move ?? ""), ex.best, ex.played);
    if (j.verdict === "illegal") return { verdict: j.verdict, reason: j.reason };
    fx.playOnBoard(j.uci!);
    state.drilled.add(keyOf(ex));
    return { verdict: j.verdict, san: j.san, bestMove: sanOf(ex.fen, ex.best), yourGameMove: sanOf(ex.fen, ex.played) };
  }

  if (name !== "get_report" && name !== "show_mistake" && name !== "start_drill") {
    return { error: `unknown function ${name}` };
  }

  const report = await ensureReport(state, fx);
  if (!report) return { error: "no report yet" };

  if (name === "get_report") {
    return {
      movesAnalyzed: report.movesAnalyzed,
      mistakes: report.mistakes,
      candidates: report.candidates,
      patterns: report.patterns.map((p) => ({ tag: p.tag, count: p.count, avgCpl: Math.round(p.avgCpl), examples: p.examples.length })),
    };
  }

  const tag = String(args.tag ?? "");
  const pattern = report.patterns.find((p) => p.tag === tag);
  if (!pattern) return { error: `no pattern "${tag}"`, available: report.patterns.map((p) => p.tag) };

  if (name === "show_mistake") {
    const index = Number(args.index ?? 0);
    const ex = pattern.examples[index];
    if (!Number.isInteger(index) || !ex) return { error: "index out of range", examples: pattern.examples.length };
    fx.showPosition(ex.fen, { played: ex.played, best: ex.best });
    return {
      moveNumber: moveNumber(ex.fen),
      side: side(ex.fen),
      played: sanOf(ex.fen, ex.played),
      best: sanOf(ex.fen, ex.best),
      cpl: ex.cpl,
      pPlayed: Math.round(ex.pPlayed * 100) / 100,
    };
  }

  // start_drill
  if (pattern.examples.length === 0) return { error: `pattern "${tag}" has no examples` };
  const ex = pattern.examples.find((e) => !state.drilled.has(keyOf(e))) ?? pattern.examples[0];
  state.drill = { tag, example: ex };
  fx.showPosition(ex.fen);
  return { status: `Position ready, ${side(ex.fen)} to move`, moveNumber: moveNumber(ex.fen) };
}
```

`frontend/src/voice/settings.ts`:
```ts
import { FUNCTION_DEFS } from "../coach/functions";

export interface AgentConfig {
  thinkProvider: "open_ai" | "anthropic" | "google";
  thinkModel: string;
  voice: string;
}

export const DEFAULT_CONFIG: AgentConfig = {
  thinkProvider: "open_ai",
  thinkModel: "gpt-4o-mini",
  voice: "aura-2-thalia-en",
};

export const KEYTERMS = [
  "knight", "bishop", "rook", "queen", "king", "pawn",
  "takes", "castle", "castles", "kingside", "queenside", "check", "checkmate", "promote",
  "Blunderprint", "drill",
];

function prompt(username: string): string {
  return [
    `You are Blunderprint, a concise, encouraging chess coach talking out loud with the player "${username}".`,
    "Keep replies short: one to three sentences. Speak naturally; say moves the way a person would (\"knight to f3\").",
    "Before discussing the player's habits, call get_report. Never invent patterns, counts, or positions.",
    "To show an example, call show_mistake. To drill, call start_drill, ask what they would play, and wait.",
    "Whenever the player says a move during a drill, call play_move with their exact words. Base your feedback only on its verdict:",
    "best = they found the engine move; repeated_mistake = the same move they played in the game; other = legal but different; illegal = ask them to repeat it.",
    "Never state a chess evaluation or best move that did not come from a function result.",
  ].join("\n");
}

export function buildSettings(cfg: AgentConfig, username: string): Record<string, unknown> {
  return {
    type: "Settings",
    audio: {
      input: { encoding: "linear16", sample_rate: 24000 },
      output: { encoding: "linear16", sample_rate: 24000, container: "none" },
    },
    agent: {
      listen: { provider: { type: "deepgram", model: "nova-3", keyterms: KEYTERMS } },
      think: {
        provider: { type: cfg.thinkProvider, model: cfg.thinkModel },
        prompt: prompt(username),
        functions: FUNCTION_DEFS,
      },
      speak: { provider: { type: "deepgram", version: "v1", model: cfg.voice } },
      greeting: "Hi, I'm your Blunderprint coach. Ask me about your habits, or say \"drill me\".",
    },
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npx vitest run` → all tests pass (V3's and V4's), no warnings.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/coach/functions.ts frontend/src/coach/functions.test.ts frontend/src/voice/settings.ts frontend/src/voice/settings.test.ts
git commit -m "feat: voice agent functions and Settings message"
```

---

### Task V5: Voice runtime and the coach UI

**Files:**
- Create: `frontend/src/voice/audio.ts`, `frontend/src/voice/agentSocket.ts`, `frontend/src/latency/recorder.ts`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/App.css`
- Test: `frontend/src/latency/recorder.test.ts`

**Interfaces:**
- Consumes: `buildSettings`, `DEFAULT_CONFIG` (V4); `handleFunctionCall`, `newCoachState` (V4); `judge`, `sanOf` (V3)
- Produces: `class AgentSocket` (`connect(token)`, `sendAudio(buf)`, `respond(id, name, content)`, `injectUserMessage(text)`, `close()`); `class Mic` (`start(onChunk)`, `stop()`); `class Player` (`play(buf)`, `stop()`); `class LatencyRecorder` (`record(event)`, `functionCall(name)`, `export(): VoiceSession`); type `VoiceSession = {model: string; startedAt: string; reports: Record<string, number>[]; functionCalls: {name: string; at: number}[]}`

- [ ] **Step 1: Write the failing recorder test**

`frontend/src/latency/recorder.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { LatencyRecorder } from "./recorder";

describe("LatencyRecorder", () => {
  it("keeps only LatencyReport events and parses every *_latency field as seconds", () => {
    const r = new LatencyRecorder("gpt-4o-mini");
    r.record({ type: "ConversationText", role: "user", content: "hi" });
    r.record({ type: "LatencyReport", stt_latency: "0.21", total_latency: "0.93", tts_latency: "0.18", note: "x" });
    r.record({ type: "LatencyReport", total_latency: "not-a-number" });
    r.functionCall("get_report");
    const s = r.export();
    expect(s.model).toBe("gpt-4o-mini");
    expect(s.reports).toEqual([{ stt_latency: 0.21, total_latency: 0.93, tts_latency: 0.18 }, {}]);
    expect(s.functionCalls.map((f) => f.name)).toEqual(["get_report"]);
    expect(typeof s.startedAt).toBe("string");
  });
});
```

Run: `cd frontend && npx vitest run src/latency` → FAIL (module missing).

- [ ] **Step 2: Implement the recorder**

`frontend/src/latency/recorder.ts`:
```ts
export interface VoiceSession {
  model: string;
  startedAt: string;
  reports: Record<string, number>[];
  functionCalls: { name: string; at: number }[];
}

export class LatencyRecorder {
  private session: VoiceSession;

  constructor(model: string) {
    this.session = { model, startedAt: new Date().toISOString(), reports: [], functionCalls: [] };
  }

  record(event: { type: string; [k: string]: unknown }): void {
    if (event.type !== "LatencyReport") return;
    const row: Record<string, number> = {};
    for (const [k, v] of Object.entries(event)) {
      if (!k.endsWith("_latency")) continue;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      if (Number.isFinite(n)) row[k] = n;
    }
    this.session.reports.push(row);
  }

  functionCall(name: string): void {
    this.session.functionCalls.push({ name, at: Date.now() });
  }

  export(): VoiceSession {
    return structuredClone(this.session);
  }
}
```

Run: `cd frontend && npx vitest run` → all pass.

- [ ] **Step 3: Implement audio and the socket**

`frontend/src/voice/audio.ts`:
```ts
const SAMPLE_RATE = 24000;

// Converts mic input to 16-bit PCM in ~100 ms chunks off the main thread.
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(2400); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(2400);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

export class Mic {
  private ctx?: AudioContext;
  private stream?: MediaStream;

  async start(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const source = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(e.data);
    source.connect(node);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.ctx = undefined;
    this.stream = undefined;
  }
}

export class Player {
  private ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  private nextTime = 0;
  private sources: AudioBufferSourceNode[] = [];

  play(chunk: ArrayBuffer): void {
    const usable = chunk.byteLength - (chunk.byteLength % 2);
    if (usable === 0) return;
    const pcm = new Int16Array(chunk, 0, usable / 2);
    const audio = this.ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000;
    const src = this.ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.ctx.destination);
    const at = Math.max(this.ctx.currentTime, this.nextTime);
    src.start(at);
    this.nextTime = at + audio.duration;
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
  }

  /** Barge-in: stop agent speech immediately when the user starts talking. */
  stop(): void {
    this.sources.forEach((s) => s.stop());
    this.sources = [];
    this.nextTime = 0;
  }

  resume(): Promise<void> {
    return this.ctx.resume();
  }
}
```

`frontend/src/voice/agentSocket.ts`:
```ts
export const AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const KEEPALIVE_IDLE_MS = 7000;

export type AgentEvent = { type: string; [k: string]: unknown };

export interface AgentCallbacks {
  onEvent(e: AgentEvent): void;
  onAudio(chunk: ArrayBuffer): void;
  onClose(reason: string): void;
}

export class AgentSocket {
  private ws?: WebSocket;
  private ready = false;
  private lastSend = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private settings: Record<string, unknown>, private cb: AgentCallbacks) {}

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(AGENT_URL, ["bearer", token]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onmessage = (m: MessageEvent) => {
        if (typeof m.data !== "string") {
          this.cb.onAudio(m.data as ArrayBuffer);
          return;
        }
        const e = JSON.parse(m.data) as AgentEvent;
        if (e.type === "Welcome") this.sendJson(this.settings);
        if (e.type === "SettingsApplied") {
          this.ready = true;
          this.timer = setInterval(() => {
            if (Date.now() - this.lastSend > KEEPALIVE_IDLE_MS) this.sendJson({ type: "KeepAlive" });
          }, 1000);
          resolve();
        }
        this.cb.onEvent(e);
      };
      ws.onerror = () => reject(new Error("Could not connect to Deepgram"));
      ws.onclose = (ev: CloseEvent) => {
        this.ready = false;
        if (this.timer) clearInterval(this.timer);
        this.cb.onClose(ev.reason || `connection closed (${ev.code})`);
        reject(new Error(ev.reason || `connection closed (${ev.code})`));
      };
    });
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcm);
    this.lastSend = Date.now();
  }

  respond(id: string, name: string, content: string): void {
    this.sendJson({ type: "FunctionCallResponse", id, name, content });
  }

  injectUserMessage(content: string): void {
    this.sendJson({ type: "InjectUserMessage", content });
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.ws?.close();
  }

  private sendJson(o: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(o));
    this.lastSend = Date.now();
  }
}
```

- [ ] **Step 4: Implement the UI**

`frontend/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./App.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`frontend/src/App.tsx`:
```tsx
import { useRef, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { handleFunctionCall, newCoachState, type CoachEffects } from "./coach/functions";
import { sanOf } from "./chess/verdict";
import { DEFAULT_CONFIG, buildSettings } from "./voice/settings";
import { AgentSocket, type AgentEvent } from "./voice/agentSocket";
import { Mic, Player } from "./voice/audio";
import { LatencyRecorder } from "./latency/recorder";
import type { Report } from "./types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
type Status = "idle" | "connecting" | "live" | "error";
type Line = { role: string; content: string };

async function fetchReport(username: string): Promise<Report | null> {
  const res = await fetch(`/players/${encodeURIComponent(username)}/report`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`report request failed (${res.status})`);
  return (await res.json()) as Report;
}

export default function App() {
  const [username, setUsername] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [fen, setFen] = useState(START);
  const [highlight, setHighlight] = useState<{ played?: string; best?: string }>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<string | null>(null);

  const coach = useRef(newCoachState());
  const socket = useRef<AgentSocket | null>(null);
  const mic = useRef<Mic | null>(null);
  const player = useRef<Player | null>(null);
  const recorder = useRef<LatencyRecorder | null>(null);
  const cancelled = useRef(new Set<string>());

  const effects: CoachEffects = {
    fetchReport: async () => {
      const r = await fetchReport(username);
      setReport(r);
      return r;
    },
    showPosition: (f, h) => {
      setFen(f);
      setHighlight(h ?? {});
      setVerdict(null);
    },
    playOnBoard: (uci) => {
      const d = coach.current.drill;
      if (!d) return;
      setHighlight({ played: uci });
      setVerdict(`You played ${sanOf(d.example.fen, uci)}`);
    },
  };

  async function onEvent(e: AgentEvent) {
    recorder.current?.record(e);
    switch (e.type) {
      case "ConversationText":
        setLines((l) => [...l, { role: String(e.role), content: String(e.content) }]);
        break;
      case "UserStartedSpeaking":
        player.current?.stop();
        break;
      case "FunctionCallCancelled":
        for (const f of (e.functions as { id: string }[]) ?? []) cancelled.current.add(f.id);
        break;
      case "FunctionCallRequest":
        for (const f of (e.functions as { id: string; name: string; arguments: string; client_side: boolean }[]) ?? []) {
          if (!f.client_side) continue;
          recorder.current?.functionCall(f.name);
          let result: unknown;
          try {
            result = await handleFunctionCall(f.name, JSON.parse(f.arguments || "{}"), coach.current, effects);
          } catch (err) {
            result = { error: err instanceof Error ? err.message : String(err) };
          }
          if (!cancelled.current.has(f.id)) socket.current?.respond(f.id, f.name, JSON.stringify(result));
        }
        break;
      case "Error":
        setError(String(e.description ?? "Deepgram error"));
        setStatus("error");
        break;
    }
  }

  async function startVoice() {
    setError(null);
    setStatus("connecting");
    try {
      const res = await fetch("/voice/token");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `token request failed (${res.status})`);
      player.current = player.current ?? new Player();
      await player.current.resume();
      recorder.current = new LatencyRecorder(DEFAULT_CONFIG.thinkModel);
      const s = new AgentSocket(buildSettings(DEFAULT_CONFIG, username), {
        onEvent: (e) => void onEvent(e),
        onAudio: (c) => player.current?.play(c),
        onClose: (reason) => {
          mic.current?.stop();
          setStatus((st) => (st === "live" ? "error" : st));
          setError((er) => er ?? `Voice disconnected: ${reason}`);
        },
      });
      socket.current = s;
      await s.connect(body.token);
      mic.current = new Mic();
      await mic.current.start((pcm) => s.sendAudio(pcm));
      setStatus("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
      stopVoice();
    }
  }

  function stopVoice() {
    mic.current?.stop();
    socket.current?.close();
    player.current?.stop();
    socket.current = null;
    setStatus((st) => (st === "error" ? st : "idle"));
  }

  function exportSession() {
    const data = recorder.current?.export();
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `voice-session-${data.model}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submitTyped() {
    const move = typed.trim();
    if (!move) return;
    setTyped("");
    if (status === "live") {
      socket.current?.injectUserMessage(`I play ${move}`);
      return;
    }
    const r = (await handleFunctionCall("play_move", { move }, coach.current, effects)) as Record<string, unknown>;
    setVerdict(r.error ? String(r.error) : r.verdict === "illegal" ? String(r.reason) : `${r.san}: ${r.verdict} (best was ${r.bestMove})`);
  }

  async function loadReport() {
    setError(null);
    try {
      coach.current = newCoachState();
      const r = await fetchReport(username);
      coach.current.report = r;
      setReport(r);
      if (!r) setError(`No finished analysis for ${username} yet.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (highlight.played) {
    squareStyles[highlight.played.slice(0, 2)] = { background: "rgba(220, 60, 60, 0.45)" };
    squareStyles[highlight.played.slice(2, 4)] = { background: "rgba(220, 60, 60, 0.45)" };
  }
  if (highlight.best) {
    squareStyles[highlight.best.slice(0, 2)] = { background: "rgba(60, 170, 90, 0.45)" };
    squareStyles[highlight.best.slice(2, 4)] = { background: "rgba(60, 170, 90, 0.45)" };
  }

  return (
    <main className="app">
      <header>
        <h1>Blunderprint Coach</h1>
        <div className="row">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Lichess username" aria-label="Lichess username" />
          <button onClick={loadReport} disabled={!username}>Load report</button>
          {status === "live" ? (
            <button onClick={stopVoice} className="live">Stop voice</button>
          ) : (
            <button onClick={startVoice} disabled={!username || status === "connecting"}>
              {status === "connecting" ? "Connecting…" : status === "error" ? "Reconnect voice" : "Start voice"}
            </button>
          )}
          <button onClick={exportSession} disabled={!recorder.current}>Export latency</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </header>

      <section className="layout">
        <div className="board">
          <Chessboard id="bp" position={fen} boardWidth={440} arePiecesDraggable={false} customSquareStyles={squareStyles} />
          <div className="row">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTyped()} placeholder="Type a move (e.g. Nf3)" aria-label="Type a move" />
            <button onClick={submitTyped}>Play</button>
          </div>
          {verdict && <p className="verdict">{verdict}</p>}
        </div>

        <div className="side">
          {report && (
            <div className="patterns">
              <h2>{report.username}: {report.mistakes} mistakes in {report.movesAnalyzed} moves</h2>
              {report.patterns.map((p) => (
                <div key={p.tag} className="pattern">
                  <strong>{p.tag.replace(/_/g, " ")}</strong> × {p.count} (avg {Math.round(p.avgCpl)} cp)
                  <button onClick={() => handleFunctionCall("show_mistake", { tag: p.tag, index: 0 }, coach.current, effects)}>Show</button>
                  <button onClick={() => handleFunctionCall("start_drill", { tag: p.tag }, coach.current, effects)}>Drill</button>
                </div>
              ))}
            </div>
          )}
          <div className="transcript" aria-live="polite">
            {lines.map((l, i) => (
              <p key={i} className={l.role}><b>{l.role === "user" ? "You" : "Coach"}:</b> {l.content}</p>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
```

`frontend/src/App.css`:
```css
:root { font-family: system-ui, sans-serif; color: #1d1d1f; background: #fafaf8; }
body { margin: 0; }
.app { max-width: 1040px; margin: 0 auto; padding: 16px; }
h1 { margin: 0 0 8px; font-size: 1.5rem; }
h2 { font-size: 1rem; margin: 0 0 8px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
input { padding: 6px 8px; border: 1px solid #ccc; border-radius: 6px; }
button { padding: 6px 12px; border: 1px solid #888; border-radius: 6px; background: #fff; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
button.live { background: #c0392b; color: #fff; border-color: #c0392b; }
.error { color: #b00020; }
.layout { display: grid; grid-template-columns: 460px 1fr; gap: 24px; }
.verdict { font-weight: 600; }
.pattern { display: flex; gap: 8px; align-items: center; margin: 4px 0; }
.transcript { max-height: 420px; overflow-y: auto; border-top: 1px solid #ddd; margin-top: 12px; padding-top: 8px; }
.transcript .user { color: #333; }
.transcript .assistant { color: #0b5394; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
```

- [ ] **Step 5: Type-check, test, build**

Run: `cd frontend && npx vitest run` → all pass.
Run: `cd frontend && npm run build` → `tsc --noEmit` clean, Vite build succeeds. If `react-chessboard`'s installed 4.x prop names differ from `position`, `boardWidth`, `arePiecesDraggable`, `customSquareStyles`, read its bundled `.d.ts` and use the equivalent props; do not upgrade to a different major version.

- [ ] **Step 6: Manual end-to-end check (with the user)**

1. Backend running on 8080 with `.env` containing the key; Postgres up; a username with a DONE analysis.
2. `cd frontend && npm run dev`, open http://localhost:5173.
3. Load report → patterns list shows. Show/Drill buttons move the board. Typed move in a drill shows a verdict.
4. Start voice → greeting is heard. Ask "what's my worst habit?" → agent calls `get_report` and answers from it. "Show me one" → board changes. "Drill me on <tag>" → board changes, agent asks for a move; say a move → verdict-based reply, move highlighted.
5. Talk over the agent → it stops speaking (barge-in). Stop voice, Start again → works. Export latency downloads a JSON file.
Record anything that failed in the task report; fix before committing.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/voice/audio.ts frontend/src/voice/agentSocket.ts frontend/src/latency/recorder.ts frontend/src/latency/recorder.test.ts frontend/src/main.tsx frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: voice coach UI with Deepgram agent socket, mic capture and playback"
```

---

### Task V6: Latency analysis and model bake-off

**Files:**
- Create: `ml/src/blunderprint_ml/voice_latency.py`
- Test: `ml/tests/test_voice_latency.py`
- Output: `results/voice_sessions/*.json` (exported sessions), `results/voice_latency.json`

**Interfaces:**
- Consumes: session JSON files exported by `LatencyRecorder.export()` (V5): `{model, startedAt, reports: [{<name>_latency: seconds}], functionCalls: [{name, at}]}`
- Produces: `summarize(sessions: list[dict]) -> dict` → `{model: {"turns": n, "function_calls": n, "<metric>": {"p50": s, "p95": s, "n": k}}}`; CLI `python -m blunderprint_ml.voice_latency <dir> --out <file>`

- [ ] **Step 1: Write the failing test**

`ml/tests/test_voice_latency.py`:
```python
import json

from blunderprint_ml.voice_latency import summarize, main


def _session(model, totals):
    return {"model": model, "startedAt": "2026-11-10T00:00:00Z",
            "reports": [{"total_latency": t, "tts_latency": t / 4} for t in totals],
            "functionCalls": [{"name": "get_report", "at": 0}]}


def test_summarize_groups_by_model_and_computes_percentiles():
    out = summarize([_session("a", [1.0, 2.0, 3.0, 4.0]), _session("a", [5.0]), _session("b", [0.5])])
    assert out["a"]["turns"] == 5
    assert out["a"]["function_calls"] == 2
    assert out["a"]["total_latency"] == {"p50": 3.0, "p95": 4.8, "n": 5}
    assert out["b"]["total_latency"]["n"] == 1


def test_missing_metrics_are_skipped_not_zeroed():
    s = {"model": "a", "startedAt": "", "reports": [{}, {"stt_latency": 0.2}], "functionCalls": []}
    out = summarize([s])
    assert out["a"]["turns"] == 2
    assert out["a"]["stt_latency"] == {"p50": 0.2, "p95": 0.2, "n": 1}
    assert "total_latency" not in out["a"]


def test_cli_reads_a_directory_and_writes_json(tmp_path):
    d = tmp_path / "sessions"
    d.mkdir()
    (d / "s1.json").write_text(json.dumps(_session("a", [1.0, 3.0])))
    out = tmp_path / "voice_latency.json"
    main([str(d), "--out", str(out)])
    data = json.loads(out.read_text())
    assert data["models"]["a"]["total_latency"]["p50"] == 2.0
    assert data["sessions"] == ["s1.json"]
```

Run: `cd ml && .venv\Scripts\python.exe -m pytest tests/test_voice_latency.py -q` → FAIL (ImportError).

- [ ] **Step 2: Implement**

`ml/src/blunderprint_ml/voice_latency.py`:
```python
"""Summarize exported voice-agent sessions into per-model latency percentiles.

Usage: python -m blunderprint_ml.voice_latency results/voice_sessions --out results/voice_latency.json
"""
import argparse
import json
import os
from collections import defaultdict

import numpy as np


def _pct(values: list[float]) -> dict:
    a = np.asarray(values, dtype=float)
    return {"p50": round(float(np.percentile(a, 50)), 4), "p95": round(float(np.percentile(a, 95)), 4), "n": int(a.size)}


def summarize(sessions: list[dict]) -> dict:
    metrics: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    turns: dict[str, int] = defaultdict(int)
    calls: dict[str, int] = defaultdict(int)
    for s in sessions:
        model = s["model"]
        turns[model] += len(s.get("reports", []))
        calls[model] += len(s.get("functionCalls", []))
        for row in s.get("reports", []):
            for k, v in row.items():
                if k.endswith("_latency"):
                    metrics[model][k].append(float(v))
    out = {}
    for model in turns:
        out[model] = {"turns": turns[model], "function_calls": calls[model]}
        for k, vals in sorted(metrics[model].items()):
            out[model][k] = _pct(vals)
    return out


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser()
    ap.add_argument("sessions_dir")
    ap.add_argument("--out", default="results/voice_latency.json")
    args = ap.parse_args(argv)
    names = sorted(n for n in os.listdir(args.sessions_dir) if n.endswith(".json"))
    sessions = []
    for n in names:
        with open(os.path.join(args.sessions_dir, n)) as f:
            sessions.append(json.load(f))
    result = {"sessions": names, "models": summarize(sessions)}
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps(result["models"], indent=2))
    return result


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Run to verify pass**

Run: `cd ml && .venv\Scripts\python.exe -m pytest -q` → all pass (existing suite plus 3 new tests). Note: numpy's default linear percentile gives p95 = 4.8 for [1,2,3,4,5].

- [ ] **Step 4: Commit the analysis code**

```bash
git add ml/src/blunderprint_ml/voice_latency.py ml/tests/test_voice_latency.py
git commit -m "feat: voice latency summary from exported agent sessions"
```

- [ ] **Step 5: Bake-off (manual, with the user)**

For each model in `gpt-4o-mini` (provider `open_ai`), `gpt-5.4-mini` (`open_ai`), `claude-haiku-5-5` (`anthropic`): set `DEFAULT_CONFIG` accordingly, run one voice session asking the same 10 prompts below, export, and save the file to `results/voice_sessions/`.

1. "What's my worst habit?" 2. "How many mistakes did I make?" 3. "Show me an example." 4. "Show me another one." 5. "Drill me on that." 6. (say the engine's best move or any legal move) 7. "Drill me again." 8. (say an illegal move, e.g. "king to e5") 9. (say a legal move) 10. "Thanks, bye."

Then run: `cd ml && .venv\Scripts\python.exe -m blunderprint_ml.voice_latency ../results/voice_sessions --out ../results/voice_latency.json`. Set `DEFAULT_CONFIG` to the model with the lowest p50 `total_latency` among those that called the expected functions on prompts 1, 3, 5, 6, 8 and 9. Commit `results/voice_sessions/*.json`, `results/voice_latency.json`, and the `settings.ts` default change in one commit: `results: voice agent latency bake-off`.
