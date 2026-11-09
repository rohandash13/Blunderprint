package com.blunderprint.api;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.blunderprint.PostgresIT;
import com.blunderprint.ingest.IngestService;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@AutoConfigureMockMvc
class AnalysisControllerIT extends PostgresIT {
    @Autowired MockMvc mvc;
    @MockBean IngestService ingest;

    @Test
    void postAnalysisReturnsAcceptedWithRunId() throws Exception {
        UUID id = UUID.randomUUID();
        when(ingest.ingest("alice", 50, 12)).thenReturn(new IngestService.IngestResult(id, 5, 200, 380));
        mvc.perform(post("/analysis").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"alice\",\"maxGames\":50,\"depth\":12}"))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.runId").value(id.toString()))
            .andExpect(jsonPath("$.jobsEnqueued").value(380));
    }

    @Test
    void healthIsOk() throws Exception {
        mvc.perform(get("/health")).andExpect(status().isOk()).andExpect(jsonPath("$.ok").value(true));
    }

    @Test
    void unknownRunIs404() throws Exception {
        mvc.perform(get("/analysis/" + UUID.randomUUID())).andExpect(status().isNotFound());
    }

    @Test
    void adminWorkersResizesPool() throws Exception {
        mvc.perform(post("/admin/workers").contentType(MediaType.APPLICATION_JSON).content("{\"count\":0}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.workers").value(0));
    }
}
