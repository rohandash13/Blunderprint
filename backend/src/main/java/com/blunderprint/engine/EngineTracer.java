package com.blunderprint.engine;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Runs the MultiPV-2 trace search on its own lazily started Stockfish process. */
@Component
public class EngineTracer {
    private static final Logger log = LoggerFactory.getLogger(EngineTracer.class);
    /** Default trace depth; in the app it equals {@code engine.depth}, the depth the drilled best move was found at. */
    static final int TRACE_DEPTH = 12;
    private static final long RETRY_AFTER_MS = 60_000;

    private final String path;
    private final int depth;
    private StockfishEngine engine;
    private long startFailedAtMs = -1;

    @org.springframework.beans.factory.annotation.Autowired
    public EngineTracer(@Value("${engine.path}") String path, @Value("${engine.depth}") int depth) {
        this.path = path;
        this.depth = depth;
    }

    public EngineTracer(String path) {
        this(path, TRACE_DEPTH);
    }

    /** Traces {@code fenKey} against {@code targetUci}, the stored best move being drilled. */
    public synchronized Optional<Trace> trace(String fenKey, String targetUci) {
        try {
            if (engine == null) {
                if (startFailedAtMs >= 0 && System.currentTimeMillis() - startFailedAtMs < RETRY_AFTER_MS) {
                    return Optional.empty();
                }
                try {
                    engine = new StockfishEngine(path);
                    startFailedAtMs = -1;
                } catch (IOException | RuntimeException e) {
                    startFailedAtMs = System.currentTimeMillis();
                    log.warn("Cannot start Stockfish for traces ({}); not retrying for {} s", e.toString(), RETRY_AFTER_MS / 1000);
                    return Optional.empty();
                }
            }
            return Optional.of(engine.trace(fenKey, depth, targetUci));
        } catch (StockfishEngine.NoLegalMoveException e) {
            return Optional.empty();
        } catch (IOException | RuntimeException e) {
            log.warn("Trace search failed for {}: {}", fenKey, e.toString());
            if (engine != null) { engine.close(); engine = null; }
            return Optional.empty();
        }
    }

    @PreDestroy
    synchronized void shutdown() {
        if (engine != null) { engine.close(); engine = null; }
    }
}
