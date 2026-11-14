# Referral demo walkthrough

Use https://useblunderprint.vercel.app in Chrome. Allow the microphone and enable both microphone and browser audio in your screen recorder. Headphones help keep the coach's voice out of the microphone.

For a short recording, use `Knight_ofthelight73` or the newly analyzed `EricRosen`. New analysis is real server work and takes several minutes; prepare the account before recording the coaching portion.

## A concise walkthrough

1. Open the landing page. Say: “Blunderprint finds recurring mistakes in a player's own Lichess games, then coaches them through those positions.”
2. Load the sample player. Show the written profile and grid briefly: rows are patterns, columns are games, and the key explains the marks.
3. Choose a positional drill, then click **Start voice**. Let the coach introduce itself and explain the current position.
4. Click a piece to show the legal-move dots. Drag it or click a destination, or speak/type a move.
5. A wrong move returns to the original position. Ask **“Why is that wrong?”** to reopen the attempt. Wait for the explanation, then say **“Show me the reply.”** The coach shows and explains one reply, then stops. Say **“Let me try again.”** to return with the answer hidden. **See why**, **Next** and **Try again** offer the same loop without voice.
6. Stop voice, type a question, then restart voice. The short introduction returns; the board, transcript and conversation stay in place.
7. If time permits, open **Time trouble → Timed drill**. The position stays covered until readiness, the clock uses a recorded game-time budget or a fallback, and a legal move stops it before review.

End with: “Chess legality, engine lines and verdicts come from code. Deepgram handles the live voice conversation and calls those coaching functions.”

## What was checked

- A previously unanalyzed `EricRosen` account completed the public ingestion, engine and model pipeline: 50 games, 1,843 player moves, 3,475 completed positions, no failed positions. Its profile, report and drill examples loaded afterward.
- Existing accounts `Knight_ofthelight73`, `DrNykterstein` and `thibault` retain their completed reports. The sample player's live timed drill was exercised in the previous rollout.
- Blank, malformed and nonexistent usernames return explicit errors. Public admin access is blocked. Analysis reuse, caps and queue behavior have backend coverage.
- The real voice service accepted context updates, spoke the contextual introduction twice on the same session, responded to synthetic spoken audio, stayed on the drill after a greeting, and called the hint function.
- The earlier recording exposed silent multi-move continuation. That behavior is replaced with runtime narration and user-turn gates. Spoken integration testing now checks wrong-move stop, optional attempt review, exactly one narrated reply, and explicit retry. Evidence is in [the pacing review](design/reviews/2026-11-13-guided-voice-pacing.md).
- The replacement recording uses the builder's own spoken questions; its script is [here](demo-voice-script.md). The first MP4 is superseded and should not be sent as the final demonstration.

“Any valid username” means an account with eligible rated blitz, rapid or classical games accessible through Lichess. Bullet-only or unrated-only accounts have no eligible games for this pipeline. Public analysis/voice limits and upstream availability still apply; a completed sample account makes the most reliable short demonstration.

The service-level speech test uses generated audio rather than a physical microphone. Before recording, do one short spoken move in your own Chrome session to verify microphone input and the recorder's audio tracks together.
