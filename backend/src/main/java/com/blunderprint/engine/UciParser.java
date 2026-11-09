package com.blunderprint.engine;

import java.util.Arrays;
import java.util.Optional;

public final class UciParser {
    private UciParser() {}

    public record Info(int depth, Integer cp, Integer mate, String pv) {}

    public static Optional<Info> parseInfo(String line) {
        if (!line.startsWith("info ")) return Optional.empty();
        String[] t = line.trim().split("\\s+");
        Integer depth = null, cp = null, mate = null;
        String pv = null;
        int multipv = 1;
        for (int i = 1; i < t.length; i++) {
            switch (t[i]) {
                case "depth" -> depth = Integer.parseInt(t[++i]);
                case "multipv" -> multipv = Integer.parseInt(t[++i]);
                case "score" -> {
                    String kind = t[++i];
                    int v = Integer.parseInt(t[++i]);
                    if (kind.equals("cp")) cp = v; else mate = v;
                    if (i + 1 < t.length && (t[i + 1].equals("lowerbound") || t[i + 1].equals("upperbound"))) {
                        return Optional.empty();
                    }
                }
                case "pv" -> {
                    pv = String.join(" ", Arrays.copyOfRange(t, i + 1, t.length));
                    i = t.length;
                }
                default -> { }
            }
        }
        if (multipv != 1 || depth == null || (cp == null && mate == null)) return Optional.empty();
        return Optional.of(new Info(depth, cp, mate, pv));
    }

    /** Mate in n (n>0) = 10000-n; being mated in n (n<=0) = -(10000-|n|). */
    public static int toCentipawns(Integer cp, Integer mate) {
        if (mate == null) return cp;
        int sign = mate > 0 ? 1 : -1;
        return sign * (10000 - Math.abs(mate));
    }
}
