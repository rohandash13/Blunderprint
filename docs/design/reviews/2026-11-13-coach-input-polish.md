# Coach input and conversation finish review

The follow-up keeps the Club Wallchart material and fixes issues found during live use: a legal Qc2 rejected by the voice agent, speech without a visible conversation before the board, unavailable dragging, unclear grid symbols, and the label “Leaks.”

## Result

- Typed and dropped moves are checked in code against the visible position before voice narration. The reported Qc2 position and spoken file-letter homophones have regression coverage; duplicate agent calls reuse the verified result.
- Player pieces can be dragged on the player's turn, with legal destinations and promotion selection. Accepted drops land immediately; the continuation still advances one ply at a time.
- Starting voice opens a modeless conversation on Profile and Choose focus. Hide/Escape and the rail conversation button preserve access; the transcript docks beside the board in Drill.
- Visible coaching copy uses “Weaknesses.” Internal API fields retain compatibility.
- A collapsible guide before the grid explains its axes, difficulty marks, sizes, rings, game colors, yellow selections and score notation.
- Paper-panel arrival/exit, settling ink marks, level highlights and press feedback add motion without competing with chess. Reduced motion removes spatial effects and board animation.

## Verification

Tests were added before the implementation. The frontend suite passes **193 tests**, and the production build passes. The difficulty-report CLI has **2 passing tests** and regenerates the README's current difficulty row from the public API. Impeccable's detector returns `[]` for `frontend/src/ui`. Backend changes in the preceding rollout passed **181 tests**; this follow-up does not change backend code.

Desktop and phone captures use 1440px and 390px viewports. The isolated headless script loads authentic post-rescore production profile/report responses into the local frontend. Voice-token requests are held pending to review the panel's connecting state; these images do not verify a microphone. Dragging is exercised through HTML5 drag/drop events on the actual chessboard elements, followed by a local engine request. The black queen moves from g5 to g4, lands immediately and receives the solved caption; neither viewport has horizontal page overflow.

Native browser automation was stopped because its Windows URL could not be verified. Live microphone behavior therefore still needs user confirmation after refreshing the deployment. The user confirmed the preceding deployment connects voice; the corrected input flow is covered by DOM integration tests and the separate service handshake.

| View | Desktop | Phone |
| --- | --- | --- |
| Profile and grid key | [Desktop](coach-input-polish/profile-controls.png) | [Phone](coach-input-polish/profile-controls-mobile.png) |
| Conversation on Profile | [Desktop](coach-input-polish/conversation-profile.png) | [Phone](coach-input-polish/conversation-profile-mobile.png) |
| Conversation on Choose focus | [Desktop](coach-input-polish/conversation-focus.png) | [Phone](coach-input-polish/conversation-focus-mobile.png) |
| Accepted board drop | [Desktop](coach-input-polish/drag-desktop.png) | [Phone](coach-input-polish/drag-mobile.png) |

Capture provenance and hashes are in [provenance.json](coach-input-polish/provenance.json).

## Rollout carried forward

The CNN and original UI rebuild are merged. Backend memory recovery and batched rescoring are also merged. Both pre-existing players' latest completed runs were rescored through a temporary loopback-only maintenance backend; the public admin routes remain blocked. The results are recorded in `results/production_rescore.json`. A fresh DrNykterstein run completed through the public flow, and sampled stored probabilities match the CNN within floating-point tolerance.

This review records local verification of the follow-up. Its deployment must be checked separately after merge; screenshots are not represented as live screenshots.
