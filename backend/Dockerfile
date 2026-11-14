FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /build/target/backend-0.1.0.jar /app/app.jar
COPY entrypoint.sh /app/entrypoint.sh
ENV STOCKFISH_PATH=/usr/games/stockfish \
    ENGINE_MAX_PROCESSES=1 \
    ENGINE_VERSION=sf-debian \
    JAVA_OPTS="-XX:+UseSerialGC"
EXPOSE 8080
ENTRYPOINT ["sh","/app/entrypoint.sh"]
