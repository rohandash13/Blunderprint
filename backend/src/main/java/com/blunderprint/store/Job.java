package com.blunderprint.store;

public record Job(long id, String fenKey, String engine, int depth, int attempts) {}
