# 使用 Node.js 官方镜像作为基础镜像
FROM node:18-alpine

# 安装必要的系统依赖
RUN apk add --no-cache \
    wget \
    unzip \
    curl \
    bash \
    git

# 设置工作目录
WORKDIR /onebot-manager

# 克隆项目
RUN git clone --branch docker https://github.com/xhzngm/onebot-manager.git

# 安装项目依赖
RUN cd onebot-manager && \
    npm install --production
RUN wget -O Lagrange.zip "https://github.com/xhzngm/onebot-manager/releases/download/publish/publish-net9-linux-x64.zip" && \
    unzip Lagrange.zip && \
    rm Lagrange.zip && \
    chmod +x /app/Lagrange.OneBot
# 暴露应用端口
EXPOSE 12345

# 设置环境变量
ENV NODE_ENV=production
ENV ONEBOT_WORK_DIR=/onebot-manager

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:12345/api/auth-status', (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }).on('error', () => { process.exit(1); });"

# 启动命令
CMD ["node", "."]
