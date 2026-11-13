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

    @Test
    void parsesPBestAndNull() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://model");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://model/analyze"))
            .andRespond(withSuccess("[{\"id\":1,\"p_played\":0.2,\"p_best\":0.6,\"tags\":[]},{\"id\":2,\"p_played\":0.1,\"p_best\":null,\"tags\":[]}]",
                MediaType.APPLICATION_JSON));
        var out = new ModelClient(b.build()).analyze(List.of(
            new ModelClient.MoveIn(1, "fen", 1500, "e2e4", "d2d4", 0, null),
            new ModelClient.MoveIn(2, "fen", 1500, "e2e4", null, 0, null)));
        assertEquals(0.6, out.get(0).pBest(), 1e-9);
        assertNull(out.get(1).pBest());
    }

    @Test
    void parsesBestFlags() {
        RestClient.Builder b = RestClient.builder().baseUrl("http://model");
        MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
        server.expect(requestTo("http://model/analyze"))
            .andRespond(withSuccess("[{\"id\":1,\"p_played\":0.2,\"tags\":[],\"best_quiet\":true,\"best_free_material\":false},{\"id\":2,\"p_played\":0.1,\"tags\":[],\"best_quiet\":null,\"best_free_material\":null}]",
                MediaType.APPLICATION_JSON));
        var out = new ModelClient(b.build()).analyze(List.of(
            new ModelClient.MoveIn(1, "fen", 1500, "e2e4", "d2d4", 0, null),
            new ModelClient.MoveIn(2, "fen", 1500, "e2e4", null, 0, null)));
        assertEquals(Boolean.TRUE, out.get(0).bestQuiet());
        assertEquals(Boolean.FALSE, out.get(0).bestFreeMaterial());
        assertNull(out.get(1).bestQuiet());
        assertNull(out.get(1).bestFreeMaterial());
    }
}
