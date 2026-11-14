# Timed decisions and continuous chat: finish review

Time trouble now opens a playable decision drill, at the selected difficulty, rather than being rejected as a clock-only pattern. Report and individual-position responses include the existing nullable recorded move-clock reading. The UI uses positive readings within the time-trouble window as a practice budget and otherwise falls back to thirty seconds. The reading was recorded after the original move; it is not represented as reconstructed pre-move thinking time.

The position stays covered until Start clock or the spoken readiness function. Dragging, typing and spoken legal transcripts share the board-validation path. The clock stops on submission before animation and engine review. Illegal moves keep the deadline running. Timeout leaves the answer hidden, with retry and untimed choices. Reset clears the timed attempt; ordinary drills retain their existing behavior. The phone composer repeats the remaining time without repeatedly announcing it to assistive technology.

Stopping voice releases microphone capture and mutes playback while keeping the agent conversation available for typing. Typed chat can connect without any microphone request. If the socket disconnects, recent transcript history and the current drill context resume through Deepgram's documented [conversation history](https://developers.deepgram.com/docs/voice-agent-history), with the greeting omitted. Changing players and unmounting close the session. The board composer can switch between a move and a coach question; inputs stay editable during move checking.

## Evidence

- Frontend: **201 tests pass**, including deadline enforcement before a delayed UI tick, illegal/legal move timing, engine latency exclusion, timed retry, expiry/untimed dragging, direct spoken submission, silent typed chat, voice stop/resume, board-side questions and network reconnect history. Production build passes.
- Backend: **181 tests pass**, zero failures/errors/skips in the combined Surefire reports. Report and scoped-position integration tests verify the recorded clock field; selected-level clock examples and chip counts are covered. An initially misplaced clock test fixture was corrected, then the affected integration suite rerun successfully.
- Impeccable detector: `[]` for `frontend/src/ui`. The existing palette, typeface and chessboard remain unchanged; the timer uses the same ink, paper, felt and marker-red states without pulsing decoration.
- Actual service check: the production token endpoint returns 200, the agent accepts history with no greeting, and a text-only question receives “We were discussing practicing decision-making under time trouble.” No microphone was requested. This verifies the service path separately from the DOM's mocked audio tests; hardware speech verification remains a user check.
- Local headless captures: 1440px desktop and 390px phone. The profile and position are authentic production responses; the selected tricky time-trouble position is game `53TMpDpZ`, ply `131`. A **six-second recorded-clock fixture** makes ready/running/expired/untimed states deterministic. It is not claimed to be that game's actual clock. The voice-off chat screenshot shows an editable, unsent draft. These are local layout checks, not live microphone recordings.

| State | Desktop | Phone |
| --- | --- | --- |
| Voice off, editable chat | [Desktop](time-trouble/chat-off-desktop.png) | [Phone](time-trouble/chat-off-mobile.png) |
| Ready, board covered | [Desktop](time-trouble/timed-ready-desktop.png) | [Phone](time-trouble/timed-ready-mobile.png) |
| Clock running | [Desktop](time-trouble/timed-running-desktop.png) | [Phone](time-trouble/timed-running-mobile.png) |
| Time expired | [Desktop](time-trouble/timed-expired-desktop.png) | [Phone](time-trouble/timed-expired-mobile.png) |
| Untimed continuation | [Desktop](time-trouble/timed-untimed-desktop.png) | [Phone](time-trouble/timed-untimed-mobile.png) |

Hashes and fixture provenance are in [provenance.json](time-trouble/provenance.json). This follow-up needs no database migration, rescoring or model swap.
