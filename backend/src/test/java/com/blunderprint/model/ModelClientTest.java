package com.blunderprint.model;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class ModelClientTest {
    @Test
    void postsMovesAndParsesResponse() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://model");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://model/analyze"))
            .andExpect(jsonPath("$.moves[0].played_uci").value("e2e4"))
            .andExpect(jsonPath("$.moves[0].clock_cs").value(3000))
            .andRespond(withSuccess("[{\"id\":7,\"p_played\":0.31,\"tags\":[\"opening_error\"]}]", MediaType.APPLICATION_JSON));
        var out = new ModelClient(b.build()).analyze(
            List.of(new ModelClient.MoveIn(7, "fen", 1500, "e2e4", "d2d4", 120, 3000)));
        assertEquals(1, out.size());
        assertEquals(7, out.get(0).id());
        assertEquals(0.31, out.get(0).pPlayed(), 1e-9);
        assertEquals(List.of("opening_error"), out.get(0).tags());
        server.verify();
    }
}
