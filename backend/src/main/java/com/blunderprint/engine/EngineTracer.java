package com.blunderprint.engine;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Runs MultiPV-2 traces within the same bounded process pool as the other engine roles. */
@Component
public class EngineTracer {
    private static final Logger log = LoggerFactory.getLogger(EngineTracer.class);
    /** Default trace depth; in the app it equals {@code engine.depth}, the depth the drilled best move was found at. */
    static final int TRACE_DEPTH = 12;
    private final EnginePool pool;
    private final boolean ownsPool;
    private final int depth;

    @org.springframework.beans.factory.annotation.Autowired
    public EngineTracer(EnginePool pool, @Value("${engine.depth}") int depth) {
        this.pool = pool;
        this.ownsPool = false;
        this.depth = depth;
    }

    public EngineTracer(String path, int depth) {
        this.pool = new EnginePool(path, 1);
        this.ownsPool = true;
        this.depth = depth;
    }

    public EngineTracer(String path) {
        this(path, TRACE_DEPTH);
    }

    /** Traces {@code fenKey} against {@code targetUci}, the stored best move being drilled. */
    public synchronized Optional<Trace> trace(String fenKey, String targetUci) {
        try {
            return Optional.of(pool.execute(engine -> engine.trace(fenKey, depth, targetUci)));
        } catch (StockfishEngine.NoLegalMoveException e) {
            return Optional.empty();
        } catch (IOException | RuntimeException e) {
            log.warn("Trace search failed for {}: {}", fenKey, e.toString());
            return Optional.empty();
        }
    }

    @PreDestroy
    synchronized void shutdown() {
        if (ownsPool) pool.close();
    }
}
