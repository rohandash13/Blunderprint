package com.blunderprint.api;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.ingest.IngestService;
import com.blunderprint.ingest.NoRatedGamesException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@AutoConfigureMockMvc
@TestPropertySource(properties = "DEMO_MODE=true")
class PublicAnalysisIT extends PostgresIT {
    static class MutableClock extends Clock {
        volatile Instant now = Instant.now();
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId z) { return this; }
        @Override public Instant instant() { return now; }
    }

    @TestConfiguration
    static class Cfg {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
    }

    @Autowired MockMvc mvc;
    @Autowired MutableClock clock;
    @MockBean IngestService ingest;

    private UUID stubIngest(String user) {
        UUID id = UUID.randomUUID();
        when(ingest.ingest(eq(user), anyInt(), anyInt())).thenAnswer(inv -> {
            jdbc.update("insert into analysis_run(id, username, engine, depth, status, created_at) values (?,?,?,?,?,?)",
                id, user, "e", 12, "RUNNING", Timestamp.from(clock.instant()));
            return new IngestService.IngestResult(id, 40, 1500, 900);
        });
        return id;
    }

    private ResultActions analyze(String user, String ip) throws Exception {
        return mvc.perform(post("/analysis").header("X-Forwarded-For", "9.9.9.9, " + ip)
            .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"" + user + "\",\"maxGames\":500,\"depth\":30}"));
    }

    @Test
    void forcesMaxGamesAndReturnsContractFields() throws Exception {
        UUID id = stubIngest("alice");
        analyze("alice", "10.0.0.1").andExpect(status().isAccepted())
            .andExpect(jsonPath("$.runId").value(id.toString()))
            .andExpect(jsonPath("$.games").value(40))
            .andExpect(jsonPath("$.moves").value(1500))
            .andExpect(jsonPath("$.jobsEnqueued").value(900))
            .andExpect(jsonPath("$.reused").value(false))
            .andExpect(jsonPath("$.queuePosition").value(0));
        verify(ingest).ingest(eq("alice"), eq(40), eq(12));
    }

    @Test
    void secondRunIsQueuedBehindTheFirst() throws Exception {
        stubIngest("alice");
        stubIngest("bob");
        analyze("alice", "10.0.0.2").andExpect(status().isAccepted());
        clock.now = clock.now.plusSeconds(5);
        analyze("bob", "10.0.0.3").andExpect(status().isAccepted())
            .andExpect(jsonPath("$.queuePosition").value(1));
    }

    @Test
    void reusesRecentDoneRunWithoutIngesting() throws Exception {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into analysis_run(id, username, engine, depth, status, created_at) values (?,?,?,?,?,?)",
            id, "Alice", "e", 12, "DONE", Timestamp.from(clock.instant().minus(Duration.ofDays(2))));
        analyze("alice", "10.0.0.4").andExpect(status().isAccepted())
            .andExpect(jsonPath("$.runId").value(id.toString()))
            .andExpect(jsonPath("$.reused").value(true))
            .andExpect(jsonPath("$.jobsEnqueued").value(0))
            .andExpect(jsonPath("$.queuePosition").value(0));
        verify(ingest, never()).ingest(anyString(), anyInt(), anyInt());
    }

    @Test
    void perIpCapIs429ThenResetsNextDay() throws Exception {
        for (String u : new String[] {"u1", "u2", "u3", "u4"}) stubIngest(u);
        analyze("u1", "1.1.1.1").andExpect(status().isAccepted());
        analyze("u2", "1.1.1.1").andExpect(status().isAccepted());
        analyze("u3", "1.1.1.1").andExpect(status().isAccepted());
        analyze("u4", "1.1.1.1").andExpect(status().isTooManyRequests()).andExpect(jsonPath("$.error").isNotEmpty());
        // a spoofed leading hop does not help: the last hop is the key
        mvc.perform(post("/analysis").header("X-Forwarded-For", "5.5.5.5, 1.1.1.1")
            .contentType(MediaType.APPLICATION_JSON).content("{\"username\":\"u4\"}"))
            .andExpect(status().isTooManyRequests());
        clock.now = clock.now.plus(Duration.ofHours(25));
        analyze("u4", "1.1.1.1").andExpect(status().isAccepted());
    }

    @Test
    void unknownUserIs404AndDoesNotConsumeQuota() throws Exception {
        when(ingest.ingest(eq("ghost"), anyInt(), anyInt())).thenThrow(new NoRatedGamesException("ghost"));
        for (int i = 0; i < 5; i++) {
            analyze("ghost", "3.3.3.3").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("No rated games found for ghost"));
        }
        stubIngest("real");
        analyze("real", "3.3.3.3").andExpect(status().isAccepted());
    }

    @Test
    void notFoundUsersAreNegativelyCachedForTenMinutes() throws Exception {
        when(ingest.ingest(eq("nosuch"), anyInt(), anyInt())).thenThrow(new NoRatedGamesException("nosuch"));
        analyze("nosuch", "6.6.6.1").andExpect(status().isNotFound());
        analyze("NoSuch", "6.6.6.2").andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("No rated games found for NoSuch"));
        verify(ingest, times(1)).ingest(eq("nosuch"), anyInt(), anyInt());
        clock.now = clock.now.plus(Duration.ofMinutes(11));
        analyze("nosuch", "6.6.6.3").andExpect(status().isNotFound());
        verify(ingest, times(2)).ingest(eq("nosuch"), anyInt(), anyInt());
    }

    @Test
    void everyAttemptCountsPerIpPerHour() throws Exception {
        for (int i = 0; i < 20; i++) analyze("bad name " + i, "7.7.7.7").andExpect(status().isNotFound());
        analyze("bad name", "7.7.7.7").andExpect(status().isTooManyRequests());
        clock.now = clock.now.plus(Duration.ofMinutes(61));
        analyze("bad name", "7.7.7.7").andExpect(status().isNotFound());
    }

    @Test
    void malformedUsernameIs404WithoutCallingLichessOrEchoing() throws Exception {
        analyze("bad%20name&x", "4.4.4.4").andExpect(status().isNotFound())
            .andExpect(jsonPath("$.error").value("Not a valid Lichess username"));
        verify(ingest, never()).ingest(anyString(), anyInt(), anyInt());
    }

    @Test
    void statusEndpointAndProgressQueuePosition() throws Exception {
        mvc.perform(get("/players/Alice/status")).andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("none"))
            .andExpect(jsonPath("$.runId").doesNotExist())
            .andExpect(jsonPath("$.queuePosition").value(0));
        UUID a = stubIngest("alice");
        UUID b = stubIngest("bob");
        analyze("alice", "10.0.0.5");
        clock.now = clock.now.plusSeconds(5);
        analyze("bob", "10.0.0.6");
        mvc.perform(get("/players/BOB/status")).andExpect(jsonPath("$.status").value("RUNNING"))
            .andExpect(jsonPath("$.runId").value(b.toString())).andExpect(jsonPath("$.queuePosition").value(1));
        mvc.perform(get("/analysis/" + b)).andExpect(status().isOk()).andExpect(jsonPath("$.queuePosition").value(1));
        mvc.perform(get("/analysis/" + a)).andExpect(jsonPath("$.queuePosition").value(0));
    }

    @Test
    void adminAndReenqueueStayBlocked() throws Exception {
        mvc.perform(post("/admin/workers").contentType(MediaType.APPLICATION_JSON).content("{\"count\":0}"))
            .andExpect(status().isForbidden());
        mvc.perform(post("/analysis/" + UUID.randomUUID() + "/reenqueue")).andExpect(status().isForbidden());
    }
}
