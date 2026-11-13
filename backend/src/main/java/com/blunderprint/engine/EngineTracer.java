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
    static final int TRACE_DEPTH = 14;

    private final String path;
    private StockfishEngine engine;

    public EngineTracer(@Value("${engine.path}") String path) {
        this.path = path;
    }

    public synchronized Optional<Trace> trace(String fenKey) {
        try {
            if (engine == null) engine = new StockfishEngine(path);
            return Optional.of(engine.trace(fenKey, TRACE_DEPTH));
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
