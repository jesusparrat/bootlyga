FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/mock-engine/package.json packages/mock-engine/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build

FROM node:22-alpine AS gateway
WORKDIR /app
ENV NODE_ENV=production
ENV WEB_ROOT=/app/public
COPY --from=build /src/packages/gateway/dist/server.js /app/server.js
COPY --from=build /src/apps/web/dist /app/public
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "server.js"]

FROM node:22-alpine AS mock
WORKDIR /app
COPY --from=build /src/packages/mock-engine/dist/server.js /app/server.js
COPY packages/mock-engine/fixtures /app/fixtures
ENV FIXTURES_DIR=/app/fixtures
ENV PORT=6878
ENV HOST=0.0.0.0
USER node
EXPOSE 6878
CMD ["node", "server.js"]
