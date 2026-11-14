// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../App";
import type { Profile } from "../profile/types";
import type { Report } from "../types";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  respond: vi.fn(),
  callbacks: null as null | { onEvent(e: unknown): void },
  board: null as any,
}));
vi.mock("../voice/agentSocket", () => ({
  AgentSocket: class {
    constructor(_settings: unknown, callbacks: any) {
      mocks.callbacks = callbacks;
    }
    connect = async () => {};
    close = () => {};
    respond = mocks.respond;
    injectUserMessage = mocks.send;
    sendAudio = () => {};
  },
}));
vi.mock("../voice/audio", () => ({
  Mic: class {
    start = async () => {};
    stop = () => {};
  },
  Player: class {
    resume = async () => {};
    play = () => {};
    stop = () => {};
  },
}));
vi.mock("react-chessboard", () => ({
  Chessboard: (props: any) => {
    mocks.board = props;
    return (
      <div aria-label="Chessboard">
        <button onClick={() => props.onPieceDrop("d1", "c2", "wQ")}>
          Drop queen on c2
        </button>
        <output>{props.position}</output>
      </div>
    );
  },
}));
vi.mock("../api", () => ({
  fetchStatus: async () => ({ status: "DONE", runId: "r", queuePosition: 0 }),
  fetchProfile: async () => profile,
  fetchReport: async () => report,
  fetchPosition: async () => null,
}));

const fen =
  "r4rk1/pp1b2pp/2pbpq2/3p1p2/2PPn3/1P1BP3/PB1N1PPP/R2Q1RK1 w - - 0 12";
const levels = { slip: 0, tricky: 0, deep: 1, unrated: 0 };
const profile: Profile = {
  username: "alice",
  ratings: null,
  analyzed: { games: 1, moves: 40, from: null, to: null },
  record: { white: { w: 1, d: 0, l: 0 }, black: { w: 0, d: 0, l: 0 } },
  phases: { opening: 0, middlegame: 2, endgame: 1 },
  phaseMoves: { opening: 20, middlegame: 30, endgame: 20 },
  kinds: { positional: 1, tactical: 0 },
  clock: { underThirtyShare: 0, mistakeRateUnder30: 0, mistakeRateOver30: 0 },
  grid: [
    {
      gameId: "g",
      playedAt: "2026-11-10",
      color: "white",
      result: "w",
      marks: [
        {
          ply: 22,
          pattern: "positional",
          level: "deep",
          kind: "positional",
          winDrop: 0.2,
        },
      ],
    },
  ],
  patterns: [
    {
      tag: "positional",
      count: 1,
      lastSeen: null,
      levels,
      kinds: { positional: 1, tactical: 0 },
    },
  ],
};
const report: Report = {
  username: "alice",
  runId: "r",
  movesAnalyzed: 40,
  mistakes: 1,
  candidates: 1,
  levels: ["tricky", "deep"],
  levelCounts: levels,
  patterns: [
    {
      tag: "positional",
      count: 1,
      avgCpl: 100,
      examples: [
        {
          gameId: "g",
          ply: 22,
          fen,
          played: "c4c5",
          best: "d1e2",
          cpl: 100,
          pPlayed: 0.3,
          pv: [],
          level: "deep",
          kind: "positional",
          severity: "mistake",
          difficultyElo: 2100,
        },
      ],
    },
  ],
};

beforeEach(() => {
  mocks.send.mockReset();
  mocks.respond.mockReset();
  mocks.callbacks = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("/voice/token") ? { token: "test" } : null,
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function load() {
  render(<App />);
  fireEvent.click(
    screen.getByRole("button", { name: "Try Knight_ofthelight73" }),
  );
  await screen.findByRole("heading", { name: "alice" });
}

it("opens a visible voice conversation on Profile and keeps it on Choose focus before a board exists", async () => {
  await load();
  expect(screen.getByRole("heading", { name: "Weaknesses" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Start voice" }));
  await screen.findByRole("region", { name: "Coach conversation" });
  await act(async () =>
    mocks.callbacks?.onEvent({
      type: "ConversationText",
      role: "assistant",
      content: "Let's work on positional decisions.",
    }),
  );
  expect(screen.getByText("Let's work on positional decisions.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Choose focus" }));
  expect(
    screen.getByRole("region", { name: "Coach conversation" }),
  ).toBeTruthy();
  expect(screen.queryByLabelText("Chessboard")).toBeNull();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(
    screen.queryByRole("region", { name: "Coach conversation" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show conversation" }));
  expect(screen.getByText("Let's work on positional decisions.")).toBeTruthy();
});

it("plays a legal typed move directly while voice is active, then gives verified facts to the agent", async () => {
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Drill this pattern" }));
  await screen.findByLabelText("Chessboard");
  fireEvent.click(screen.getByRole("button", { name: "Start voice" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Stop voice" })).toBeTruthy(),
  );
  fireEvent.change(screen.getByLabelText("Your move"), {
    target: { value: "Qc2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Play" }));
  await waitFor(
    () =>
      expect(mocks.send).toHaveBeenCalledWith(
        expect.stringContaining("Verified move result"),
      ),
    { timeout: 3000 },
  );
  expect(mocks.board.position).toContain("PBQN1PPP/R4RK1 b");
  const requests = vi.mocked(fetch).mock.calls.length;
  await act(async () =>
    mocks.callbacks?.onEvent({
      type: "FunctionCallRequest",
      functions: [
        {
          id: "duplicate",
          name: "play_move",
          arguments: JSON.stringify({ move: "Queen see two" }),
          client_side: true,
        },
      ],
    }),
  );
  await waitFor(() =>
    expect(mocks.respond).toHaveBeenCalledWith(
      "duplicate",
      "play_move",
      expect.any(String),
    ),
  );
  expect(JSON.parse(mocks.respond.mock.calls[0][2]).verdict).not.toBe(
    "illegal",
  );
  expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
});

it("allows a legal piece drop and rejects an illegal one through the same board path", async () => {
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Drill this pattern" }));
  await screen.findByLabelText("Chessboard");
  expect(mocks.board.arePiecesDraggable).toBe(true);
  expect(mocks.board.onPieceDrop("d1", "d8", "wQ")).toBe(false);
  await act(async () => {
    expect(mocks.board.onPieceDrop("d1", "c2", "wQ")).toBe(true);
  });
  expect(mocks.board.position).toContain("PBQN1PPP/R4RK1 b");
});

it("puts the explanatory circle key above the game grid", async () => {
  await load();
  const guide = screen.getByRole("region", { name: "How to read your grid" });
  expect(guide.textContent).toContain("Bigger dot");
  expect(guide.textContent).toContain("Outer ring");
  expect(guide.textContent).toContain("Dashed");
  expect(
    guide.compareDocumentPosition(screen.getByRole("table")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("removes chessboard animation when reduced motion is requested", async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  await load();
  fireEvent.click(screen.getByRole("button", { name: "Drill this pattern" }));
  await screen.findByLabelText("Chessboard");
  expect(mocks.board.animationDuration).toBe(0);
});
