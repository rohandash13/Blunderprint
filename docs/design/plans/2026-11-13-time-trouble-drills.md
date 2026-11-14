# Timed decisions and continuous conversation

The user's live feedback supersedes the earlier rule that clock mistakes cannot be drilled. Time trouble uses the same classic board, move validation, voice functions, dragging, promotion and typed input as other patterns.

- Include clock positions in reports at the selected difficulty, without requiring Slips. Report and individual-position responses expose the existing nullable `recordedClockCs` field from the stored move clock. No migration, rescore or model change is needed.
- Use a positive recorded reading up to thirty seconds as the decision budget; otherwise use a clearly labeled thirty-second fallback. Lichess's stored reading is post-move: this is a practice budget, not a reconstructed pre-move clock or full-game simulation.
- Cover the position until the player starts. Support the Start clock button and the `start_clock` voice function after readiness. Use a deadline so delayed browser ticks cannot extend the attempt. Illegal moves keep the clock running; legal submissions stop it before animation/network/engine review. Legal spoken transcripts execute directly rather than waiting for an LLM tool call.
- Timeout leaves the answer hidden and offers Retry timed attempt or Practice without clock. Reset creates a new attempt and clears solved/revealed/hint state for timed drills. Reveal/line review removes time pressure. Other drills retain their existing behavior.
- Keep timer output readable and quiet, with no pulse or repeated screen-reader announcements. Put a compact remaining-time reminder by the phone composer.
- Stop voice releases the microphone and stops playback, while retaining the agent conversation for text. Typed chat can establish the agent connection without microphone permission. Reconnects provide recent transcript history and the current drill context, omitting the greeting. Changing player/unmounting closes the session.
- Keep text inputs editable during voice changes and move checking. Send actions guard against overlapping move submissions without discarding a composed draft. Provide a move/question switch beside the board.

Regression tests precede implementation for clock budgets, expiry, legal/illegal moves, pre-engine stopping, retry, timed focus selection, voice/typing continuity and reconnect history. Finish with frontend tests/build, backend report/position tests and the full suite, the design detector, desktop/phone captures and production endpoint checks.
