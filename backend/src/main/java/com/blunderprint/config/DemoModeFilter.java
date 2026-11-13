package com.blunderprint.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** In public-demo mode, blocks /admin/** and analysis writes (POST /analysis, /analysis/**). */
@Component
public class DemoModeFilter extends OncePerRequestFilter {
    private final boolean demo;

    public DemoModeFilter(@Value("${DEMO_MODE:false}") boolean demo) {
        this.demo = demo;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (demo && blocked(req)) {
            res.setStatus(403);
            res.setContentType("application/json");
            res.setCharacterEncoding(StandardCharsets.UTF_8.name());
            res.getWriter().write("{\"error\":\"disabled in the public demo\"}");
            return;
        }
        chain.doFilter(req, res);
    }

    private static boolean blocked(HttpServletRequest req) {
        String path = req.getRequestURI().replaceAll("/{2,}", "/");
        int semi = path.indexOf(';');
        if (semi >= 0) path = path.substring(0, semi);
        if (path.equals("/admin") || path.startsWith("/admin/")) return true;
        boolean analysis = path.equals("/analysis") || path.startsWith("/analysis/");
        String m = req.getMethod();
        boolean readOnly = m.equals("GET") || m.equals("HEAD") || m.equals("OPTIONS");
        return analysis && !readOnly;
    }
}
