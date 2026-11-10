package com.blunderprint.voice;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/** Mints short-lived Deepgram tokens so the browser never sees the API key. */
@Component
public class DeepgramTokenClient {
    public record Grant(@JsonProperty("access_token") String accessToken,
                        @JsonProperty("expires_in") int expiresIn) {}

    private final RestClient client;
    private final String apiKey;

    @Autowired
    public DeepgramTokenClient(@Value("${deepgram.base-url}") String baseUrl,
                               @Value("${deepgram.api-key:}") String apiKey) {
        this(RestClient.builder().baseUrl(baseUrl).requestFactory(timeouts()).build(), apiKey);
    }

    DeepgramTokenClient(RestClient client, String apiKey) {
        this.client = client;
        this.apiKey = apiKey == null ? "" : apiKey.trim();
    }

    private static SimpleClientHttpRequestFactory timeouts() {
        var f = new SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofSeconds(5));
        f.setReadTimeout(Duration.ofSeconds(10));
        return f;
    }

    public boolean configured() {
        return !apiKey.isEmpty();
    }

    public Grant grant(int ttlSeconds) {
        if (!configured()) throw new IllegalStateException("DEEPGRAM_API_KEY is not set");
        Grant g = client.post().uri("/v1/auth/grant")
            .header("Authorization", "Token " + apiKey)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("ttl_seconds", ttlSeconds))
            .retrieve()
            .body(Grant.class);
        if (g == null || g.accessToken() == null || g.accessToken().isBlank()) {
            throw new RestClientException("Deepgram grant response had no access_token");
        }
        return g;
    }
}
