# Coach input and conversation polish

This extends the approved Club Wallchart direction following live testing. Keep the felt rail, paper grid, Archivo, classic pieces and code-based chess judgment.

- Validate typed and dropped moves in code against the position actually visible. Tell the voice agent the verified result afterward. Deduplicate a repeated agent function call for the same UI move. Keep spoken move parsing tolerant of file-letter homophones, while rejecting ambiguous or unrecognized input.
- Enable dragging only for the player's pieces on their turn, with legal-destination feedback and promotion selection. Keep typed and voice input available.
- Start voice opens a modeless paper conversation panel on Profile and Choose focus. The same transcript docks beside the board in Drill. Preserve a way to reopen the conversation and keyboard dismissal.
- Use **Weaknesses** in visible labels and coaching copy. Internal data keys can remain compatible.
- Explain the wallchart before the table: axes, difficulty fills/colors, dot size, dashed unrated marks, outer rings, game-header colors, yellow emphasis and score symbols.

## Motion thesis

The focal moment is the wallchart taking its ink: marks settle onto the paper when the chart is first opened or a difficulty selection reveals them. Supporting motion makes causes legible: highlighter selections change smoothly, controls acknowledge a press, and the paper conversation panel unfolds and closes more quickly than it opens. Board movement remains the chess library's existing short animation.

Use bounded CSS transforms, opacity and a small clip/filter reveal, not scroll choreography or continuous decorative loops. The default state stays visible. Routine feedback stays fast, overlay arrival stays below half a second, and reduced-motion preferences remove spatial movement and board animation while preserving short color/opacity feedback. No motion dependency is needed.

Tests precede implementation, covering the reported Qc2 position, visible-board input, dragging, promotion, voice-mode direct validation, pre-board conversation and the explanatory legend. Finish with the frontend suite/build and desktop/phone screenshots through the supplied headless review workflow.
