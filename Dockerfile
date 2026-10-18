# paper-rag-fronted（Vue3 + Vite）
# 多阶段：Node 构建 dist → Nginx 托管 + 反代
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# 国内 npm 镜像（registry.npmjs.org 在国内慢/不稳定）
RUN npm config set registry https://registry.npmmirror.com \
    && npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
