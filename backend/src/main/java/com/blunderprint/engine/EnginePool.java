package com.blunderprint.engine;

import java.io.IOException;
import java.io.InterruptedIOException;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Semaphore;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Bounds native process memory across workers, live analysis and difficulty traces together. */
@Component
public class EnginePool implements AutoCloseable {
    @FunctionalInterface interface Factory { StockfishEngine create() throws IOException; }
    @FunctionalInterface public interface Operation<T> { T run(StockfishEngine engine) throws IOException; }
    private final Semaphore permits;
    private final ConcurrentLinkedQueue<StockfishEngine> idle = new ConcurrentLinkedQueue<>();
    private final Factory factory;
    private volatile boolean closed;

    @Autowired
    public EnginePool(@Value("${engine.path}") String path, @Value("${engine.max-processes:8}") int max) {
        this(max, () -> new StockfishEngine(path));
    }

    EnginePool(int max, Factory factory) {
        if (max < 1) throw new IllegalArgumentException("engine.max-processes must be positive");
        this.permits = new Semaphore(max, true);
        this.factory = factory;
    }

    public <T> T execute(Operation<T> operation) throws IOException {
        if (closed) throw new IOException("engine pool closed");
        try { permits.acquire(); }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new InterruptedIOException("waiting for engine interrupted");
        }
        StockfishEngine engine = null;
        boolean reusable = false;
        try {
            if (closed) throw new IOException("engine pool closed");
            engine = idle.poll();
            if (engine == null) engine = factory.create();
            T result = operation.run(engine);
            reusable = true;
            return result;
        } catch (StockfishEngine.NoLegalMoveException e) {
            reusable = true; // A terminal position does not mean the native process failed.
            throw e;
        } finally {
            if (engine != null) {
                synchronized (this) {
                    if (reusable && !closed) idle.offer(engine);
                    else engine.close();
                }
            }
            permits.release();
        }
    }

    @Override
    @jakarta.annotation.PreDestroy
    public synchronized void close() {
        closed = true;
        StockfishEngine engine;
        while ((engine = idle.poll()) != null) engine.close();
    }
}
