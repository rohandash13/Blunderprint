package com.blunderprint.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.MutablePropertySources;
import org.springframework.core.env.PropertySource;

/**
 * Translates a Neon/Heroku-style {@code DATABASE_URL}
 * ({@code postgresql://user:pass@host[:port]/db?sslmode=require}) into Spring datasource properties.
 * An explicit {@code DB_URL} wins. Never logs or echoes the credentials.
 */
public class DatabaseUrlPostProcessor implements EnvironmentPostProcessor, Ordered {
    static final String SOURCE_NAME = "databaseUrlDatasource";

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment env, SpringApplication app) {
        String url = env.getProperty("DATABASE_URL");
        if (url == null || url.isBlank() || env.getProperty("DB_URL") != null) return;
        var source = new MapPropertySource(SOURCE_NAME, parse(unquote(url.trim())));
        // Beat application.yml / .env defaults, but stay below command line, system properties and test properties.
        MutablePropertySources sources = env.getPropertySources();
        String firstConfig = null;
        for (PropertySource<?> ps : sources) {
            if (ps.getName().startsWith("Config resource")) { firstConfig = ps.getName(); break; }
        }
        if (firstConfig != null) sources.addBefore(firstConfig, source);
        else sources.addLast(source);
    }

    /** A value copied from a .env file may keep its surrounding quotes. */
    static String unquote(String v) {
        if (v.length() >= 2 && (v.charAt(0) == '"' || v.charAt(0) == '\'') && v.charAt(v.length() - 1) == v.charAt(0)) {
            return v.substring(1, v.length() - 1);
        }
        return v;
    }

    static Map<String, Object> parse(String databaseUrl) {
        URI uri;
        try {
            uri = new URI(databaseUrl);
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("DATABASE_URL is not a valid URI");
        }
        String scheme = uri.getScheme();
        if (!"postgresql".equals(scheme) && !"postgres".equals(scheme)) {
            throw new IllegalArgumentException("DATABASE_URL must start with postgresql:// or postgres://");
        }
        if (uri.getHost() == null) {
            throw new IllegalArgumentException("DATABASE_URL has no host");
        }
        StringBuilder jdbc = new StringBuilder("jdbc:postgresql://").append(uri.getHost());
        if (uri.getPort() != -1) jdbc.append(':').append(uri.getPort());
        if (uri.getRawPath() != null) jdbc.append(uri.getRawPath());
        if (uri.getRawQuery() != null) jdbc.append('?').append(uri.getRawQuery());

        Map<String, Object> props = new LinkedHashMap<>();
        props.put("spring.datasource.url", jdbc.toString());
        String userInfo = uri.getUserInfo(); // percent-decoded
        if (userInfo != null) {
            int colon = userInfo.indexOf(':');
            props.put("spring.datasource.username", colon < 0 ? userInfo : userInfo.substring(0, colon));
            if (colon >= 0) props.put("spring.datasource.password", userInfo.substring(colon + 1));
        }
        return props;
    }

    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE; // after config data (.env) has been loaded
    }
}
