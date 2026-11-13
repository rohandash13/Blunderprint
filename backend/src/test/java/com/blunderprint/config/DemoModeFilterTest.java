package com.blunderprint.config;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class DemoModeFilterTest {
    private record Result(int status, String body, boolean passed) {}

    private Result run(boolean demo, String method, String uri) throws Exception {
        var req = new MockHttpServletRequest(method, uri);
        var res = new MockHttpServletResponse();
        var chain = new MockFilterChain();
        new DemoModeFilter(demo).doFilter(req, res, chain);
        return new Result(res.getStatus(), res.getContentAsString(), chain.getRequest() != null);
    }

    @Test
    void blocksAdminAndAnalysisWritesInDemo() throws Exception {
        for (var c : new String[][] {
            {"GET", "/admin/workers/stats"}, {"POST", "/admin/workers"}, {"POST", "/admin/players/x/rescore"},
            {"POST", "/analysis/5/reenqueue"}, {"POST", "//analysis/5/reenqueue"}, {"POST", "/analysis/5/other"},
            {"POST", "/admin"}}) {
            var r = run(true, c[0], c[1]);
            assertEquals(403, r.status(), c[0] + " " + c[1]);
            assertFalse(r.passed());
            assertEquals("{\"error\":\"disabled in the public demo\"}", r.body());
        }
    }

    @Test
    void permitsReadEndpointsInDemo() throws Exception {
        for (var c : new String[][] {
            {"GET", "/players/x/report"}, {"GET", "/players/x/mistakes"}, {"GET", "/analysis/5"},
            {"POST", "/engine/analyze"}, {"POST", "/analysis"}, {"POST", "/analysis/"}, {"POST", "//analysis"}, {"GET", "/health"}, {"GET", "/voice/token"}, {"GET", "/administrator"}}) {
            var r = run(true, c[0], c[1]);
            assertTrue(r.passed(), c[0] + " " + c[1]);
            assertEquals(200, r.status());
        }
    }

    @Test
    void permitsEverythingWhenDemoOff() throws Exception {
        assertTrue(run(false, "POST", "/analysis").passed());
        assertTrue(run(false, "GET", "/admin/workers/stats").passed());
    }
}
