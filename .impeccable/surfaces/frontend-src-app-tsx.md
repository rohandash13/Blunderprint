---
version: 1
slug: "frontend-src-app-tsx"
primary_target: "frontend/src/App.tsx"
related_targets: []
---

# Coach app (single-page web app)

Scope: the whole Blunderprint coach app (`frontend/src/App.tsx` and its components). Visitor mode: Operate.
Audience and job: a club/online player types a Lichess username, reads a profile of how they play, chooses a focus,
then drills positions from their own games with a voice or typed coach. Constraints: classic chess board
(cream/brown, standard pieces); voice and keyboard parity; desktop first, usable at 390 px.

## Direction contract

THESIS: Your games read as a tournament wallchart: patterns down the side, recent games across, every mistake a
mark you can walk up to and replay. Refuses the category default of a dark review screen with a board, a move list
and an accuracy number.

OWN-WORLD: Felt-green shell rail (#1F4D3A) carrying the steps; cool-white wallchart paper panels (not cream) on a
faint visible cell grid that every region snaps to; ink #1A1A1A; marker red #D7263D for costly and deep marks;
highlighter yellow #F2D94E for the current row, step and selection; classic board #F0D9B5 / #B58863. One workhorse
UI face; every number in tabular figures at one size, rank by weight and case (Timetable discipline). Standard web
controls only: buttons, segmented control, tabs, inputs.

STORY: Enter a username; see the analysis progress if needed; land on the Profile: ratings, a short written (or
spoken) summary, strengths and weaknesses, and the Blunderprint grid. Choose a pattern or difficulty; drill on the
board with the coach; each line plays one move at a time with an arrow and a sentence.

FIRST VIEWPORT: Left rail 220 px felt green: wordmark, 3-step stepper (Profile · Choose focus · Drill), voice toggle
and Start voice at its foot. Main: player header (name, Lichess, rating chips with recent trend, games analyzed),
the summary paragraph, then the Blunderprint grid panel (pattern name plates with counts as rows, recent games as
columns with a colour dot, marker dots sized by cost and coloured by level, worst row highlighted) under a
Slips | Tricky | Deep segmented control. Right column: strengths, weaknesses, and a "Start with this" card with the
primary action "Drill this pattern".

FORM: Club Wallchart, position 3 of 7 on the ordered list. seed:288c1c7188bb3feb. Raises: Crouwel (visible grid as
armature), Timetable (one tabular type discipline), Variable Font (one control re-marks the whole grid live),
Character Goods (fixed personal furniture per pattern: name plate, one-line note, count, last seen). Signature
interaction: the level control re-marks the grid; clicking a mark opens that position in the drill.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
