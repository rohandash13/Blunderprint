package com.blunderprint.api;

import com.blunderprint.analysis.AnalysisGate;
import com.blunderprint.analysis.AnalysisService;
import com.blunderprint.ingest.NoRatedGamesException;
import org.springframework.jdbc.core.JdbcTemplate;
import com.blunderprint.ingest.IngestService;
import com.blunderprint.report.ProfileService;
import com.blunderprint.report.ReportService;
import com.blunderprint.store.JobQueueRepository;
import com.blunderprint.worker.WorkerPool;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class AnalysisController {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(AnalysisController.class);
    public record AnalyzeRequest(String username, Integer maxGames, Integer depth) {}
    public record WorkersRequest(int count) {}

    private final IngestService ingest;
    private final AnalysisService analysis;
    private final JobQueueRepository queue;
    private final WorkerPool pool;
    private final int defaultDepth;
    private final ReportService reports;
    private final ProfileService profiles;
    private final AnalysisGate gate;
    private final JdbcTemplate jdbc;
    private final boolean demo;
    private final int maxGames;

    public AnalysisController(IngestService ingest, AnalysisService analysis, JobQueueRepository queue,
                              WorkerPool pool, @Value("${engine.depth}") int defaultDepth, ReportService reports,
                              ProfileService profiles, AnalysisGate gate, JdbcTemplate jdbc,
                              @Value("${DEMO_MODE:false}") boolean demo, @Value("${analysis.max-games:40}") int maxGames) {
        this.gate = gate;
        this.jdbc = jdbc;
        this.demo = demo;
        this.maxGames = maxGames;
        this.profiles = profiles;
        this.ingest = ingest;
        this.analysis = analysis;
        this.queue = queue;
        this.pool = pool;
        this.defaultDepth = defaultDepth;
        this.reports = reports;
    }

    @GetMapping("/players/{username}/report")
    public ResponseEntity<?> report(@PathVariable String username, @RequestParam(required = false) String levels) {
        List<String> parsed;
        try {
            parsed = com.blunderprint.report.Difficulty.parse(levels);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
        return reports.report(username, parsed).<ResponseEntity<?>>map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/players/{username}/profile")
    public ResponseEntity<?> profile(@PathVariable String username) {
        return profiles.profile(username).<ResponseEntity<?>>map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/players/{username}/positions/{gameId}/{ply}")
    public ResponseEntity<?> position(@PathVariable String username, @PathVariable String gameId,
                                      @PathVariable int ply) {
        return profiles.position(username, gameId, ply).<ResponseEntity<?>>map(ResponseEntity::ok)
            .orElse(ResponseEntity.notFound().build());
    }

    @GetMapping("/players/{username}/mistakes")
    public java.util.List<ReportService.MistakeRow> mistakes(@PathVariable String username) {
        return reports.mistakes(username);
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true);
    }

    public record StartResponse(UUID runId, int games, int moves, int jobsEnqueued, boolean reused, int queuePosition) {}

    private static final java.util.regex.Pattern LICHESS_NAME = java.util.regex.Pattern.compile("[A-Za-z0-9_-]{1,30}");

    private static ResponseEntity<Map<String, String>> noGames(String username) {
        return ResponseEntity.status(404).body(Map.of("error", "No rated games found for " + username));
    }

    @PostMapping("/analysis")
    public ResponseEntity<?> start(@RequestBody AnalyzeRequest req, jakarta.servlet.http.HttpServletRequest http) {
        String username = req.username() == null ? "" : req.username().trim();
        if (username.isEmpty()) return ResponseEntity.badRequest().body(Map.of("error", "username is required"));
        if (!demo) {
            int max = req.maxGames() == null ? 100 : req.maxGames();
            int depth = req.depth() == null ? defaultDepth : req.depth();
            return run(username, max, depth, null);
        }
        String ip = com.blunderprint.config.ClientIp.of(http);
        try {
            gate.tryAttempt(ip);
        } catch (AnalysisGate.CapExceededException e) {
            return ResponseEntity.status(429).body(Map.of("error", e.getMessage()));
        }
        if (!LICHESS_NAME.matcher(username).matches()) {
            return ResponseEntity.status(404).body(Map.of("error", "Not a valid Lichess username"));
        }
        synchronized (gate.lockFor(username)) {
            if (gate.isKnownMissing(username)) return noGames(username);
            var reuse = gate.findReusable(username);
            if (reuse.isPresent()) {
                var r = reuse.get();
                return ResponseEntity.accepted().body(new StartResponse(r.runId(), r.games(), r.moves(), 0, true,
                    r.queuePosition()));
            }
            AnalysisGate.Reservation slot;
            try {
                slot = gate.reserve(ip);
            } catch (AnalysisGate.CapExceededException e) {
                return ResponseEntity.status(429).body(Map.of("error", e.getMessage()));
            }
            return run(username, maxGames, defaultDepth, slot);
        }
    }

    private ResponseEntity<?> run(String username, int max, int depth, AnalysisGate.Reservation slot) {
        try {
            var res = ingest.ingest(username, max, depth);
            return ResponseEntity.accepted().body(new StartResponse(res.runId(), res.games(), res.moves(),
                res.jobsEnqueued(), false, AnalysisGate.queuePosition(jdbc, res.runId())));
        } catch (NoRatedGamesException e) {
            if (slot != null) {
                gate.release(slot);
                gate.markMissing(username);
            }
            return noGames(username);
        } catch (RuntimeException e) {
            if (slot != null) gate.release(slot);
            throw e;
        }
    }

    @GetMapping("/players/{username}/status")
    public AnalysisGate.PlayerStatus playerStatus(@PathVariable String username) {
        return gate.playerStatus(username);
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

    @PostMapping("/admin/players/{username}/rescore")
    public ResponseEntity<Map<String, Object>> rescore(@PathVariable String username) {
        try {
            var n = analysis.rescoreLatest(username);
            if (n.isEmpty()) return ResponseEntity.notFound().build();
            return ResponseEntity.ok(Map.of("rescored", n.getAsInt()));
        } catch (org.springframework.web.client.RestClientException e) {
            log.warn("rescore of {} failed: model service unavailable", username, e);
            return ResponseEntity.status(503).body(Map.of("error", "model service unavailable"));
        }
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
