FROM node:22-alpine AS build
# Prisma needs OpenSSL to choose the right database engine.
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
RUN DATABASE_URL=postgresql://build:build@localhost/build npx prisma generate && npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
# prisma is a runtime dependency because the container applies migrations when it starts.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
# Uploaded pictures live on a volume mounted here.
RUN mkdir -p /data/uploads && chown -R node:node /data /app
USER node
EXPOSE 8090
CMD ["node", "dist/server.js"]
