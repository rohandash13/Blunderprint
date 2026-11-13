package com.blunderprint.ingest;

/** The user does not exist on Lichess or has no rated games we can analyse. */
public class NoRatedGamesException extends RuntimeException {
    private final String username;

    public NoRatedGamesException(String username) {
        super("No rated games found for " + username);
        this.username = username;
    }

    public String username() { return username; }
}
