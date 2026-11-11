package com.blunderprint.api;

import com.blunderprint.engine.EngineService;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class EngineController {
    public record AnalyzeRequest(String fen) {}

    private final EngineService engine;

    public EngineController(EngineService engine) {
        this.engine = engine;
    }

    @PostMapping("/engine/analyze")
    public ResponseEntity<?> analyze(@RequestBody AnalyzeRequest req) {
        try {
            return ResponseEntity.ok(engine.analyze(req.fen()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid FEN"));
        } catch (IOException e) {
            return ResponseEntity.status(503).body(Map.of("error", "engine unavailable"));
        }
    }
}
