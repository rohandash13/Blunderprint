package com.blunderprint.voice;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

class DeepgramTokenClientTest {
    @Test
    void postsGrantWithTokenHeaderAndParsesResponse() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://dg");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://dg/v1/auth/grant"))
            .andExpect(method(HttpMethod.POST))
            .andExpect(header("Authorization", "Token test-key"))
            .andExpect(jsonPath("$.ttl_seconds").value(30))
            .andRespond(withSuccess("{\"access_token\":\"jwt-abc\",\"expires_in\":30}", MediaType.APPLICATION_JSON));
        var g = new DeepgramTokenClient(b.build(), "test-key").grant(30);
        assertEquals("jwt-abc", g.accessToken());
        assertEquals(30, g.expiresIn());
        server.verify();
    }

    @Test
    void blankKeyIsReportedBeforeAnyRequest() {
        var client = new DeepgramTokenClient(RestClient.builder().baseUrl("http://dg").build(), " ");
        assertFalse(client.configured());
        assertThrows(IllegalStateException.class, () -> client.grant(30));
    }

    @Test
    void upstreamErrorPropagates() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://dg");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://dg/v1/auth/grant")).andRespond(withUnauthorizedRequest());
        assertThrows(RestClientException.class, () -> new DeepgramTokenClient(b.build(), "bad").grant(30));
    }

    @Test
    void responseWithoutTokenIsAnError() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://dg");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://dg/v1/auth/grant")).andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        assertThrows(RestClientException.class, () -> new DeepgramTokenClient(b.build(), "k").grant(30));
    }
}
