package com.blunderprint.api;

import com.blunderprint.analysis.AnalysisService;
import com.blunderprint.ingest.IngestService;
import com.blunderprint.store.JobQueueRepository;
import com.blunderprint.worker.WorkerPool;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class AnalysisController {
    public record AnalyzeRequest(String username, Integer maxGames, Integer depth) {}
    public record WorkersRequest(int count) {}

    private final IngestService ingest;
    private final AnalysisService analysis;
    private final JobQueueRepository queue;
    private final WorkerPool pool;
    private final int defaultDepth;

    public AnalysisController(IngestService ingest, AnalysisService analysis, JobQueueRepository queue,
                              WorkerPool pool, @Value("${engine.depth}") int defaultDepth) {
        this.ingest = ingest;
        this.analysis = analysis;
        this.queue = queue;
        this.pool = pool;
        this.defaultDepth = defaultDepth;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true);
    }

    @PostMapping("/analysis")
    public ResponseEntity<IngestService.IngestResult> start(@RequestBody AnalyzeRequest req) {
        int max = req.maxGames() == null ? 100 : req.maxGames();
        int depth = req.depth() == null ? defaultDepth : req.depth();
        return ResponseEntity.accepted().body(ingest.ingest(req.username(), max, depth));
    }

    @GetMapping("/analysis/{runId}")
    public ResponseEntity<AnalysisService.Progress> progress(@PathVariable UUID runId) {
        try {
            return ResponseEntity.ok(analysis.progress(runId));
        } catch (EmptyResultDataAccessException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping("/analysis/{runId}/reenqueue")
    public Map<String, Integer> reenqueue(@PathVariable UUID runId) {
        return Map.of("jobsEnqueued", queue.enqueueForRun(runId));
    }

    @GetMapping("/admin/workers/stats")
    public Map<String, Long> workerStats() {
        return pool.stats();
    }

    @PostMapping("/admin/workers/stats/reset")
    public Map<String, Boolean> resetWorkerStats() {
        pool.resetStats();
        return Map.of("reset", true);
    }

    @PostMapping("/admin/workers")
    public Map<String, Integer> workers(@RequestBody WorkersRequest req) {
        pool.start(req.count());
        return Map.of("workers", pool.size());
    }
}
