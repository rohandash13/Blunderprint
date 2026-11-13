package com.blunderprint.config;

import jakarta.servlet.http.HttpServletRequest;

/** Resolves the caller's IP behind the platform proxy. */
public final class ClientIp {
    private ClientIp() {}

    /** The last X-Forwarded-For hop (the one the proxy appended; earlier ones are client-supplied), else the socket address. */
    public static String of(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            String[] hops = xff.split(",");
            return hops[hops.length - 1].trim();
        }
        return req.getRemoteAddr();
    }
}
