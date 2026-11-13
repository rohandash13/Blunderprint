import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Chess } from "chess.js";
import { fetchProfile, fetchReport } from "../api";
import { BEST, handleFunctionCall, newCoachState, openPosition, PLAYED, type Arrow, type CoachEffects } from "../coach/functions";
import { spokenMove } from "../chess/facts";
import { AnimationQueue } from "../coach/animQueue";
import { LineHistory, type StepDirection } from "../coach/lineHistory";
import { DEFAULT_CONFIG, buildSettings } from "../voice/settings";
import { AgentSocket, type AgentEvent } from "../voice/agentSocket";
import { Mic, Player } from "../voice/audio";
import { cleanUserLine } from "../voice/transcript";
import { LatencyRecorder } from "../latency/recorder";
import type { Profile } from "../profile/types";
import type { Example, Level, Report } from "../types";
import { describeResult } from "./coachText";

export const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export type VoiceStatus = "idle" | "connecting" | "live" | "error";
export type LineRole = "user" | "assistant" | "coach";
export interface TranscriptLine {
  id: number;
  role: LineRole;
  content: string;
}
export interface Caption {
  text: string;
  /** Set when the caption describes a ply of the line. */
  ply: number | null;
}

/** Functions whose success puts a position on the board, so the app moves to the drill step. */
const BOARD_FUNCTIONS = new Set(["start_drill", "show_mistake", "open_position"]);

// Returns null for an illegal move so animations stop instead of throwing mid-line.
function afterMove(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return c.fen();
  } catch {
    return null;
  }
}
const arrowOf = (uci: string, color: string): Arrow => [uci.slice(0, 2), uci.slice(2, 4), color];

export interface CoachOptions {
  /** Called when the coach (voice or a button) puts a drill or example on the board. */
  onBoard?: () => void;
}

