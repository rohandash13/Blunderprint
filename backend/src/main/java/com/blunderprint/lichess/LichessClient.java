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
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class LichessClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private final HttpClient http = HttpClient.newHttpClient();
    private final String baseUrl;
    private final String token;

    public LichessClient(@Value("${lichess.base-url}") String baseUrl, @Value("${lichess.token:}") String token) {
        this.baseUrl = baseUrl;
        this.token = token;
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
