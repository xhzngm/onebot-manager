# 使用Node.js 18的Alpine镜像作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 安装必要的系统依赖
RUN apk add --no-cache \
    curl \
    wget \
    bash \
    tzdata \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
    && echo "Asia/Shanghai" > /etc/timezone

# 复制package文件
COPY package*.json ./

# 安装npm依赖
RUN npm install --production

# 复制项目文件
COPY . .

# 创建必要的目录
RUN mkdir -p onebot logs

# 设置文件权限
RUN chmod +x server.js

# 设置环境变量
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:12345/api/auth-status || exit 1

# 数据卷
VOLUME ["/app/onebot", "/app/logs", "/app/config.json"]

# 启动命令
CMD ["node", "server.js"]
