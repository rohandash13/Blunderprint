package com.blunderprint.engine;

import java.io.IOException;
import org.springframework.stereotype.Component;

/** Live analysis shares the same bounded native process budget as background work. */
@Component
public class StockfishAnalyzer implements EngineService.Analyzer {
    private final EnginePool pool;

    public StockfishAnalyzer(EnginePool pool) {
        this.pool = pool;
    }

    @Override
    public EngineResult analyze(String fenKey, int depth) throws IOException {
        return pool.execute(engine -> engine.analyze(fenKey, depth));
    }
}
