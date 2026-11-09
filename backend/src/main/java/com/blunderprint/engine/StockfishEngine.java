package com.blunderprint.engine;

import com.blunderprint.chess.Fen;
import java.io.*;
import java.util.List;

public class StockfishEngine implements AutoCloseable {
    private final Process process;
    private final BufferedReader in;
    private final BufferedWriter out;

    public StockfishEngine(String path) throws IOException {
        process = new ProcessBuilder(List.of(path)).redirectErrorStream(true).start();
        in = new BufferedReader(new InputStreamReader(process.getInputStream()));
        out = new BufferedWriter(new OutputStreamWriter(process.getOutputStream()));
        send("uci");
        waitFor("uciok");
        send("setoption name Threads value 1");
        send("setoption name Hash value 64");
        send("isready");
        waitFor("readyok");
    }

    public EngineResult analyze(String fenKey, int depth) throws IOException {
        send("position fen " + Fen.forEngine(fenKey));
        send("go depth " + depth);
        UciParser.Info last = null;
        String line;
        while ((line = in.readLine()) != null) {
            if (line.startsWith("bestmove")) {
                String[] t = line.split("\\s+");
                String best = t[1].equals("(none)") ? null : t[1];
                if (last == null) throw new IOException("no score for " + fenKey);
                return new EngineResult(best, UciParser.toCentipawns(last.cp(), last.mate()), last.pv());
            }
            var parsed = UciParser.parseInfo(line);
            if (parsed.isPresent()) last = parsed.get();
        }
        throw new IOException("engine closed unexpectedly");
    }

    private void send(String cmd) throws IOException {
        out.write(cmd);
        out.newLine();
        out.flush();
    }

    private void waitFor(String token) throws IOException {
        String line;
        while ((line = in.readLine()) != null) {
            if (line.startsWith(token)) return;
        }
        throw new IOException("engine closed while waiting for " + token);
    }

    @Override
    public void close() {
        try { send("quit"); } catch (IOException ignored) { }
        process.destroy();
    }
}
