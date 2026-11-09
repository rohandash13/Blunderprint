package com.blunderprint.ingest;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

import com.blunderprint.PostgresIT;
import com.blunderprint.lichess.LichessClient;
import com.blunderprint.lichess.LichessGame;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;

class IngestServiceIT extends PostgresIT {
    @Autowired IngestService ingest;
    @MockBean LichessClient lichess;

    private LichessGame game() {
        return new LichessGame("g1", "Alice", "Bob", 1500, 1480, "blitz", "1-0", Instant.now(),
            "e4 e5 Nf3 Nc6", List.of(18000, 18000, 17900, 17800));
    }

    @Test
    void storesOnlyTheUsersMovesAndEnqueuesJobs() {
        when(lichess.fetchGames("alice", 10)).thenReturn(List.of(game()));
        var res = ingest.ingest("alice", 10, 10);
        assertEquals(1, res.games());
        assertEquals(2, res.moves());                       // plies 0 and 2
        assertEquals(4, res.jobsEnqueued());                // 2 before-keys + 2 after-keys, all distinct
        assertEquals(1500, jdbc.queryForObject("select distinct rating from move", Integer.class));
        assertEquals(18000, jdbc.queryForObject("select clock_cs from move where ply = 0", Integer.class));
        assertEquals(17900, jdbc.queryForObject("select clock_cs from move where ply = 2", Integer.class));
    }

    @Test
    void blackPlayerGetsTheOddPlies() {
        when(lichess.fetchGames("BOB", 10)).thenReturn(List.of(game()));
        var res = ingest.ingest("BOB", 10, 10);
        assertEquals(2, res.moves());
        assertEquals(1480, jdbc.queryForObject("select distinct rating from move", Integer.class));
        assertEquals(List.of(1, 3), jdbc.queryForList("select ply from move order by ply", Integer.class));
    }

    @Test
    void reIngestingReusesGameRowAndCachedEvals() {
        when(lichess.fetchGames("alice", 10)).thenReturn(List.of(game()));
        ingest.ingest("alice", 10, 10);
        jdbc.update("insert into eval_cache(fen_key, engine, depth, score_cp) select fen_key, engine, depth, 0 from eval_job");
        var second = ingest.ingest("alice", 10, 10);
        assertEquals(0, second.jobsEnqueued());
        assertEquals(1L, jdbc.queryForObject("select count(*) from game", Long.class));
    }
}
