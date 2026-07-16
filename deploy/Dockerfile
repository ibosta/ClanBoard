# Stage 1: build the React SPA (project root)
FROM node:20-alpine AS webbuild
WORKDIR /web
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html components.json ./
COPY src ./src
RUN npm run build

# Stage 2: install Express server deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY deploy/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Stage 3: final image
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY deploy/ ./
# Ship the built SPA next to the Express server
COPY --from=webbuild /web/dist ./frontend
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3000/api/setup/status || exit 1
CMD ["node", "server.js"]
