package com.blunderprint.worker;

import com.blunderprint.engine.EngineResult;
import com.blunderprint.engine.EnginePool;
import com.blunderprint.store.Job;
import com.blunderprint.store.JobQueueRepository;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.LongAdder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class WorkerPool {
    private static final Logger log = LoggerFactory.getLogger(WorkerPool.class);

    private final JobQueueRepository queue;
    private final EnginePool engines;
    private final int defaultCount;
    private final boolean autostart;
    private final int reaperTimeoutSeconds;
    private final int maxAttempts;
    private final int batchSize;
    private final List<Thread> threads = new ArrayList<>();
    private volatile boolean running = false;

    // Time accounting, to separate database overhead from engine time.
    private final LongAdder claimNs = new LongAdder();
    private final LongAdder engineNs = new LongAdder();
    private final LongAdder completeNs = new LongAdder();
    private final LongAdder jobsDone = new LongAdder();

    public Map<String, Long> stats() {
        return Map.of("jobs", jobsDone.sum(), "claimNs", claimNs.sum(),
            "engineNs", engineNs.sum(), "completeNs", completeNs.sum());
    }

    public void resetStats() {
        claimNs.reset();
        engineNs.reset();
        completeNs.reset();
        jobsDone.reset();
    }

    public WorkerPool(JobQueueRepository queue, EnginePool engines,
                      @Value("${workers.count}") int defaultCount,
                      @Value("${workers.autostart}") boolean autostart,
                      @Value("${workers.reaper-timeout-seconds}") int reaperTimeoutSeconds,
                      @Value("${workers.max-attempts}") int maxAttempts,
                      @Value("${workers.batch-size:4}") int batchSize) {
        this.batchSize = batchSize;
        this.queue = queue;
        this.engines = engines;
        this.defaultCount = defaultCount;
        this.autostart = autostart;
        this.reaperTimeoutSeconds = reaperTimeoutSeconds;
        this.maxAttempts = maxAttempts;
    }

    @PostConstruct
    void init() {
        if (autostart) start(defaultCount);
    }

    public synchronized void start(int n) {
        stop();
        running = true;
        for (int i = 0; i < n; i++) {
            String id = "w" + i;
            threads.add(Thread.ofPlatform().daemon(true).name("sf-" + id).start(() -> loop(id)));
        }
        log.info("started {} workers", n);
    }

    @PreDestroy
    public synchronized void stop() {
        running = false;
        for (Thread t : threads) t.interrupt();
        for (Thread t : threads) {
            try { t.join(10_000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        threads.clear();
    }

    public synchronized int size() {
        return threads.size();
    }

    @Scheduled(fixedDelay = 30_000)
    void reap() {
        int n = queue.reapStale(reaperTimeoutSeconds, maxAttempts);
        if (n > 0) log.warn("reaped {} stale jobs", n);
    }

    private void loop(String workerId) {
        try {
            while (running) {
                long c0 = System.nanoTime();
                List<Job> jobs = queue.claim(workerId, batchSize);
                if (jobs.isEmpty()) {
                    Thread.sleep(200);
                    continue;
                }
                claimNs.add(System.nanoTime() - c0);
                List<JobQueueRepository.Completed> done = new ArrayList<>();
                for (Job job : jobs) {
                    try {
                        long e0 = System.nanoTime();
                        EngineResult r = engines.execute(engine -> engine.analyze(job.fenKey(), job.depth()));
                        engineNs.add(System.nanoTime() - e0);
                        done.add(new JobQueueRepository.Completed(job, r));
                    } catch (Exception e) {
                        log.warn("{} failed job {}: {}", workerId, job.id(), e.toString());
                        queue.fail(job.id(), String.valueOf(e), maxAttempts);
                    }
                }
                long w0 = System.nanoTime();
                queue.completeBatch(done);
                completeNs.add(System.nanoTime() - w0);
                jobsDone.add(done.size());
            }
        } catch (InterruptedException ignored) {
            // stop requested
        }
    }
}
