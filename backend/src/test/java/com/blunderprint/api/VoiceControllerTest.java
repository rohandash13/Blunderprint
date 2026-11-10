package com.blunderprint.api;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.blunderprint.voice.DeepgramTokenClient;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClientException;

class VoiceControllerTest {
    @Test
    void returnsTokenFromGrant() {
        var tokens = mock(DeepgramTokenClient.class);
        when(tokens.grant(30)).thenReturn(new DeepgramTokenClient.Grant("jwt-abc", 30));
        var res = new VoiceController(tokens).token();
        assertEquals(200, res.getStatusCode().value());
        assertEquals(new VoiceController.TokenResponse("jwt-abc", 30), res.getBody());
    }

    @Test
    void missingKeyIs503WithMessage() {
        var tokens = mock(DeepgramTokenClient.class);
        when(tokens.grant(30)).thenThrow(new IllegalStateException("DEEPGRAM_API_KEY is not set"));
        var res = new VoiceController(tokens).token();
        assertEquals(503, res.getStatusCode().value());
        assertEquals(Map.of("error", "DEEPGRAM_API_KEY is not set"), res.getBody());
    }

    @Test
    void upstreamFailureIs503WithoutLeakingDetails() {
        var tokens = mock(DeepgramTokenClient.class);
        when(tokens.grant(30)).thenThrow(new RestClientException("401 Unauthorized: secret detail"));
        var res = new VoiceController(tokens).token();
        assertEquals(503, res.getStatusCode().value());
        assertEquals(Map.of("error", "Deepgram token request failed"), res.getBody());
    }
}
