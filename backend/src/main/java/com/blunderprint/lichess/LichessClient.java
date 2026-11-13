package com.blunderprint.lichess;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class LichessClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(java.time.Duration.ofSeconds(2)).build();
    private final java.util.function.LongSupplier now;
    private final String baseUrl;
    private final String token;
    private final Map<String, CachedUser> userCache = new ConcurrentHashMap<>();

    /** One rating category from the public user API. */
    public record Perf(int rating, int games, int prog) {}

    /** perfs == null is a negative entry (Lichess failed), kept briefly so an outage costs one wait a minute. */
    private record CachedUser(Map<String, Perf> perfs, long atMs) {}

    private static final long USER_TTL_MS = 10 * 60 * 1000L;
    private static final long FAILURE_TTL_MS = 60 * 1000L;
    private static final List<String> PERF_KEYS = List.of("bullet", "blitz", "rapid", "classical");

    @org.springframework.beans.factory.annotation.Autowired
    public LichessClient(@Value("${lichess.base-url}") String baseUrl, @Value("${lichess.token:}") String token) {
        this(baseUrl, token, System::currentTimeMillis);
    }

    LichessClient(String baseUrl, String token, java.util.function.LongSupplier now) {
        this.baseUrl = baseUrl;
        this.token = token;
        this.now = now;
    }

    public List<LichessGame> fetchGames(String username, int max) {
        String url = baseUrl + "/api/games/user/" + URLEncoder.encode(username, StandardCharsets.UTF_8)
            + "?max=" + max + "&rated=true&perfType=blitz,rapid,classical&moves=true&clocks=true&pgnInJson=false";
        // Lichess rejects default client user agents on this endpoint (404), so identify ourselves.
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(url))
            .header("Accept", "application/x-ndjson")
            .header("User-Agent", "blunderprint/0.1");
        if (!token.isBlank()) rb.header("Authorization", "Bearer " + token);
        try {
            HttpResponse<java.util.stream.Stream<String>> resp =
                http.send(rb.build(), HttpResponse.BodyHandlers.ofLines());
            if (resp.statusCode() == 404) {
                resp.body().close();
                throw new LichessUserNotFoundException(username);
            }
            if (resp.statusCode() == 429) throw new IllegalStateException("Lichess rate limit (429): wait a minute");
            if (resp.statusCode() != 200) throw new IllegalStateException("Lichess HTTP " + resp.statusCode());
            List<LichessGame> games = new ArrayList<>();
            try (var lines = resp.body()) {
                lines.filter(l -> !l.isBlank()).forEach(l -> parseLine(l).ifPresent(games::add));
            }
            return games;
        } catch (IOException | InterruptedException e) {
            throw new IllegalStateException("Lichess request failed", e);
        }
    }

    /**
     * Public ratings per category (only categories with games), cached 10 minutes; null when Lichess is
     * unreachable or answers anything but 200, so callers can still render without ratings.
     */
    public Map<String, Perf> fetchUser(String username) {
        String key = username.toLowerCase(java.util.Locale.ROOT);
        long t = now.getAsLong();
        CachedUser c = userCache.get(key);
        if (c != null && t - c.atMs() < (c.perfs() == null ? FAILURE_TTL_MS : USER_TTL_MS)) return c.perfs();
        Map<String, Perf> perfs = load(username);
        userCache.values().removeIf(u -> t - u.atMs() >= (u.perfs() == null ? FAILURE_TTL_MS : USER_TTL_MS));
        userCache.put(key, new CachedUser(perfs, t));
        return perfs;
    }

    private Map<String, Perf> load(String username) {
        try {
            HttpRequest.Builder rb = HttpRequest.newBuilder(
                    URI.create(baseUrl + "/api/user/" + URLEncoder.encode(username, StandardCharsets.UTF_8)))
                .header("Accept", "application/json").header("User-Agent", "blunderprint/0.1")
                .timeout(java.time.Duration.ofSeconds(3));
            if (!token.isBlank()) rb.header("Authorization", "Bearer " + token);
            HttpResponse<String> resp = http.send(rb.build(), HttpResponse.BodyHandlers.ofString());
            return resp.statusCode() == 200 ? parseUser(resp.body()) : null;
        } catch (IOException | RuntimeException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    static Map<String, Perf> parseUser(String json) {
        Map<String, Perf> out = new LinkedHashMap<>();
        try {
            JsonNode perfs = MAPPER.readTree(json).path("perfs");
            for (String k : PERF_KEYS) {
                JsonNode p = perfs.path(k);
                if (p.path("games").asInt(0) > 0 && p.has("rating")) {
                    out.put(k, new Perf(p.get("rating").asInt(), p.get("games").asInt(), p.path("prog").asInt(0)));
                }
            }
        } catch (IOException e) {
            throw new IllegalArgumentException("bad user json", e);
        }
        return out;
    }

    static Optional<LichessGame> parseLine(String json) {
        try {
            JsonNode n = MAPPER.readTree(json);
            JsonNode w = n.path("players").path("white");
            JsonNode b = n.path("players").path("black");
            String moves = n.path("moves").asText("");
            if (w.path("user").path("name").isMissingNode() || b.path("user").path("name").isMissingNode()
                || moves.isBlank()) {
                return Optional.empty();
            }
            String winner = n.path("winner").asText("");
            String result = winner.equals("white") ? "1-0" : winner.equals("black") ? "0-1" : "1/2-1/2";
            List<Integer> clocks = new ArrayList<>();
            n.path("clocks").forEach(c -> clocks.add(c.asInt()));
            return Optional.of(new LichessGame(
                n.path("id").asText(),
                w.path("user").path("name").asText(), b.path("user").path("name").asText(),
                w.has("rating") ? w.get("rating").asInt() : null,
                b.has("rating") ? b.get("rating").asInt() : null,
                n.path("perf").asText(null), result,
                Instant.ofEpochMilli(n.path("createdAt").asLong()), moves, clocks));
        } catch (IOException e) {
            return Optional.empty();
        }
    }
}
