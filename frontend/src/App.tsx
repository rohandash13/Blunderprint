import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow as CbArrow } from "react-chessboard/dist/chessboard/types";
import { handleFunctionCall, newCoachState, PLAYED, type Arrow, type CoachEffects } from "./coach/functions";
import { AnimationQueue } from "./coach/animQueue";
import { patternLabel, sortPatterns } from "./coach/patternLabels";
import { Chess } from "chess.js";
import { DEFAULT_CONFIG, buildSettings } from "./voice/settings";
import { AgentSocket, type AgentEvent } from "./voice/agentSocket";
import { Mic, Player } from "./voice/audio";
import { LatencyRecorder } from "./latency/recorder";
import { LineHistory, type StepDirection } from "./coach/lineHistory";
import { cleanUserLine } from "./voice/transcript";
import type { Level, Report } from "./types";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
type Status = "idle" | "connecting" | "live" | "error";
type Line = { role: string; content: string };

const LEVEL_NAMES: Record<Level, string> = { slip: "Slips", tricky: "Tricky", deep: "Deep", unrated: "Unrated" };

async function fetchReport(username: string, levels: Level[]): Promise<Report | null> {
  const res = await fetch(`/players/${encodeURIComponent(username)}/report?levels=${levels.join(",")}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`report request failed (${res.status})`);
  return (await res.json()) as Report;
}

export default function App() {
  const [username, setUsername] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [fen, setFen] = useState(START);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [flash, setFlash] = useState<string[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [verdict, setVerdict] = useState<string | null>(null);
  const [levels, setLevelsState] = useState<Level[]>(["tricky", "deep"]);
  const [linePos, setLinePos] = useState<{ ply: number; total: number } | null>(null);

  const coach = useRef(newCoachState());
  const socket = useRef<AgentSocket | null>(null);
  const mic = useRef<Mic | null>(null);
  const player = useRef<Player | null>(null);
  const recorder = useRef<LatencyRecorder | null>(null);
  const cancelled = useRef(new Set<string>());
  const queue = useRef(new AnimationQueue());
  const history = useRef(new LineHistory());
  const fenRef = useRef(START);
  const showFen = (f: string) => {
    fenRef.current = f;
    setFen(f);
  };

  // Returns null for an illegal move so animations stop instead of throwing mid-line.
  const afterMove = (f: string, uci: string): string | null => {
    try {
      const c = new Chess(f);
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      return c.fen();
    } catch {
      return null;
    }
  };
  const arrowOf = (uci: string, color: string): Arrow => [uci.slice(0, 2), uci.slice(2, 4), color];

  const reportReq = useRef(0);
  // A level change drops the drill, so clear the board, arrows and line stepper with it.
  const clearBoard = () => {
    queue.current.cancel();
    showFen(START);
    setArrows([]);
    setFlash([]);
    setVerdict(null);
    history.current.reset({ fen: START, arrows: [] });
    setLinePos(null);
  };

  const syncLinePos = () => setLinePos(history.current.position.total > 0 ? history.current.position : null);

  const effects: CoachEffects = {
    fetchReport: async (lv) => {
      const req = ++reportReq.current;
      const r = await fetchReport(username, lv);
      if (req === reportReq.current) setReport(r);
      return r;
    },
    // Setting a static position (reset, drill, show) cancels any running animation.
    showPosition: (f, a) => {
      queue.current.cancel();
      showFen(f);
      setArrows(a ?? []);
      setFlash([]);
      setVerdict(null);
      history.current.reset({ fen: f, arrows: a ?? [] });
      syncLinePos();
    },
    animateLine: (f, ucis, colors) =>
      queue.current.run(async (ctx) => {
        let cur = f;
        history.current.begin(f);
        showFen(cur);
        setFlash([]);
        for (let k = 0; k < ucis.length; k++) {
          const u = ucis[k];
          const color = Array.isArray(colors) ? colors[k] ?? colors[colors.length - 1] : colors;
          const a = [arrowOf(u, color)];
          setArrows(a);
          await ctx.sleep(450);
          if (ctx.cancelled()) return;
          const next = afterMove(cur, u);
          if (!next) return;
          cur = next;
          showFen(cur);
          history.current.push({ fen: cur, arrows: a });
          syncLinePos();
          await ctx.sleep(450);
          if (ctx.cancelled()) return;
        }
      }),
    flashMove: (f, uci) =>
      queue.current.run(async (ctx) => {
        history.current.reset({ fen: f, arrows: [] });
        showFen(f);
        setArrows([arrowOf(uci, PLAYED)]);
        setFlash([uci.slice(0, 2), uci.slice(2, 4)]);
        await ctx.sleep(600);
        if (ctx.cancelled()) return;
        setFlash([]);
        const next = afterMove(f, uci) ?? f;
        setArrows([arrowOf(uci, PLAYED)]);
        showFen(next);
        history.current.push({ fen: next, arrows: [arrowOf(uci, PLAYED)] });
        syncLinePos();
      }),
    // Any failure (backend down, network error, bad body) means "no engine answer".
    analyze: async (f) => {
      try {
        const res = await fetch("/engine/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fen: f }),
        });
        if (!res.ok) return null;
        return (await res.json()) as { bestUci: string; scoreCp: number; pv: string[] };
      } catch {
        return null;
      }
    },
    setLevels: (lv) => {
      setLevelsState(lv);
      clearBoard();
    },
    step: (dir) => {
      const frame = history.current.step(dir);
      if (!frame) return null;
      queue.current.cancel();
      showFen(frame.fen);
      setArrows(frame.arrows);
      setFlash([]);
      syncLinePos();
      return { fen: frame.fen, ...history.current.position };
    },
  };

  function stepUi(dir: StepDirection) {
    const r = effects.step(dir);
    const d = coach.current.drill;
    if (r && d) {
      d.exploreFen = r.fen; // try_move refuses when the opponent is to move there
      d.awaitingReply = false;
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "ArrowLeft") stepUi("back");
      if (e.key === "ArrowRight") stepUi("forward");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function onEvent(e: AgentEvent, s: AgentSocket) {
    if (e.type !== "Audio") console.debug("[agent]", e.type, e);
    recorder.current?.record(e);
    switch (e.type) {
      case "ConversationText": {
        const role = String(e.role);
        const content = role === "user" ? cleanUserLine(String(e.content), coach.current.drill?.exploreFen ?? null) : String(e.content);
        if (content) setLines((l) => [...l, { role, content }]);
        break;
      }
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
          if (!cancelled.current.has(f.id)) s.respond(f.id, f.name, JSON.stringify(result));
        }
        break;
      case "Error":
        stopVoice();
        setError(String(e.description ?? "Deepgram error"));
        setStatus("error");
        break;
    }
  }

  async function startVoice() {
    stopVoice();
    setError(null);
    setStatus("connecting");
    try {
      const res = await fetch("/voice/token");
      let body: { token?: string; error?: string };
      try {
        body = await res.json();
      } catch {
        throw new Error(`Backend unavailable (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(body.error ?? `token request failed (${res.status})`);
      player.current = player.current ?? new Player();
      await player.current.resume();
      recorder.current = new LatencyRecorder(DEFAULT_CONFIG.thinkModel);
      const s: AgentSocket = new AgentSocket(buildSettings(DEFAULT_CONFIG, username), {
        onEvent: (e) => {
          if (socket.current === s) void onEvent(e, s);
        },
        onAudio: (c) => {
          if (socket.current === s) player.current?.play(c);
        },
        onClose: (reason) => {
          if (socket.current !== s) return;
          mic.current?.stop();
          player.current?.stop();
          socket.current = null;
          setStatus((st) => (st === "live" ? "error" : st));
          setError((er) => er ?? `Voice disconnected: ${reason}`);
        },
      });
      socket.current = s;
      if (typeof body.token !== "string" || !body.token) throw new Error("Token response had no token");
      await s.connect(body.token);
      if (socket.current !== s) return;
      mic.current = new Mic();
      await mic.current.start((pcm) => s.sendAudio(pcm));
      if (socket.current !== s) return;
      setStatus("live");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError((er) => er ?? msg);
      setStatus("error");
      stopVoice();
    }
  }

  function stopVoice() {
    const s = socket.current;
    socket.current = null;
    queue.current.cancel();
    setFlash([]);
    setArrows([]);
    mic.current?.stop();
    s?.close();
    player.current?.stop();
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
    setVerdict(r.error ? String(r.error) : r.verdict === "illegal" ? String(r.reason) : `${r.spoken}: ${r.verdict}`);
  }

  async function toggleLevel(l: Level) {
    const next = levels.includes(l) ? levels.filter((x) => x !== l) : [...levels, l];
    if (next.length === 0) return; // at least one level stays on
    const ordered = (["slip", "tricky", "deep"] as Level[]).filter((x) => next.includes(x));
    setLevelsState(ordered);
    coach.current.levels = ordered;
    coach.current.report = null;
    coach.current.drill = null;
    clearBoard();
    if (username) await loadReport(ordered);
  }

  async function loadReport(lv: Level[] = levels) {
    setError(null);
    const req = ++reportReq.current;
    try {
      const drilled = coach.current.drilled;
      coach.current = newCoachState();
      coach.current.levels = lv;
      coach.current.drilled = drilled;
      const r = await fetchReport(username, lv);
      if (req !== reportReq.current) return; // a newer load started
      coach.current.report = r;
      setReport(r);
      if (!r) setError(`No finished analysis for ${username} yet.`);
    } catch (err) {
      if (req !== reportReq.current) return;
      setReport(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const squareStyles: Record<string, CSSProperties> = {};
  for (const sq of flash) squareStyles[sq] = { background: "rgba(220, 60, 60, 0.45)" };

  return (
    <main className="app">
      <header>
        <h1>Blunderprint Coach</h1>
        <div className="row">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Lichess username" aria-label="Lichess username" />
          <button onClick={() => void loadReport()} disabled={!username}>Load report</button>
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
          <Chessboard id="bp" position={fen} boardWidth={440} arePiecesDraggable={false} customSquareStyles={squareStyles} customArrows={arrows as CbArrow[]} />
          <div className="row">
            <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitTyped()} placeholder="Type a move (e.g. Nf3)" aria-label="Type a move" />
            <button onClick={submitTyped}>Play</button>
          </div>
          {linePos && (
            <div className="row stepper">
              <button onClick={() => stepUi("start")} aria-label="Line start">⏮</button>
              <button onClick={() => stepUi("back")} aria-label="Step back">◀</button>
              <span>{linePos.ply} / {linePos.total}</span>
              <button onClick={() => stepUi("forward")} aria-label="Step forward">▶</button>
              <button onClick={() => stepUi("end")} aria-label="Line end">⏭</button>
            </div>
          )}
          {verdict && <p className="verdict">{verdict}</p>}
        </div>

        <div className="side">
          {report && (
            <div className="patterns">
              <h2>{report.username}: {report.mistakes} mistakes in {report.movesAnalyzed} moves</h2>
              <div className="chips" role="group" aria-label="Challenge level">
                {(["slip", "tricky", "deep"] as Level[]).map((l) => (
                  <button key={l} className={levels.includes(l) ? "chip on" : "chip"} aria-pressed={levels.includes(l)} onClick={() => void toggleLevel(l)}>
                    {LEVEL_NAMES[l]} <span>{report.levelCounts?.[l] ?? 0}</span>
                  </button>
                ))}
                {(report.levelCounts?.unrated ?? 0) > 0 && (
                  <span className="chip" aria-label="Unrated mistakes">{LEVEL_NAMES.unrated} <span>{report.levelCounts.unrated}</span></span>
                )}
              </div>
              <table className="report">
                <thead>
                  <tr>
                    <th scope="col">Pattern</th>
                    <th scope="col">Mistakes</th>
                    <th scope="col">Avg loss</th>
                    <th scope="col">Difficulty</th>
                    <th scope="col">Examples</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortPatterns(report.patterns).map((p) => {
                    const label = patternLabel(p.tag);
                    return (
                      <tr key={p.tag} className={p.tag === "other" ? "muted" : undefined}>
                        <th scope="row">
                          {label.name}
                          {label.description && <small>{label.description}</small>}
                        </th>
                        <td>{p.count}</td>
                        <td>{Math.round(p.avgCpl)} cp</td>
                        <td>
                          {p.examples[0]
                            ? `${LEVEL_NAMES[p.examples[0].level] ?? "—"} · ${p.examples[0].kind}`
                            : "—"}
                        </td>
                        <td>{p.examples.length}</td>
                        <td>
                          <button disabled={p.examples.length === 0} title={p.examples.length === 0 ? "No positions at these levels" : undefined} onClick={() => { coach.current.drill = null; void handleFunctionCall("show_mistake", { tag: p.tag, index: 0 }, coach.current, effects); }}>Show</button>{" "}
                          <button disabled={p.examples.length === 0} title={p.examples.length === 0 ? "No positions at these levels" : undefined} onClick={() => void handleFunctionCall("start_drill", { tag: p.tag }, coach.current, effects)}>Drill</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
