package com.blunderprint.engine;

import com.blunderprint.chess.Fen;
import java.io.*;
import java.util.List;
import java.util.Map;
import java.util.NavigableMap;
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
     * MultiPV-2 search describing {@code targetUci} (the move being drilled). findDepth = smallest depth d such
     * that the multipv-1 first move at every depth >= d equals the target; targetIsBest = the final multipv-1
     * first move is the target. secondCp/secondUci = last multipv-2 score and first move at the final depth.
     */
    public Trace trace(String fenKey, int depth, String targetUci) throws IOException {
        // Fresh search state so earlier searches cannot change findDepth between runs.
        send("ucinewgame");
        send("isready");
        waitFor("readyok");
        send("setoption name MultiPV value 2");
        try {
            send("position fen " + Fen.forEngine(fenKey));
            send("go depth " + depth);
            NavigableMap<Integer, String> firstMoveByDepth = new TreeMap<>();
            Map<Integer, Integer> secondByDepth = new TreeMap<>();
            Map<Integer, String> secondMoveByDepth = new TreeMap<>();
            TreeMap<Integer, Integer> bestByDepth = new TreeMap<>();
            String line;
            while ((line = in.readLine()) != null) {
                if (line.startsWith("bestmove")) {
                    String[] t = line.split("\\s+");
                    if (t.length < 2 || t[1].equals("(none)")) throw new NoLegalMoveException("no legal move in " + fenKey);
                    String best = t[1];
                    if (bestByDepth.isEmpty()) throw new IOException("no score for " + fenKey);
                    int finalDepth = bestByDepth.lastKey();
                    int findDepth = findDepth(firstMoveByDepth, finalDepth, targetUci);
                    boolean targetIsBest = targetUci.equals(firstMoveByDepth.get(finalDepth));
                    // secondCp null = single legal move, or no multipv-2 line was reported at the final depth.
                    return new Trace(best, bestByDepth.get(finalDepth), secondByDepth.get(finalDepth),
                        secondMoveByDepth.get(finalDepth), findDepth, targetIsBest);
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
                    secondMoveByDepth.put(info.depth(), info.pv().split("\\s+")[0]);
                }
            }
            throw new IOException("engine closed unexpectedly");
        } finally {
            try { send("setoption name MultiPV value 1"); } catch (IOException ignored) { }
        }
    }

    /**
     * Smallest depth d such that the multipv-1 first move at every recorded depth >= d equals target.
     * Depths with no recorded line are skipped; a final-depth disagreement yields finalDepth.
     */
    static int findDepth(NavigableMap<Integer, String> firstMoveByDepth, int finalDepth, String target) {
        int found = finalDepth;
        for (int d = finalDepth; d >= 1; d--) {
            String m = firstMoveByDepth.get(d);
            if (m == null) continue;
            if (!m.equals(target)) break;
            found = d;
        }
        return found;
    }

    /** The position is terminal (checkmate or stalemate); the engine itself is fine. */
    public static class NoLegalMoveException extends IOException {
        public NoLegalMoveException(String message) { super(message); }
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
