# Not used yet — the project runs locally for now (see README.md). Kept ready
# for whenever this gets deployed, mirroring platform-api-server's pattern of
# one small container per service.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/web/dist ./web/dist
RUN cd server && npm install --omit=dev
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
