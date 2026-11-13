package com.blunderprint.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class ModelClient {
    public record MoveIn(long id, String fen, Integer rating,
                         @JsonProperty("played_uci") String playedUci,
                         @JsonProperty("best_uci") String bestUci,
                         int cpl,
                         @JsonProperty("clock_cs") Integer clockCs) {}

    public record MoveOut(long id, @JsonProperty("p_played") double pPlayed, List<String> tags,
                          @JsonProperty("p_best") Double pBest,
                          @JsonProperty("best_quiet") Boolean bestQuiet,
                          @JsonProperty("best_free_material") Boolean bestFreeMaterial) {
        public MoveOut(long id, double pPlayed, List<String> tags, Double pBest) {
            this(id, pPlayed, tags, pBest, null, null);
        }

        public MoveOut(long id, double pPlayed, List<String> tags) {
            this(id, pPlayed, tags, null, null, null);
        }
    }

    private final RestClient client;

    @Autowired
    public ModelClient(@Value("${model.url}") String url) {
        this(RestClient.builder().baseUrl(url).requestFactory(timeouts()).build());
    }

    private static SimpleClientHttpRequestFactory timeouts() {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(60));
        return factory;
    }

    ModelClient(RestClient client) {
        this.client = client;
    }

    public List<MoveOut> analyze(List<MoveIn> moves) {
        return client.post().uri("/analyze").body(Map.of("moves", moves))
            .retrieve().body(new ParameterizedTypeReference<List<MoveOut>>() {});
    }
}
