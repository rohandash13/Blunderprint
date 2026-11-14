package com.blunderprint.engine;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class EnginePoolTest {
    @Test
    void terminalPositionKeepsTheHealthyEngineForTheNextRequest() throws Exception {
        var engine = mock(StockfishEngine.class);
        var created = new AtomicInteger();
        try (var pool = new EnginePool(1, () -> { created.incrementAndGet(); return engine; })) {
            assertThrows(StockfishEngine.NoLegalMoveException.class,
                () -> pool.execute(e -> { throw new StockfishEngine.NoLegalMoveException("mate"); }));
            assertSame(engine, pool.execute(e -> e));
            assertEquals(1, created.get());
            verify(engine, never()).close();
        }
        verify(engine).close();
    }

    @Test
    void concurrentRolesReuseOneProcessInsteadOfStartingAnother() throws Exception {
        var engine = mock(StockfishEngine.class);
        var created = new AtomicInteger();
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var secondStarted = new CountDownLatch(1);
        try (var pool = new EnginePool(1, () -> { created.incrementAndGet(); return engine; });
             var threads = Executors.newFixedThreadPool(2)) {
            var first = threads.submit(() -> pool.execute(e -> {
                entered.countDown();
                try { release.await(); } catch (InterruptedException ex) { throw new IOException(ex); }
                return e;
            }));
            assertTrue(entered.await(5, TimeUnit.SECONDS));
            var second = threads.submit(() -> { secondStarted.countDown(); return pool.execute(e -> e); });
            assertTrue(secondStarted.await(5, TimeUnit.SECONDS));
            try {
                assertThrows(TimeoutException.class, () -> second.get(100, TimeUnit.MILLISECONDS));
                assertEquals(1, created.get());
            } finally { release.countDown(); }
            assertSame(engine, first.get(5, TimeUnit.SECONDS));
            assertSame(engine, second.get(5, TimeUnit.SECONDS));
            assertEquals(1, created.get());
        }
        verify(engine).close();
    }

    @Test
    void brokenProcessIsClosedAndReplacedBeforeTheNextOperation() throws Exception {
        var broken = mock(StockfishEngine.class);
        var replacement = mock(StockfishEngine.class);
        var created = new AtomicInteger();
        try (var pool = new EnginePool(1, () -> created.getAndIncrement() == 0 ? broken : replacement)) {
            assertThrows(IOException.class, () -> pool.execute(e -> { throw new IOException("engine exited"); }));
            verify(broken).close();
            assertSame(replacement, pool.execute(e -> e));
            assertEquals(2, created.get());
        }
        verify(replacement).close();
    }

    @Test
    void closingRejectsFurtherWorkWithoutStartingAnEngine() throws Exception {
        var created = new AtomicInteger();
        var pool = new EnginePool(1, () -> { created.incrementAndGet(); return mock(StockfishEngine.class); });
        pool.close();
        assertThrows(IOException.class, () -> pool.execute(e -> e));
        assertEquals(0, created.get());
    }
}
