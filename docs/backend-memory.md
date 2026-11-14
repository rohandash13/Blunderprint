# Backend memory recovery

The live public analysis test triggered Render's backend memory limit and automatic restarts, making status and voice-token requests return 502. This was the Java/Stockfish service, not the separate CNN model service.

Workers, live analysis and difficulty tracing previously retained independent Stockfish processes. The native memory of those processes is substantially larger than their configured hash tables. Reducing the Java heap and hash tables alone still left the three-process service dependent on swap in the local reproduction.

The container now uses a fair shared engine pool, limited to one process by `ENGINE_MAX_PROCESSES=1`. Each worker job, live search and trace leases the same engine; operations cannot interleave UCI commands. Failed engines are closed before replacement, terminal positions reuse healthy engines, and shutdown closes idle engines. Local development defaults to a pool of eight so existing multiworker experiments remain possible.

The entrypoint applies a 160 MiB heap ceiling after legacy `JAVA_OPTS`, so Render's previously saved `-Xmx320m` cannot silently defeat the budget. Metaspace, code cache and direct buffers also have explicit ceilings. Each engine uses a 16 MiB hash table. `JAVA_MAX_HEAP` remains an explicit override for larger instances.

## Validation

Regression tests were added before the pool implementation. They cover concurrent roles waiting for one process, replacement after failure, shutdown rejecting new work and terminal-position reuse. The full backend suite includes real Stockfish and Testcontainers checks.

`scripts/check_backend_memory.py` launches the image with the legacy heap override and reads actual JVM flags. It failed against the old image and passes against the new entrypoint.

`scripts/stress_backend_memory.py` exercises a queued worker search, a live engine request and a complete sample-player rescore against a disposable local database clone. The final container uses **512 MiB with swap disabled**. Raw results are in `results/backend_memory_pool.json`: one Stockfish process, zero swap, zero OOM events, successful live analysis and all 3,874 moves rescored. The recorded peak is approximately 407 MiB. Earlier baseline/caps-only records are retained as diagnostic attempts; they allowed Docker's default swap and are not evidence of fitting a swap-free Render instance.

Example setup (use a disposable database populated from local development data, with a pending valid eval job so the worker role starts):

```bash
docker build -t blunderprint-api-memory -f backend/Dockerfile backend
python scripts/check_backend_memory.py --image blunderprint-api-memory
docker run -d --name blunderprint-api-memory-pool --memory 512m --memory-swap 512m -p 127.0.0.1:18083:8080 -e DB_URL=jdbc:postgresql://host.docker.internal:5432/blunderprint_memory_pool -e DB_USER=chess -e DB_PASSWORD=chess -e WORKERS_COUNT=1 -e MODEL_URL=http://host.docker.internal:18000 -e ENGINE_VERSION=sf-memory-pool -e JAVA_OPTS=-Xmx320m blunderprint-api-memory
python scripts/stress_backend_memory.py --container blunderprint-api-memory-pool --base-url http://127.0.0.1:18083 --out results/backend_memory_pool.json
```

The stress script rejects non-loopback backends. It mutates only the disposable database through the local admin endpoint. It also rejects a run with swap enabled, more than one resident Stockfish process, an OOM, or failed operations.
