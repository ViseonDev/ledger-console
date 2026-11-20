FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY console/package.json ./console/
COPY fixture/package.json ./fixture/
RUN npm ci --workspace=console --include-workspace-root

COPY console ./console

ARG VITE_LEDGER_URL=http://localhost:8022
ENV VITE_LEDGER_URL=${VITE_LEDGER_URL}
RUN npm run build --workspace=console

FROM nginx:1.29-alpine
COPY console/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/console/dist /usr/share/nginx/html
