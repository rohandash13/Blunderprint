package com.blunderprint.ingest;

import com.blunderprint.chess.GameReplayer;
import com.blunderprint.chess.ReplayedMove;
import com.blunderprint.lichess.LichessClient;
import com.blunderprint.lichess.LichessGame;
import com.blunderprint.lichess.LichessUserNotFoundException;
import com.blunderprint.store.JobQueueRepository;
import java.sql.Timestamp;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class IngestService {
    public record IngestResult(UUID runId, int games, int moves, int jobsEnqueued) {}

    private final LichessClient lichess;
    private final JdbcTemplate jdbc;
    private final JobQueueRepository queue;
    private final String engine;

    public IngestService(LichessClient lichess, JdbcTemplate jdbc, JobQueueRepository queue,
                         @Value("${engine.version}") String engine) {
        this.lichess = lichess;
        this.jdbc = jdbc;
        this.queue = queue;
        this.engine = engine;
    }

    @Transactional
    public IngestResult ingest(String username, int maxGames, int depth) {
        List<LichessGame> games;
        try {
            games = lichess.fetchGames(username, maxGames);
        } catch (LichessUserNotFoundException e) {
            throw new NoRatedGamesException(username);
        }
        if (games.isEmpty()) throw new NoRatedGamesException(username);
        UUID runId = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth) values (?, ?, ?, ?)",
            runId, username, engine, depth);
        int moveCount = 0;
        for (LichessGame g : games) {
            boolean userIsWhite = g.white().equalsIgnoreCase(username);
            if (!userIsWhite && !g.black().equalsIgnoreCase(username)) continue;
            jdbc.update("""
                insert into game(id, white, black, white_rating, black_rating, perf, result, played_at)
                values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing
                """, g.id(), g.white(), g.black(), g.whiteRating(), g.blackRating(), g.perf(), g.result(),
                Timestamp.from(g.playedAt()));
            Integer rating = userIsWhite ? g.whiteRating() : g.blackRating();
            String userSide = userIsWhite ? "w" : "b";
            for (ReplayedMove m : GameReplayer.replay(g.sanMoves())) {
                if (!m.mover().equals(userSide)) continue;
                Integer clock = m.ply() < g.clocksCs().size() ? g.clocksCs().get(m.ply()) : null;
                jdbc.update("""
                    insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key,
                                     after_key, played_uci, played_san, clock_cs)
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, runId, g.id(), m.ply(), m.fullmove(), m.mover(), rating, m.beforeFen(), m.beforeKey(),
                    m.afterKey(), m.playedUci(), m.playedSan(), clock);
                moveCount++;
            }
        }
        if (moveCount == 0) throw new NoRatedGamesException(username); // rolls the run back
        int jobs = queue.enqueueForRun(runId);
        return new IngestResult(runId, games.size(), moveCount, jobs);
    }
}
