package com.blunderprint.engine;

import com.blunderprint.chess.Fen;
import java.io.*;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

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

    /**
     * MultiPV-2 search. findDepth = smallest depth d such that the multipv-1 first move at every
     * depth >= d equals the final bestmove. secondCp = last multipv-2 score at the final depth.
     */
    public Trace trace(String fenKey, int depth) throws IOException {
        send("setoption name MultiPV value 2");
        try {
            send("position fen " + Fen.forEngine(fenKey));
            send("go depth " + depth);
            Map<Integer, String> firstMoveByDepth = new TreeMap<>();
            Map<Integer, Integer> secondByDepth = new TreeMap<>();
            TreeMap<Integer, Integer> bestByDepth = new TreeMap<>();
            String line;
            while ((line = in.readLine()) != null) {
                if (line.startsWith("bestmove")) {
                    String[] t = line.split("\\s+");
                    if (t.length < 2 || t[1].equals("(none)")) throw new IOException("no legal move in " + fenKey);
                    String best = t[1];
                    if (bestByDepth.isEmpty()) throw new IOException("no score for " + fenKey);
                    int finalDepth = bestByDepth.lastKey();
                    int findDepth = finalDepth;
                    for (int d = finalDepth; d >= 1; d--) {
                        String m = firstMoveByDepth.get(d);
                        if (m == null) continue;
                        if (!m.equals(best)) break;
                        findDepth = d;
                    }
                    return new Trace(best, bestByDepth.get(finalDepth), secondByDepth.get(finalDepth), findDepth);
                }
                var p = UciParser.parseInfoAny(line);
                if (p.isEmpty() || p.get().pv() == null || p.get().pv().isEmpty()) continue;
                var info = p.get();
                int cp = UciParser.toCentipawns(info.cp(), info.mate());
                if (info.multipv() == 1) {
                    bestByDepth.put(info.depth(), cp);
                    firstMoveByDepth.put(info.depth(), info.pv().split("\\s+")[0]);
                } else if (info.multipv() == 2) {
                    secondByDepth.put(info.depth(), cp);
                }
            }
            throw new IOException("engine closed unexpectedly");
        } finally {
            try { send("setoption name MultiPV value 1"); } catch (IOException ignored) { }
        }
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
