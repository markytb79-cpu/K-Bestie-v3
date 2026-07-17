FROM node:24-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist

# Cloud Run이 PORT 환경변수를 주입한다 — server.ts가 이걸 그대로 읽음.
EXPOSE 8080
CMD ["node", "dist/server.js"]
