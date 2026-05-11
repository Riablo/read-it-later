FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY public ./public

ENV HOST=0.0.0.0
ENV PORT=3042
ENV READLATER_DATA=/app/data/readlater.json

EXPOSE 3042

CMD ["bun", "src/server.ts"]
