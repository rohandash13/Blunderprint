package com.blunderprint.api;

import com.blunderprint.voice.DeepgramTokenClient;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClientException;

@RestController
public class VoiceController {
    private static final Logger log = LoggerFactory.getLogger(VoiceController.class);
    private static final int TTL_SECONDS = 30;

    public record TokenResponse(String token, int expiresIn) {}

    private final DeepgramTokenClient tokens;

    public VoiceController(DeepgramTokenClient tokens) {
        this.tokens = tokens;
    }

    @GetMapping("/voice/token")
    public ResponseEntity<Object> token() {
        try {
            var g = tokens.grant(TTL_SECONDS);
            return ResponseEntity.ok(new TokenResponse(g.accessToken(), g.expiresIn()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(503).body(Map.of("error", e.getMessage()));
        } catch (RestClientException e) {
            String status = e instanceof org.springframework.web.client.RestClientResponseException r
                ? String.valueOf(r.getStatusCode().value()) : "no response";
            log.warn("deepgram token request failed: {} (HTTP {})", e.getClass().getSimpleName(), status);
            return ResponseEntity.status(503).body(Map.of("error", "Deepgram token request failed"));
        }
    }
}
