# Build the web bundle and the server, then ship only what runs.
FROM node:22-alpine AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/database/package.json packages/database/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages packages
COPY apps apps

# The workspace packages are bundled into the server; only published
# dependencies stay external, so no TypeScript source reaches the image.
RUN pnpm --filter @cucumber/database generate \
  && pnpm --filter @cucumber/web build \
  && pnpm --filter @cucumber/server build

# Drop the build-only dependencies, then restore the generated Prisma client.
RUN pnpm install --prod --frozen-lockfile \
  && pnpm --filter @cucumber/database generate

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# pnpm's layout is isolated: the server resolves its dependencies from its own
# node_modules, which symlinks into the root store.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./web
COPY --from=build /app/packages/database/prisma ./prisma

ENV WEB_ROOT=/app/web
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
