FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci
COPY server ./server
RUN npm run build --workspace server && npm prune --omit=dev --workspace server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
USER node
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
