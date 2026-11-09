package com.blunderprint.lichess;

import java.time.Instant;
import java.util.List;

public record LichessGame(String id, String white, String black, Integer whiteRating, Integer blackRating,
                          String perf, String result, Instant playedAt, String sanMoves, List<Integer> clocksCs) {}
