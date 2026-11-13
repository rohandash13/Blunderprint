package com.blunderprint.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** In-memory sliding-window limiter for GET /voice/token: per client IP per hour, and globally per day. */
@Component
public class VoiceRateLimitFilter extends OncePerRequestFilter {
    private static final long HOUR_MS = Duration.ofHours(1).toMillis();
    private static final long DAY_MS = Duration.ofDays(1).toMillis();

    private final int perIpPerHour;
    private final int perDay;
    private final Clock clock;
    private final Map<String, Deque<Long>> byIp = new HashMap<>();
    private final Deque<Long> global = new ArrayDeque<>();

    @Autowired
    public VoiceRateLimitFilter(
            @Value("${voice.rate.per-ip-per-hour:20}") int perIpPerHour,
            @Value("${voice.rate.per-day:300}") int perDay) {
        this(perIpPerHour, perDay, Clock.systemUTC());
    }

    VoiceRateLimitFilter(int perIpPerHour, int perDay, Clock clock) {
        this.perIpPerHour = perIpPerHour;
        this.perDay = perDay;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (!"GET".equals(req.getMethod()) || !"/voice/token".equals(req.getRequestURI())) {
            chain.doFilter(req, res);
            return;
        }
        if (!tryAcquire(clientIp(req))) {
            res.setStatus(429);
            res.setContentType("application/json");
            res.setCharacterEncoding(StandardCharsets.UTF_8.name());
            res.getWriter().write("{\"error\":\"Voice demo limit reached, try again later\"}");
            return;
        }
        chain.doFilter(req, res);
    }

    private synchronized boolean tryAcquire(String ip) {
        long now = clock.millis();
        evict(global, now - DAY_MS);
        byIp.values().removeIf(d -> { evict(d, now - HOUR_MS); return d.isEmpty(); });
        Deque<Long> mine = byIp.get(ip);
        if (global.size() >= perDay || (mine != null && mine.size() >= perIpPerHour)) return false;
        global.addLast(now);
        byIp.computeIfAbsent(ip, k -> new ArrayDeque<>()).addLast(now);
        return true;
    }

    private static void evict(Deque<Long> d, long cutoff) {
        while (!d.isEmpty() && d.peekFirst() <= cutoff) d.removeFirst();
    }

    private static String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] hops = xff.split(",");
            return hops[hops.length - 1].trim(); // the entry the platform proxy appended; earlier ones are client-supplied
        }
        return req.getRemoteAddr();
    }
}
