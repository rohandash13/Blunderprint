package com.blunderprint;

import static org.junit.jupiter.api.Assertions.assertEquals;
import org.junit.jupiter.api.Test;

class SmokeIT extends PostgresIT {
    @Test
    void schemaIsMigrated() {
        assertEquals(0L, jdbc.queryForObject("select count(*) from eval_job", Long.class));
    }
}
