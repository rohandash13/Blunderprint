# Club Wallchart

Blunderprint treats a player's games as a tournament wallchart: recurring patterns down the side, recent games across, and every mistake a mark that opens the position. The experience moves from entering a Lichess name through analysis, Profile, Choose focus, and Drill. Chess facts come from code; the coach narrates them and gives hints before answers.

The binding direction lives in `.impeccable/surfaces/frontend-src-app-tsx.md`; product behavior lives in `PRODUCT.md` and the coach UI design spec. This document describes the implementation in `frontend/src/ui/`.

## Palette and structure

| Role | Token / value | Use |
|---|---|---|
| Felt | `--felt: #1f4d3a` | Navigation rail, primary action |
| On felt | `#f1f5f2`, secondary `#b4d9c2` | Rail text and states |
| Paper | `--paper: #fcfdfd` | Panels and controls |
| Ground | `--ground: #e8ecea` | Main surface |
| Grid | Felt at 7.5% opacity | Visible 24px cell armature |
| Ink | `--ink: #1a1a1a` | Text, rules, tricky marks |
| Secondary ink | `--mute: #545e5a` | Descriptions, scope notes |
| Marker red | `--red: #d7263d` | Deep marks and line arrows |
| Highlighter | `--hl: #f2d94e` | Current step, selected levels, worst row |
| Classic board | `#f0d9b5` / `#b58863` | Standard chessboard squares |

Desktop uses a 220px felt rail and 24px content inset: the main content begins at x=244 at a 1440px viewport. Paper edges and large gaps follow the cell grid. Panels use restrained soft shadows, 4px corners and thin inset rules. The grid is structural; it does not force long text onto an oversized line pitch. `useSnapHeight` rounds selected text panels to whole cells after layout.

At 760px and below, the rail becomes a compact two-row sticky header, content has 16px side insets, and panels stack. Grid tracks explicitly reserve the header's natural height. Focus plates fill the phone's content width rather than applying desktop whole-plate rounding.

## Typography and browser surfaces

Archivo is the single workhorse face, with weight and case carrying hierarchy. The Latin normal variable font is self-hosted in `frontend/public/fonts/` with its OFL license and source provenance. Body text is 14px, explanatory text 16px, desktop headings 28px and phone headings 24px. Figures use tabular numerals at the surrounding text size.

Selection uses highlighter yellow, carets use ink, focus outlines follow the palette, link underlines have deliberate offsets, and scrollbars use the sheet's rule colors. Icons are authored SVGs in `Icons.tsx`; pieces remain traditional. Motion uses an exponential ease-out and respects reduced-motion preferences.

## Screens and interactions

- **Landing:** a plain username form, sample-player link, limits explained in context, and a read-only strip of the sample player's real wallchart. The strip disappears cleanly when its data is unavailable. Heading text keeps normal leading while the panel snaps to the cell grid.
- **Analyzing:** the panel shares the main content column. Queue position, engine progress, scoring and recoverable polling failures have explicit copy. A decorative sheet fills as positions are checked; it is hidden from assistive technology and is not a data chart.
- **Profile:** player name and profile/change links form one tight group. Ratings, record and dates orient the player before the written coaching summary. Strengths, weaknesses and the recommendation explain their evidence and sample size. The wallchart is the main way into a specific position.
- **Wallchart:** patterns are rows, recent games are columns, and cost sizes each mark. Hollow ink means slip, solid ink tricky, red deep, and a dashed outline means unrated. Multiple marks are indicated by a ring. The level control re-marks the sheet and picks the most relevant row. Row totals cover all analyzed games; control counts cover the displayed recent games. On phones, a one-cell gutter protects the sticky pattern/total rule, complete game columns scroll, and a range label explains where the player is.
- **Choose focus:** fixed pattern furniture includes name, description, count, last seen, level mix and actions. Kind appears only for mixed-kind patterns. The difficulty control and its count scope align with the plates' right edge on desktop. Time trouble offers a Timed drill at the selected levels and uses the same report source as every other pattern. “See the mistake” remains available.
- **Drill:** board and coach sit side by side on desktop and stack on phones. Typed input, hint, reveal and reset support the same chess functions as voice. A proposed move plays first; Next advances exactly one engine ply with an arrow and deterministic caption. Previous/Next and arrow keys revisit shown frames with their captions. Inputs keep their own arrow-key behavior. The transcript remains visible.

## States and accessibility

Standard buttons, inputs and a multi-select segmented level control carry the interface. At least one difficulty stays enabled. Disabled actions have an honest reason; loading, empty, missing-profile, API and polling failures have recovery paths. Step headings receive focus after navigation, progress is announced politely, and game marks have descriptive accessible names. Color is reinforced with labels, outline/fill, selection state and captions.

Voice requires Chrome, microphone permission and a valid token. The UI supports dragging, typing and buttons throughout. Starting voice on Profile or Choose focus opens a modeless conversation panel immediately; the same transcript docks beside the board in Drill. It can be hidden with its button or Escape and reopened from the rail; on a phone the rail uses a speech-bubble button. Typed questions are supported with voice on or off, including beside the board through the move/question composer. Stopping voice releases the microphone and mutes audio while retaining the agent session; if the connection is lost, recent conversation history and the current drill context are supplied on reconnect, with no repeated greeting.

Typed and dropped moves are validated against the visible board before the voice agent receives their verified result. A drop lands immediately, legal destinations are marked while dragging, and promotion selection is preserved. A duplicate voice tool call for that submitted move reuses its result instead of moving twice. The agent must call a move function before rejecting any spoken move and may not invent a chess explanation for an unmatched phrase.

The wallchart has an initially open, collapsible guide above the games. It explains rows/columns, hollow/filled/red/dashed marks, cost-based size, outer rings, game-header piece colors, yellow selections and score symbols. These visual examples use the same mark styles as the chart.

Motion follows the paper-and-ink material: marks settle onto the chart when revealed, level highlights and controls give short feedback, and the conversation panel unfolds with a bounded clip/filter transition and a faster exit. Reduced-motion preferences remove spatial effects and board animation while retaining brief color/opacity feedback.

## Finish record

The finish review and screenshot provenance are in `docs/design/reviews/2026-11-13-coach-ui-v3.md`. Captures cover 1440px desktop and 390px phone layouts, including a real local profile, focus, and a line paused after one reply. Analysis-progress captures use a deterministic local fetch fixture and are labeled as such. No generated marketing images or invented player evidence are used.

The live-testing follow-up is recorded in `docs/design/reviews/2026-11-13-coach-input-polish.md`, including the conversation panel, board dragging, explanatory grid key and motion. Its screenshots use authentic post-rescore profile/report fixtures and explicitly identify the simulated connecting state.

Time-trouble drills place a labeled decision clock above the board. The position stays covered until Start clock (or a spoken readiness command). A positive recorded clock within the time-trouble window supplies the budget; otherwise the fallback is thirty seconds. The stored reading is post-move, so it is described as a practice budget. Legal move submission stops the timer before animation and engine review. Timeout preserves the answer and offers a fresh timed retry or untimed practice. A small time-left reminder stays beside the mobile composer. Timer changes do not continuously announce to screen readers; expiry is announced once in the transcript.
