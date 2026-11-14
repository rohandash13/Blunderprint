# Coach navigation and voice orientation review

The user's follow-up asks for Lichess-style move destinations and for questions about mistakes to move the board, rather than merely produce coaching prose. The same update makes each explicit Start voice click introduce the coach briefly in the current context, while preserving the conversation.

## Behavior and verification

- Click an own piece to select it and show every legal destination from chess.js. Empty destinations use dots; captures use rings. Click a legal destination to move, drag as before, or choose a promotion piece. Opponent turns, analysis work and an inactive/expired clock prevent board input. Selection clears when the position, drill or clock state changes.
- Wrong attempts retain their own move and verified engine continuation, even if the player explores another line. `review_attempt` puts the board back at that attempted move and queues its replay. `next_move` shows each ply before the agent may describe it. At the end, `retry_position` returns to the original board with the answer hidden. The UI offers Review my move and Try again; conversational step_line supports a bounded count of plies.
- The app supplies the spoken introduction directly after microphone activation, including on an already-connected session. It updates the agent's context for an active drill. A greeting alone no longer triggers the profile overview. Typed-only reconnects remain silent, and no voice toggle resets chess progress or history.
- UI and core regression tests were written before implementation. The full frontend suite passes 211 tests and its production build passes. No backend or model changes are part of this follow-up.
- Actual Deepgram service checks accepted the prompt update and deterministic introduction, delivered generated speech, handled synthetic spoken input, stayed on the board after a greeting and executed a hint function. A separate “Where did I go wrong?” request called review_attempt, ten next_move steps, then retry_position, returning to the original board without revealing the answer. The hint payload in the introduction transport check is a test fixture; the review check uses a real production engine response and the actual coach functions.
- Local headless desktop/phone captures use authentic production profile, example and engine-response fixtures: game P7iqfh7W, ply 67. The renderer finds nine legal destination marks for the selected rook, completes the reviewed line and returns to an unsolved retry. Both viewport checks report no horizontal page overflow. These captures verify local UI behavior, separately from production service checks and physical microphone recording.

| State | Desktop | Phone |
| --- | --- | --- |
| Selected piece and legal dots | [Desktop](coach-navigation/legal-dots-desktop.png) | [Phone](coach-navigation/legal-dots-mobile.png) |
| Return to attempted move | [Desktop](coach-navigation/review-start-desktop.png) | [Phone](coach-navigation/review-start-mobile.png) |
| Display a verified reply | [Desktop](coach-navigation/review-reply-desktop.png) | [Phone](coach-navigation/review-reply-mobile.png) |
| Retry, answer hidden | [Desktop](coach-navigation/review-retry-desktop.png) | [Phone](coach-navigation/review-retry-mobile.png) |

Capture hashes and provenance are in [provenance.json](coach-navigation/provenance.json). The fresh-account pipeline check and recording script are in [the demo walkthrough](../../demo-walkthrough.md).