export function useCoach(username: string, opts: CoachOptions = {}) {
  const [fen, setFen] = useState(START);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [flash, setFlash] = useState<string[]>([]);
  const [linePos, setLinePos] = useState<{ ply: number; total: number } | null>(null);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [levels, setLevelsState] = useState<Level[]>(["tricky", "deep"]);
  const [report, setReport] = useState<Report | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [busy, setBusy] = useState(false);
  /** Pattern of the example shown with show_mistake, so it can be drilled as is. */
  const [shownTag, setShownTag] = useState<string | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const coach = useRef(newCoachState());
  const socket = useRef<AgentSocket | null>(null);
  const mic = useRef<Mic | null>(null);
  const player = useRef<Player | null>(null);
  const recorder = useRef<LatencyRecorder | null>(null);
  const cancelled = useRef(new Set<string>());
  const queue = useRef(new AnimationQueue());
  const history = useRef(new LineHistory());
  const reportReq = useRef(0);
  const lineId = useRef(0);
  const stepping = useRef(false);
  /** Caption per board frame of the current line, so stepping back shows what was said there. */
  const frameCaptions = useRef(new Map<number, string>());
  const userRef = useRef(username);
  userRef.current = username;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const statusRef = useRef(status);
  statusRef.current = status;

  const addLine = (role: LineRole, content: string) => setLines((l) => [...l, { id: ++lineId.current, role, content }]);
  const syncLinePos = () => setLinePos(history.current.position.total > 0 ? { ...history.current.position } : null);

  const clearBoard = () => {
    queue.current.cancel();
    setFen(START);
    setArrows([]);
    setFlash([]);
    setCaption(null);
    history.current.reset({ fen: START, arrows: [] });
    setLinePos(null);
  };

  const effects: CoachEffects = {
    fetchProfile: async () => coach.current.profile ?? fetchProfile(userRef.current),
    fetchReport: async (lv) => {
      const req = ++reportReq.current;
      const r = await fetchReport(userRef.current, lv);
      if (req === reportReq.current) setReport(r);
      return r;
    },
    // Setting a static position (reset, drill, show) cancels any running animation.
    showPosition: (f, a) => {
      queue.current.cancel();
      setFen(f);
      setArrows(a ?? []);
      setFlash([]);
      history.current.reset({ fen: f, arrows: a ?? [] });
      syncLinePos();
    },
    animateLine: (f, ucis, colors) =>
      queue.current.run(async (ctx) => {
        let cur = f;
        history.current.begin(f);
        setFen(cur);
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
          setFen(cur);
          history.current.push({ fen: cur, arrows: a });
          syncLinePos();
          await ctx.sleep(450);
          if (ctx.cancelled()) return;
        }
      }),
    flashMove: (f, uci) =>
      queue.current.run(async (ctx) => {
        history.current.reset({ fen: f, arrows: [] });
        setFen(f);
        setArrows([arrowOf(uci, PLAYED)]);
        setFlash([uci.slice(0, 2), uci.slice(2, 4)]);
        await ctx.sleep(600);
        if (ctx.cancelled()) return;
        setFlash([]);
        const next = afterMove(f, uci) ?? f;
        setArrows([arrowOf(uci, PLAYED)]);
        setFen(next);
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
      coach.current.lastShown = null;
      setShownTag(null);
      clearBoard();
    },
    step: (dir) => {
      const frame = history.current.step(dir);
      if (!frame) return null;
      queue.current.cancel();
      setFen(frame.fen);
      setArrows(frame.arrows);
      setFlash([]);
      syncLinePos();
      return { fen: frame.fen, ...history.current.position };
    },
  };

  /** Every coach function goes through here, from voice or from a button, so the screen reflects its result. */
  async function run(name: string, args: Record<string, unknown> = {}, viaVoice = false): Promise<unknown> {
    const isNext = name === "next_move";
    if (isNext) stepping.current = true;
    if (!viaVoice) setBusy(true);
    let result: unknown;
    try {
      result = await handleFunctionCall(name, args, coach.current, effects);
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    } finally {
      if (isNext) stepping.current = false;
      if (!viaVoice) setBusy(false);
    }
    const text = describeResult(name, result);
    const failed = !!result && typeof result === "object" && "error" in (result as object);
    if (text && name !== "get_report" && name !== "get_profile" && name !== "set_levels" && name !== "step_line") {
      const ply = isNext && !failed ? Number((result as { ply?: number }).ply ?? 0) || null : null;
      setCaption({ text, ply });
      const at = history.current.position.ply;
      const illegal = (result as { verdict?: string }).verdict === "illegal";
      if (!failed && !illegal) {
        if (isNext || name === "get_hint" || name === "reveal_answer") frameCaptions.current.set(at, text);
        else frameCaptions.current = new Map([[at, text]]);
      }
      // In typed mode the transcript is the coach's voice; with voice on the agent speaks for itself.
      if (!viaVoice && statusRef.current !== "live") addLine("coach", text);
    }
    if (!failed && name === "step_line") {
      const said = frameCaptions.current.get(history.current.position.ply);
      if (said) setCaption({ text: said, ply: history.current.position.ply });
    }
    if (!failed && name === "show_mistake") setShownTag(String(args.tag ?? "") || null);
    if (!failed && BOARD_FUNCTIONS.has(name)) optsRef.current.onBoard?.();
    bump();
    return result;
  }

  function stepUi(dir: StepDirection) {
    const r = effects.step(dir);
    const d = coach.current.drill;
    if (r && d) {
      d.exploreFen = r.fen; // try_move refuses when the opponent is to move there
      d.awaitingReply = false;
    }
    const said = r ? frameCaptions.current.get(r.ply) : undefined;
    if (said) setCaption({ text: said, ply: r!.ply });
    bump();
  }

  /** Forward through what was already shown, then one more ply of the pending line. */
  async function next() {
    if (stepping.current) return;
    const pos = history.current.position;
    if (pos.ply < pos.total) return stepUi("forward");
    if (coach.current.pending) await run("next_move");
  }
  const prev = () => stepUi("back");

  async function onEvent(e: AgentEvent, s: AgentSocket) {
    recorder.current?.record(e);
    switch (e.type) {
      case "ConversationText": {
        const role = String(e.role) === "user" ? "user" : "assistant";
        const content = role === "user" ? cleanUserLine(String(e.content), coach.current.drill?.exploreFen ?? null) : String(e.content);
        if (content) addLine(role, content);
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
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(f.arguments || "{}");
          } catch {
            // run with no arguments; the function reports what is missing
          }
          const result = await run(f.name, args, true);
          if (!cancelled.current.has(f.id)) s.respond(f.id, f.name, JSON.stringify(result));
        }
        break;
      case "Error":
        stopVoice();
        setVoiceError(String(e.description ?? "The voice service reported an error"));
        setStatus("error");
        break;
    }
  }
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  async function startVoice() {
    stopVoice();
    setVoiceError(null);
    setStatus("connecting");
    try {
      const res = await fetch("/voice/token");
      let body: { token?: string; error?: string };
      try {
        body = await res.json();
      } catch {
        throw new Error(`Voice is unavailable right now (server answered ${res.status})`);
      }
      if (!res.ok) throw new Error(body.error ?? `Voice token request failed (${res.status})`);
      player.current = player.current ?? new Player();
      await player.current.resume();
      recorder.current = new LatencyRecorder(DEFAULT_CONFIG.thinkModel);
      const s: AgentSocket = new AgentSocket(buildSettings(DEFAULT_CONFIG, userRef.current), {
        onEvent: (e) => {
          if (socket.current === s) void onEventRef.current(e, s);
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
          setVoiceError((er) => er ?? `Voice disconnected: ${reason}`);
        },
      });
      socket.current = s;
      if (typeof body.token !== "string" || !body.token) throw new Error("The voice token response was empty");
      await s.connect(body.token);
      if (socket.current !== s) return;
      mic.current = new Mic();
      await mic.current.start((pcm) => s.sendAudio(pcm));
      if (socket.current !== s) return;
      setStatus("live");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setVoiceError((er) => er ?? msg);
      setStatus("error");
      stopVoice();
    }
  }

  function stopVoice() {
    const s = socket.current;
    socket.current = null;
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

  /** With voice on, button presses are said to the coach so it stays in charge of the conversation. */
  const say = (text: string) => {
    if (statusRef.current !== "live" || !socket.current) return false;
    socket.current.injectUserMessage(text);
    return true;
  };

  async function playTyped(move: string) {
    const m = move.trim();
    if (!m) return;
    if (say(`I play ${m}`)) return;
    addLine("user", m);
    const d = coach.current.drill;
    // Before the drill is solved a move is an attempt; afterwards it explores from the board.
    await run(d && !d.solved && !d.revealed ? "play_move" : "try_move", { move: m });
  }

  const hint = () => (say("Can I have a hint?") ? undefined : void run("get_hint"));
  const reveal = () => (say("Show me the answer.") ? undefined : void run("reveal_answer"));
  const reset = () => (say("Reset the position.") ? undefined : void run("reset_position"));

  const loadReport = useCallback(async (lv: Level[]) => {
    const req = ++reportReq.current;
    setReportError(null);
    try {
      const r = await fetchReport(userRef.current, lv);
      if (req !== reportReq.current) return;
      coach.current.report = r;
      setReport(r);
    } catch (err) {
      if (req !== reportReq.current) return;
      setReport(null);
      setReportError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  async function changeLevels(next: Level[]) {
    const ordered = (["slip", "tricky", "deep"] as Level[]).filter((x) => next.includes(x));
    if (ordered.length === 0) return; // at least one level stays on
    setLevelsState(ordered);
    coach.current.levels = ordered;
    coach.current.report = null;
    coach.current.drill = null;
    coach.current.pending = null;
    coach.current.lastShown = null; // the board goes back to empty, not a stale header over the start position
    setShownTag(null);
    clearBoard();
    bump();
    await loadReport(ordered);
  }

  function setProfile(p: Profile | null) {
    coach.current.profile = p;
  }

  const startDrill = (tag: string) => run("start_drill", { tag });
  /** "See the mistake": a shown example replaces any drill, so the board header matches what is shown. */
  const showMistake = (tag: string) => {
    coach.current.drill = null;
    return run("show_mistake", { tag, index: 0 });
  };

  /**
   * Show one specific example (played move red, stronger move green) without drilling it. Used for
   * clock mistakes, whose examples come from a separate report request and are never drilled.
   */
  function showExample(tag: string, ex: Example) {
    coach.current.drill = null;
    coach.current.pending = null;
    coach.current.lastShown = ex;
    effects.showPosition(ex.fen, [arrowOf(ex.played, PLAYED), arrowOf(ex.best, BEST)]);
    const text = describeResult("show_mistake", { playedSpoken: spokenMove(ex.fen, ex.played), bestSpoken: spokenMove(ex.fen, ex.best) });
    if (text) {
      setCaption({ text, ply: null });
      frameCaptions.current = new Map([[0, text]]);
      if (statusRef.current !== "live") addLine("coach", text);
    }
    setShownTag(tag);
    optsRef.current.onBoard?.();
    bump();
  }

  /** A grid mark: open that exact position as a drill. */
  function openExample(tag: string, ex: Example) {
    const r = openPosition(tag, ex, coach.current, effects);
    const text = describeResult("open_position", r);
    if (text) {
      setCaption({ text, ply: null });
      frameCaptions.current = new Map([[0, text]]);
      if (statusRef.current !== "live") addLine("coach", text);
    }
    optsRef.current.onBoard?.();
    bump();
  }

  // A new player starts a fresh coach: no voice session, board or transcript carries over.
  useEffect(() => {
    stopVoice();
    const lv = coach.current.levels;
    coach.current = newCoachState();
    coach.current.levels = lv;
    reportReq.current++;
    setReport(null);
    setReportError(null);
    setLines([]);
    setShownTag(null);
    clearBoard();
    bump();
  }, [username]);

  useEffect(
    () => () => {
      queue.current.cancel();
      stopVoice();
    },
    [],
  );

  const c = coach.current;
  const pendingLeft = c.pending ? c.pending.plies.length - c.pending.next : 0;
  return {
    fen,
    arrows,
    flash,
    linePos,
    pendingLeft,
    caption,
    lines,
    status,
    voiceError,
    levels,
    report,
    reportError,
    busy,
    drill: c.drill,
    lastShown: c.lastShown,
    shownTag,
    canExport: !!recorder.current,
    actions: {
      next,
      prev,
      playTyped,
      hint,
      reveal,
      reset,
      startVoice,
      stopVoice,
      exportSession,
      loadReport,
      changeLevels,
      setProfile,
      startDrill,
      showMistake,
      showExample,
      openExample,
    },
  };
}

export type Coach = ReturnType<typeof useCoach>;
