package com.blunderprint.config;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

class DatabaseUrlPostProcessorTest {
    @Test
    void parsesNeonUrlWithoutPort() {
        var m = DatabaseUrlPostProcessor.parse("postgresql://neonuser:s3cret@ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require");
        assertEquals("jdbc:postgresql://ep-cool-123.us-east-2.aws.neon.tech/neondb?sslmode=require", m.get("spring.datasource.url"));
        assertEquals("neonuser", m.get("spring.datasource.username"));
        assertEquals("s3cret", m.get("spring.datasource.password"));
    }

    @Test
    void keepsPortAndAcceptsPostgresScheme() {
        var m = DatabaseUrlPostProcessor.parse("postgres://u:p@db.example.com:6543/app");
        assertEquals("jdbc:postgresql://db.example.com:6543/app", m.get("spring.datasource.url"));
        assertEquals("u", m.get("spring.datasource.username"));
    }

    @Test
    void keepsWholeQueryString() {
        var m = DatabaseUrlPostProcessor.parse("postgresql://u:p@h/db?sslmode=require&channel_binding=require");
        assertEquals("jdbc:postgresql://h/db?sslmode=require&channel_binding=require", m.get("spring.datasource.url"));
    }

    @Test
    void decodesPercentEncodedCredentials() {
        var m = DatabaseUrlPostProcessor.parse("postgresql://us%40er:p%40ss%3Aw%2Fo%2Brd@h/db");
        assertEquals("us@er", m.get("spring.datasource.username"));
        assertEquals("p@ss:w/o+rd", m.get("spring.datasource.password"));
    }

    @Test
    void unsetOrBlankIsNoOp() {
        var env = new MockEnvironment();
        new DatabaseUrlPostProcessor().postProcessEnvironment(env, null);
        assertNull(env.getProperty("spring.datasource.url"));
        env.setProperty("DATABASE_URL", "  ");
        new DatabaseUrlPostProcessor().postProcessEnvironment(env, null);
        assertNull(env.getProperty("spring.datasource.url"));
    }

    @Test
    void appliesWhenDatabaseUrlSet() {
        var env = new MockEnvironment().withProperty("DATABASE_URL", "postgresql://u:p@h/db?sslmode=require");
        new DatabaseUrlPostProcessor().postProcessEnvironment(env, null);
        assertEquals("jdbc:postgresql://h/db?sslmode=require", env.getProperty("spring.datasource.url"));
        assertEquals("u", env.getProperty("spring.datasource.username"));
        assertEquals("p", env.getProperty("spring.datasource.password"));
    }

    @Test
    void explicitDbUrlWins() {
        var env = new MockEnvironment()
            .withProperty("DATABASE_URL", "postgresql://u:p@h/db")
            .withProperty("DB_URL", "jdbc:postgresql://other/x");
        new DatabaseUrlPostProcessor().postProcessEnvironment(env, null);
        assertNull(env.getProperty("spring.datasource.url"));
    }

    @Test
    void malformedUrlFailsWithoutLeakingPassword() {
        var e = assertThrows(IllegalArgumentException.class,
            () -> DatabaseUrlPostProcessor.parse("mysql://u:topsecret@h/db"));
        assertFalse(e.getMessage().contains("topsecret"));
    }

    @Test
    void stripsQuotesLeftByDotEnvFiles() {
        var env = new MockEnvironment().withProperty("DATABASE_URL", "\"postgresql://u:p@h/db?sslmode=require\"");
        new DatabaseUrlPostProcessor().postProcessEnvironment(env, null);
        assertEquals("jdbc:postgresql://h/db?sslmode=require", env.getProperty("spring.datasource.url"));
    }

    @Test
    void doesNotOverrideHigherPrecedenceSources() {
        var env = new MockEnvironment().withProperty("DATABASE_URL", "postgresql://u:p@h/db");
        env.getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource(
            "test", java.util.Map.of("spring.datasource.url", "jdbc:postgresql://testcontainer/x")));
        new DatabaseUrlPostProcessor().postProcessEnvironment(env, null);
        assertEquals("jdbc:postgresql://testcontainer/x", env.getProperty("spring.datasource.url"));
    }
}
