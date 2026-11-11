package com.blunderprint.engine;

import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Default Analyzer: one lazily started Stockfish process, restarted after a failure. */
@Component
public class StockfishAnalyzer implements EngineService.Analyzer {
    private final String path;
    private StockfishEngine engine;

    public StockfishAnalyzer(@Value("${engine.path}") String path) {
        this.path = path;
    }

    @Override
    public synchronized EngineResult analyze(String fenKey, int depth) throws IOException {
        try {
            if (engine == null) engine = new StockfishEngine(path);
            return engine.analyze(fenKey, depth);
        } catch (IOException | RuntimeException e) {
            if (engine != null) { engine.close(); engine = null; }
            throw e instanceof IOException io ? io : new IOException(e);
        }
    }

    @jakarta.annotation.PreDestroy
    synchronized void shutdown() {
        if (engine != null) { engine.close(); engine = null; }
    }
}
