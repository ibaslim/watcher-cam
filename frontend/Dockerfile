FROM node:20.19-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ARG VITE_API_URL
ARG VITE_MEDIAMTX_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_MEDIAMTX_URL=${VITE_MEDIAMTX_URL}
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
