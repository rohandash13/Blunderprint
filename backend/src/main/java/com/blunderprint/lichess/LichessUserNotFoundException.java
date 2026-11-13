package com.blunderprint.lichess;

/** Lichess answered 404 for the user. */
public class LichessUserNotFoundException extends IllegalStateException {
    public LichessUserNotFoundException(String username) {
        super("Lichess user not found: " + username);
    }
}
