#!/bin/sh
set -eu

# Render may retain JAVA_OPTS=-Xmx320m from the original service configuration.
# Put explicit caps last so native Stockfish processes have space in the same cgroup.
exec java ${JAVA_OPTS:-'-XX:+UseSerialGC'} \
  -Xmx"${JAVA_MAX_HEAP:-160m}" \
  -XX:MaxMetaspaceSize=96m \
  -XX:ReservedCodeCacheSize=32m \
  -XX:MaxDirectMemorySize=16m \
  -Xss512k \
  -jar /app/app.jar "$@"
