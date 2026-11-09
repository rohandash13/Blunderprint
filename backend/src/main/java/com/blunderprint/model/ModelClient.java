package com.blunderprint.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class ModelClient {
    public record MoveIn(long id, String fen, Integer rating,
                         @JsonProperty("played_uci") String playedUci,
                         @JsonProperty("best_uci") String bestUci,
                         int cpl,
                         @JsonProperty("clock_cs") Integer clockCs) {}

    public record MoveOut(long id, @JsonProperty("p_played") double pPlayed, List<String> tags) {}

    private final RestClient client;

    @Autowired
    public ModelClient(@Value("${model.url}") String url) {
        this(RestClient.builder().baseUrl(url).build());
    }

    ModelClient(RestClient client) {
        this.client = client;
    }

    public List<MoveOut> analyze(List<MoveIn> moves) {
        return client.post().uri("/analyze").body(Map.of("moves", moves))
            .retrieve().body(new ParameterizedTypeReference<List<MoveOut>>() {});
    }
}
