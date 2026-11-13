package com.blunderprint.report;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.lichess.LichessClient;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc
class ProfileIT extends PostgresIT {
    static final String START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    static final String MID = "r3k2r/pppq1ppp/2n5/3p4/3P4/2N5/PPPQ1PPP/R3K2R w KQkq - 0 15";   // 6 non-pawn non-king
    static final String END = "4k3/pp3ppp/8/8/8/8/PP3PPP/R3K2R w KQ - 0 40";                    // 2 non-pawn non-king

    @Autowired MockMvc mvc;
    @MockBean LichessClient lichess;
    UUID run;

    @BeforeEach
    void setUp() {
        run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth, status) values (?, 'Alice', 'sf', 10, 'DONE')", run);
        when(lichess.fetchUser("Alice")).thenReturn(null);
    }

    private void game(String id, String white, String black, String result, String playedAt) {
        jdbc.update("insert into game(id, white, black, result, played_at) values (?, ?, ?, ?, ?::timestamptz)",
            id, white, black, result, playedAt);
    }

    private void move(String game, int ply, String mover, String fen, Integer clock, double winDrop, boolean quiet,
                      String tags, Integer elo) {
        long id = jdbc.queryForObject("""
            insert into move(run_id, game_id, ply, fullmove, mover, rating, before_fen, before_key, after_key, played_uci, played_san, clock_cs)
            values (?, ?, ?, ?, ?, 1500, ?, 'k', 'k2', 'e2e4', 'e4', ?) returning id""", Long.class,
            run, game, ply, ply / 2 + 1, mover, fen, clock);
        jdbc.update("""
            insert into move_analysis(move_id, cpl, best_uci, p_played, tags, win_drop, best_quiet, difficulty_elo)
            values (?, 300, 'd2d4', 0.4, ?::text[], ?, ?, ?)""", id, tags, winDrop, quiet, elo);
    }

    @Test
    void notFoundWithoutDoneRun() throws Exception {
        mvc.perform(get("/players/nobody/profile")).andExpect(status().isNotFound());
    }

    @Test
    void ratingsNullWhenLichessDown() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        move("g1", 0, "w", START, null, 0.01, false, "{}", 1500);
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.username").value("Alice"))
            .andExpect(jsonPath("$.ratings").doesNotExist());
    }

    @Test
    void ratingsPassedThroughFromLichess() throws Exception {
        when(lichess.fetchUser("Alice")).thenReturn(Map.of("blitz", new LichessClient.Perf(1650, 420, 12)));
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        move("g1", 0, "w", START, null, 0.01, false, "{}", 1500);
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.ratings.blitz.rating").value(1650))
            .andExpect(jsonPath("$.ratings.blitz.games").value(420))
            .andExpect(jsonPath("$.ratings.blitz.prog").value(12));
    }

    @Test
    void recordByColourCaseInsensitive() throws Exception {
        game("g1", "ALICE", "x", "1-0", "2026-01-01T00:00:00Z");        // white win
        game("g2", "x", "alice", "1-0", "2026-01-02T00:00:00Z");        // black loss
        game("g3", "x", "Alice", "0-1", "2026-01-03T00:00:00Z");        // black win
        game("g4", "Alice", "x", "1/2-1/2", "2026-01-04T00:00:00Z");    // white draw
        for (String g : new String[] {"g1", "g2", "g3", "g4"}) {
            String mover = g.equals("g1") || g.equals("g4") ? "w" : "b";
            move(g, mover.equals("w") ? 0 : 1, mover, START, null, 0.01, false, "{}", 1500);
        }
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.analyzed.games").value(4))
            .andExpect(jsonPath("$.analyzed.moves").value(4))
            .andExpect(jsonPath("$.analyzed.from").value("2026-01-01T00:00:00Z"))
            .andExpect(jsonPath("$.analyzed.to").value("2026-01-04T00:00:00Z"))
            .andExpect(jsonPath("$.record.white.w").value(1))
            .andExpect(jsonPath("$.record.white.d").value(1))
            .andExpect(jsonPath("$.record.white.l").value(0))
            .andExpect(jsonPath("$.record.black.w").value(1))
            .andExpect(jsonPath("$.record.black.d").value(0))
            .andExpect(jsonPath("$.record.black.l").value(1));
    }

    @Test
    void phaseRatesKindsAndClock() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        // opening (ply <= 20): 2 moves, 1 candidate
        move("g1", 0, "w", START, 9000, 0.01, false, "{}", 1500);
        move("g1", 2, "w", START, 9000, 0.20, false, "{missed_tactic}", 1500);
        // middlegame: 4 moves, 1 candidate, a quiet inaccuracy candidate (positional)
        move("g1", 22, "w", MID, 2000, 0.07, true, "{positional}", 1500);      // under 30s, candidate
        move("g1", 24, "w", MID, 9000, 0.01, false, "{}", 1500);
        move("g1", 26, "w", MID, 9000, 0.01, false, "{}", 1500);
        move("g1", 28, "w", MID, null, 0.01, false, "{}", 1500);                // no clock
        // endgame: 2 moves, 2 candidates
        move("g1", 42, "w", END, 1000, 0.30, false, "{endgame_technique}", 1500);
        move("g1", 44, "w", END, 9000, 0.30, false, "{endgame_technique}", 1500);
        // tactical inaccuracy is not a candidate
        move("g1", 46, "w", END, 9000, 0.07, false, "{}", 1500);
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.phases.opening").value(50.0))
            .andExpect(jsonPath("$.phases.middlegame").value(25.0))
            .andExpect(jsonPath("$.phases.endgame").value(2 * 100.0 / 3))
            .andExpect(jsonPath("$.kinds.positional").value(1))
            .andExpect(jsonPath("$.kinds.tactical").value(3))
            // clock known on 8 moves; under 30s: plies 22 and 42 -> share 2/8
            .andExpect(jsonPath("$.clock.underThirtyShare").value(0.25))
            .andExpect(jsonPath("$.clock.mistakeRateUnder30").value(100.0))
            .andExpect(jsonPath("$.clock.mistakeRateOver30").value(100.0 * 2 / 6));
    }

    @Test
    void gridOrderedOldestToNewestWithPrimaryPatternMarks() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        game("g2", "x", "alice", "1-0", "2026-01-02T00:00:00Z");
        move("g1", 2, "w", START, null, 0.20, false, "{endgame_technique,missed_tactic}", 1500);
        move("g1", 4, "w", START, null, 0.01, false, "{}", 1500);
        move("g2", 3, "b", START, null, 0.07, true, "{opening_error,positional}", 1700);
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.grid.length()").value(2))
            .andExpect(jsonPath("$.grid[0].gameId").value("g1"))
            .andExpect(jsonPath("$.grid[0].color").value("white"))
            .andExpect(jsonPath("$.grid[0].result").value("w"))
            .andExpect(jsonPath("$.grid[0].playedAt").value("2026-01-01T00:00:00Z"))
            .andExpect(jsonPath("$.grid[0].marks.length()").value(1))
            .andExpect(jsonPath("$.grid[0].marks[0].ply").value(2))
            .andExpect(jsonPath("$.grid[0].marks[0].pattern").value("missed_tactic"))
            .andExpect(jsonPath("$.grid[0].marks[0].kind").value("tactical"))
            .andExpect(jsonPath("$.grid[0].marks[0].level").value("tricky"))
            .andExpect(jsonPath("$.grid[0].marks[0].winDrop").value(0.20))
            .andExpect(jsonPath("$.grid[1].gameId").value("g2"))
            .andExpect(jsonPath("$.grid[1].color").value("black"))
            .andExpect(jsonPath("$.grid[1].result").value("l"))
            .andExpect(jsonPath("$.grid[1].marks[0].pattern").value("positional"))
            .andExpect(jsonPath("$.grid[1].marks[0].level").value("deep"));
    }

    @Test
    void gridKeepsOnlyTheFortyMostRecentGames() throws Exception {
        for (int i = 0; i < 42; i++) {
            String id = "g" + i;
            game(id, "alice", "x", "1-0", Instant.parse("2026-01-01T00:00:00Z").plusSeconds(i * 3600L).toString());
            move(id, 0, "w", START, null, 0.01, false, "{}", 1500);
        }
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.grid.length()").value(40))
            .andExpect(jsonPath("$.grid[0].gameId").value("g2"))
            .andExpect(jsonPath("$.grid[39].gameId").value("g41"));
    }

    @Test
    void patternsAggregateWithLevelsAndKinds() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        game("g2", "alice", "x", "1-0", "2026-01-05T00:00:00Z");
        move("g1", 0, "w", START, null, 0.20, false, "{missed_tactic}", 1200);   // slip
        move("g2", 2, "w", START, null, 0.30, false, "{missed_tactic}", 2000);   // deep
        move("g2", 4, "w", START, null, 0.20, false, "{missed_tactic}", null);   // unrated
        move("g2", 6, "w", START, null, 0.07, true, "{positional}", 1500);       // tricky
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.patterns.length()").value(2))
            .andExpect(jsonPath("$.patterns[0].tag").value("missed_tactic"))
            .andExpect(jsonPath("$.patterns[0].count").value(3))
            .andExpect(jsonPath("$.patterns[0].lastSeen").value("2026-01-05T00:00:00Z"))
            .andExpect(jsonPath("$.patterns[0].levels.slip").value(1))
            .andExpect(jsonPath("$.patterns[0].levels.tricky").value(0))
            .andExpect(jsonPath("$.patterns[0].levels.deep").value(1))
            .andExpect(jsonPath("$.patterns[0].levels.unrated").value(1))
            .andExpect(jsonPath("$.patterns[0].kinds.tactical").value(3))
            .andExpect(jsonPath("$.patterns[0].kinds.positional").value(0))
            .andExpect(jsonPath("$.patterns[1].tag").value("positional"))
            .andExpect(jsonPath("$.patterns[1].kinds.positional").value(1))
            .andExpect(jsonPath("$.patterns[1].levels.tricky").value(1));
    }

    @Test
    void positionEndpointReturnsExampleOr404() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        move("g1", 2, "w", START, null, 0.20, false, "{missed_tactic}", 1500);
        jdbc.update("insert into eval_cache(fen_key, engine, depth, multipv, best_uci, score_cp, pv) values ('k', 'sf', 10, 1, 'd2d4', 50, 'd2d4 d7d5')");
        mvc.perform(get("/players/Alice/positions/g1/2")).andExpect(status().isOk())
            .andExpect(jsonPath("$.gameId").value("g1"))
            .andExpect(jsonPath("$.ply").value(2))
            .andExpect(jsonPath("$.fen").value(START))
            .andExpect(jsonPath("$.played").value("e2e4"))
            .andExpect(jsonPath("$.best").value("d2d4"))
            .andExpect(jsonPath("$.pv[1]").value("d7d5"))
            .andExpect(jsonPath("$.kind").value("tactical"))
            .andExpect(jsonPath("$.severity").value("blunder"))
            .andExpect(jsonPath("$.level").value("tricky"));
        mvc.perform(get("/players/Alice/positions/g1/99")).andExpect(status().isNotFound());
        mvc.perform(get("/players/Alice/positions/nope/2")).andExpect(status().isNotFound());
        mvc.perform(get("/players/nobody/positions/g1/2")).andExpect(status().isNotFound());
    }

    static final String FIVE = "rn2k2r/pp3ppp/8/8/8/8/PP3PPP/R3K2R w KQkq - 0 40";              // 5 non-pawn non-king

    @Test
    void phaseBoundaries() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        move("g1", 19, "b", START, null, 0.20, false, "{}", 1500);     // last opening ply (fullmove 10)
        move("g1", 20, "w", FIVE, null, 0.20, false, "{}", 1500);      // first non-opening ply, 5 pieces: middlegame
        move("g1", 22, "w", FIVE, null, 0.01, false, "{}", 1500);
        move("g1", 24, "w", END, null, 0.20, false, "{}", 1500);       // 4 pieces: endgame
        move("g1", 26, "w", END, null, 0.01, false, "{}", 1500);
        move("g1", 28, "w", END, null, 0.01, false, "{}", 1500);
        move("g1", 30, "w", END, null, 0.01, false, "{}", 1500);
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.phases.opening").value(100.0))
            .andExpect(jsonPath("$.phases.middlegame").value(50.0))
            .andExpect(jsonPath("$.phases.endgame").value(25.0));
    }

    @Test
    void undatedGamesStayOutOfTheGrid() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        jdbc.update("insert into game(id, white, black, result, played_at) values ('g2', 'alice', 'x', '1-0', null)");
        move("g1", 0, "w", START, null, 0.01, false, "{}", 1500);
        move("g2", 0, "w", START, null, 0.01, false, "{}", 1500);
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.grid.length()").value(1))
            .andExpect(jsonPath("$.grid[0].gameId").value("g1"));
    }

    @Test
    void colourFallsBackToMoverWhenNameMatchesNeitherSide() throws Exception {
        game("g1", "p1", "p2", "0-1", "2026-01-01T00:00:00Z");
        move("g1", 1, "b", START, null, 0.01, false, "{}", 1500);
        mvc.perform(get("/players/Alice/profile")).andExpect(status().isOk())
            .andExpect(jsonPath("$.grid[0].color").value("black"))
            .andExpect(jsonPath("$.grid[0].result").value("w"))
            .andExpect(jsonPath("$.record.black.w").value(1));
    }

    @Test
    void positionIsScopedToThePlayersOwnRun() throws Exception {
        game("g1", "alice", "x", "1-0", "2026-01-01T00:00:00Z");
        game("g2", "bob", "x", "1-0", "2026-01-01T00:00:00Z");
        move("g1", 2, "w", START, null, 0.20, false, "{missed_tactic}", 1500);
        UUID alice = run;
        run = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth, status) values (?, 'Bob', 'sf', 10, 'DONE')", run);
        move("g2", 4, "w", START, null, 0.20, false, "{missed_tactic}", 1500);
        mvc.perform(get("/players/Bob/positions/g2/4")).andExpect(status().isOk());
        mvc.perform(get("/players/Alice/positions/g2/4")).andExpect(status().isNotFound());
        mvc.perform(get("/players/Bob/positions/g1/2")).andExpect(status().isNotFound());
        mvc.perform(get("/players/Alice/positions/g1/2")).andExpect(status().isOk());
    }
}
