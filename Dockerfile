FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS web-build
COPY app ./app
COPY next.config.mjs postcss.config.mjs tsconfig.json ./
ARG MEDICORE_API_URL=http://api:4000
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && chown -R node:node /app/.next

FROM web-build AS web
USER node
EXPOSE 3000
CMD ["node","node_modules/next/dist/bin/next","start","--hostname","0.0.0.0"]

FROM deps AS api
COPY api ./api
COPY docs/openapi.json ./docs/openapi.json
USER node
EXPOSE 4000
CMD ["node","api/server.mjs"]
