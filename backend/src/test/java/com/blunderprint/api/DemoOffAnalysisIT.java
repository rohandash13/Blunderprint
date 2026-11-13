package com.blunderprint.api;

import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
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
@org.springframework.test.context.TestPropertySource(properties = "DEMO_MODE=false")
class DemoOffAnalysisIT extends PostgresIT {
    @Autowired MockMvc mvc;
    @MockBean IngestService ingest;

    @Test
    void honoursClientParamsAndAppliesNoRegexOrCaps() throws Exception {
        when(ingest.ingest(anyString(), anyInt(), anyInt()))
            .thenReturn(new IngestService.IngestResult(UUID.randomUUID(), 5, 100, 10));
        for (int i = 0; i < 25; i++) {
            mvc.perform(post("/analysis").header("X-Forwarded-For", "8.8.8.8")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"username\":\"weird.name" + i + "\",\"maxGames\":500,\"depth\":8}"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.reused").value(false));
        }
        verify(ingest, times(25)).ingest(anyString(), eq(500), eq(8));
    }
}
