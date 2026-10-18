# Bun runtime — required for Railway (Railpack does not auto-detect Bun yet).
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

ENV NODE_ENV=production
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["bun", "run", "start"]
