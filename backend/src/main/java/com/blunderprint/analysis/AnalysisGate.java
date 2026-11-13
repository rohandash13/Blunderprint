package com.blunderprint.analysis;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Public-demo admission control: reuse of recent runs, daily caps (global and per client IP, in memory, sliding
 * 24 h on the injected clock), queue positions and per-player status. Runs queue FIFO simply by being ingested;
 * the worker pool drains one job queue.
 */
@Component
public class AnalysisGate {
    private static final long DAY_MS = Duration.ofDays(1).toMillis();
    private static final long HOUR_MS = Duration.ofHours(1).toMillis();
    private static final long MISSING_TTL_MS = Duration.ofMinutes(10).toMillis();
    private static final Duration STALE = Duration.ofHours(6);

    public record Reuse(UUID runId, int games, int moves, int queuePosition) {}
    public record PlayerStatus(String status, UUID runId, int queuePosition) {}
    public record Reservation(String ip, long atMs) {}

    public static class CapExceededException extends RuntimeException {
        public CapExceededException(String message) { super(message); }
    }

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final int maxPerDay;
    private final int maxPerIpPerDay;
    private final int reuseDays;
    private final int maxAttemptsPerIpPerHour;
    private final Map<String, Deque<Long>> attempts = new HashMap<>();
    private final Map<String, Long> missing = new HashMap<>();
    private final Object[] userLocks = new Object[256];
    private final Map<String, Deque<Long>> byIp = new HashMap<>();
    private final Deque<Long> global = new ArrayDeque<>();

    public AnalysisGate(JdbcTemplate jdbc, Clock clock,
                        @Value("${analysis.max-runs-per-day:40}") int maxPerDay,
                        @Value("${analysis.max-runs-per-ip-per-day:3}") int maxPerIpPerDay,
                        @Value("${analysis.reuse-days:7}") int reuseDays,
                        @Value("${analysis.max-attempts-per-ip-per-hour:20}") int maxAttemptsPerIpPerHour) {
        this.maxAttemptsPerIpPerHour = maxAttemptsPerIpPerHour;
        for (int i = 0; i < userLocks.length; i++) userLocks[i] = new Object();
        this.jdbc = jdbc;
        this.clock = clock;
        this.maxPerDay = maxPerDay;
        this.maxPerIpPerDay = maxPerIpPerDay;
        this.reuseDays = reuseDays;
    }

    /** Counts every POST attempt (never released); throws past the hourly per-IP limit. */
    public synchronized void tryAttempt(String ip) {
        long now = clock.millis();
        attempts.values().removeIf(d -> { evict(d, now - HOUR_MS); return d.isEmpty(); });
        Deque<Long> mine = attempts.computeIfAbsent(ip, k -> new ArrayDeque<>());
        if (mine.size() >= maxAttemptsPerIpPerHour) {
            throw new CapExceededException("Too many requests from this connection. Try again in a while.");
        }
        mine.addLast(now);
    }

    public synchronized boolean isKnownMissing(String username) {
        long now = clock.millis();
        missing.values().removeIf(t -> now - t >= MISSING_TTL_MS);
        return missing.containsKey(username.toLowerCase(java.util.Locale.ROOT));
    }

    public synchronized void markMissing(String username) {
        missing.put(username.toLowerCase(java.util.Locale.ROOT), clock.millis());
    }

    /** Striped per-username lock so simultaneous requests for one new user ingest once. */
    public Object lockFor(String username) {
        return userLocks[Math.floorMod(username.toLowerCase(java.util.Locale.ROOT).hashCode(), userLocks.length)];
    }

    /** Takes one slot from both caps or throws; pair with {@link #release} if the run is not created. */
    public synchronized Reservation reserve(String ip) {
        long now = clock.millis();
        evict(global, now - DAY_MS);
        byIp.values().removeIf(d -> { evict(d, now - DAY_MS); return d.isEmpty(); });
        Deque<Long> mine = byIp.get(ip);
        if (global.size() >= maxPerDay) {
            throw new CapExceededException("The public demo has reached today's analysis limit. Try again tomorrow.");
        }
        if (mine != null && mine.size() >= maxPerIpPerDay) {
            throw new CapExceededException("You have used today's " + maxPerIpPerDay
                + " analyses from this connection. Try again tomorrow.");
        }
        global.addLast(now);
        byIp.computeIfAbsent(ip, k -> new ArrayDeque<>()).addLast(now);
        return new Reservation(ip, now);
    }

    public synchronized void release(Reservation r) {
        global.removeFirstOccurrence(r.atMs());
        Deque<Long> mine = byIp.get(r.ip());
        if (mine != null) {
            mine.removeFirstOccurrence(r.atMs());
            if (mine.isEmpty()) byIp.remove(r.ip());
        }
    }

    /** The user's newest DONE run younger than reuse-days, or one still in flight (no point analysing twice). */
    public Optional<Reuse> findReusable(String username) {
        Timestamp cutoff = Timestamp.from(clock.instant().minus(Duration.ofDays(reuseDays)));
        List<UUID> ids = jdbc.queryForList("""
            select id from analysis_run
            where lower(username) = lower(?) and created_at > ?
              and (status = 'DONE' or (status in ('RUNNING','SCORING') and created_at > ?))
            order by created_at desc limit 1
            """, UUID.class, username, cutoff, Timestamp.from(clock.instant().minus(STALE)));
        if (ids.isEmpty()) return Optional.empty();
        UUID id = ids.get(0);
        var counts = jdbc.queryForMap("select count(distinct game_id) g, count(*) m from move where run_id = ?", id);
        return Optional.of(new Reuse(id, ((Number) counts.get("g")).intValue(), ((Number) counts.get("m")).intValue(),
            queuePosition(id)));
    }

    public int queuePosition(UUID runId) {
        return queuePosition(jdbc, runId, clock.instant());
    }

    /** Non-finished runs created before this one that are still RUNNING/SCORING; 0 when this run is not queued. */
    public static int queuePosition(JdbcTemplate jdbc, UUID runId, java.time.Instant now) {
        Integer n = jdbc.queryForObject("""
            select count(*) from analysis_run o, analysis_run r
            where r.id = ? and r.status in ('RUNNING','SCORING')
              and o.status in ('RUNNING','SCORING') and o.created_at < r.created_at
              and o.created_at > ?
            """, Integer.class, runId, Timestamp.from(now.minus(STALE)));
        return n == null ? 0 : n;
    }

    public PlayerStatus playerStatus(String username) {
        var rows = jdbc.queryForList("""
            select id, status from analysis_run
            where lower(username) = lower(?) and (status in ('DONE','FAILED') or created_at > ?)
            order by created_at desc limit 1
            """, username, Timestamp.from(clock.instant().minus(STALE)));
        if (rows.isEmpty()) return new PlayerStatus("none", null, 0);
        UUID id = (UUID) rows.get(0).get("id");
        return new PlayerStatus((String) rows.get(0).get("status"), id, queuePosition(id));
    }

    private static void evict(Deque<Long> d, long cutoff) {
        while (!d.isEmpty() && d.peekFirst() <= cutoff) d.removeFirst();
    }
}
