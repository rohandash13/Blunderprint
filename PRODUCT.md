# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Club and online chess players, roughly 1200–2600 Lichess rating, who want to stop repeating the same kinds of
mistakes. They arrive with a Lichess username, not a file. A secondary audience is people evaluating the project
(recruiters, a referrer at Deepgram) who open the public link for a few minutes; they see the same product, so the
first minutes must make sense without chess-coach jargon, but the product does not simplify itself for them.

## Product Purpose

Blunderprint reads a player's recent games, finds the mistakes they keep repeating, and coaches them through their
own positions. Success is a player who, after a session, can name their weak patterns and has found the better
move in several of their own past positions themselves, with hints rather than answers.

## Positioning

A personal coach that knows your games. It starts from a profile of how you play (ratings, strengths, recurring
patterns), then talks you through positions taken from your own games by voice, Socratically. The chess judgment
comes from code (Stockfish, rules, a move model trained on how players at your rating move); the LLM only narrates
facts it is given. Difficulty is judged against your rating: an obvious tactic is a slip for a 2400 and a fair
drill for a 1200.

## Operating Context

- Entry: type a Lichess username. Analysis of recent rated games runs on the server (minutes, with a queue);
  already-analyzed players load instantly.
- Session flow: player profile summary (text; spoken when voice is on) → choose a pattern or difficulty → drills
  on a board with hints, line playout, and per-move explanation.
- Voice: Deepgram Voice Agent in the browser (Chrome, microphone, headphones recommended); everything also works
  by typing moves and clicking.
- Desktop first (board + coach side by side); must remain usable on a phone.

## Capabilities and Constraints

- Data per player: Lichess ratings by time control; analyzed games with centipawn loss, win-chance drop,
  engine best line, mistake patterns (hanging piece, missed tactic, positional, endgame technique, opening, time
  trouble, other), difficulty level (slip / tricky / deep) relative to the player's rating, and kind
  (tactical / positional).
- Coach functions: report, show mistake, drill, play move, hint ladder (idea → piece → square), reveal, explain
  line, try a move, reset, change levels, step through a line.
- Lines play coach-paced: one move at a time with an arrow and a one-sentence explanation, then the next.
- Public demo limits: analysis of ~40 recent games per username, one at a time, daily cap; voice tokens
  rate-limited; admin endpoints closed.
- Terminology: "slip / tricky / deep" for difficulty; "patterns" for recurring mistake types; "drill" for
  practicing a position.

## Brand Commitments

- Name: Blunderprint.
- Chess-classic: the board and pieces look traditional (standard piece set, classic board colors). Everything
  around the board is open.
- Voice: a coach, not a dashboard. Conversational, never recites statistics or percentages for difficulty.

## Evidence on Hand

- Live app: https://useblunderprint.vercel.app (Vercel) with backend on Render and data in Neon.
- Real analyzed player: `Knight_ofthelight73` (2400+ blitz); measured results in `results/` and the README.
- No testimonials, users, or press exist; none may be invented.

## Product Principles

1. The player's own games are the material; never generic puzzles.
2. Code decides chess facts; the coach only narrates them.
3. Guide before revealing: questions and hints first, the answer only when asked.
4. Orient before diving in: profile and choices come before drills.
5. Difficulty is relative to the player, and described in words, not numbers.

## Accessibility & Inclusion

Everything voice does must also be possible by keyboard and mouse (typed moves, buttons, arrow-key stepping);
transcript always visible for the hard of hearing.
