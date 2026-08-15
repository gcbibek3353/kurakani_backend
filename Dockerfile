# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-alpine AS build
# Pinned to the version that produced pnpm-lock.yaml — corepack otherwise
# fetches whatever is latest, whose defaults can reject a valid lockfile.
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
# minimumReleaseAge=0: the lockfile pins exact versions with integrity hashes,
# and newer pnpm defaults would otherwise refuse any dependency published in
# the last 24h, making builds fail based on the clock rather than the code.
RUN pnpm install --frozen-lockfile --config.minimumReleaseAge=0

COPY . .

# `prisma generate` emits .ts into src/generated/prisma (see schema.prisma), so
# it has to run before `nest build` or the compile fails on missing imports.
RUN pnpm exec prisma generate && pnpm run build

# ---------- runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node_modules is copied whole rather than reinstalled with --prod: the
# container runs `prisma migrate deploy` on startup, and the prisma CLI (plus
# the dotenv that prisma.config.ts imports) lives in devDependencies.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/prisma ./prisma

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3001
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
