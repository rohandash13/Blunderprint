package com.blunderprint.api;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.analysis.AnalysisService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc
class RescoreOutageIT extends PostgresIT {
    @Autowired MockMvc mvc;
    @MockBean AnalysisService analysis;

    @Test
    void modelOutageReturnsFixedMessage() throws Exception {
        when(analysis.rescoreLatest("alice")).thenThrow(
            new org.springframework.web.client.ResourceAccessException("connect to http://10.1.2.3:9000 refused"));
        mvc.perform(post("/admin/players/alice/rescore"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.error").value("model service unavailable"));
    }
}
