# 警告！！！本项目所有代码全部由AI编写

# OneBot Manager 机器人管理器

<div align="center">

![OneBot Manager](https://img.shields.io/badge/OneBot-Manager-blue?style=for-the-badge&logo=robot)
![Version](https://img.shields.io/badge/version-2.0.0-green?style=for-the-badge)
![Node.js](https://img.shields.io/badge/Node.js-18+-brightgreen?style=for-the-badge&logo=node.js)
![License](https://img.shields.io/badge/license-MIT-orange?style=for-the-badge)

**现代化的 OneBot 机器人管理 WebUI**

[功能特性](#-功能特性) •
[快速开始](#-快速开始) •
[API文档](docs/API.md) •
[开发指南](#%EF%B8%8F-开发指南)

</div>

## 📖 项目简介

OneBot Manager 是一个基于 Web 的 QQ 机器人管理平台，专为 Lagrange.OneBot 设计。它提供了直观的 Web 界面来管理多个机器人实例，包括启动、停止、配置、日志查看等功能，让机器人管理变得简单高效。

## ✨ 功能特性

### 🤖 机器人管理
- **多机器人支持** - 同时管理多个机器人实例
- **一键操作** - 启动、停止、重启机器人
- **状态监控** - 实时显示机器人运行状态和在线状态
- **自动重启** - 支持故障自动重启和定时重启
- **进程管理** - 智能进程监控和清理

### 📱 二维码登录
- **自动检测** - 自动发现和显示登录二维码
- **扫码登录** - 支持 QQ/TIM 扫码登录
- **登录状态** - 实时显示登录和在线状态
- **自动清理** - 登录成功后自动清理二维码文件

### ⚙️ 配置管理
- **简化配置** - 提供用户友好的配置界面
- **高级配置** - 支持完整的 OneBot 配置选项
- **原始配置** - 直接编辑 JSON 配置文件
- **配置验证** - 自动验证配置格式和内容

### 📊 日志系统
- **实时日志** - 实时显示机器人运行日志
- **历史日志** - 保存和查看历史日志记录
- **日志过滤** - 智能过滤无关日志信息
- **日志管理** - 支持清空和下载日志

### 🌐 Web 界面
- **响应式设计** - 支持桌面和移动设备
- **现代化UI** - 基于 Vue.js 3 的现代化界面
- **实时更新** - 基于 WebSocket 的实时状态更新
- **用户认证** - 基于 API Key 的安全认证

### 🔧 系统管理
- **自动安装** - 自动下载和安装 Lagrange.OneBot
- **系统设置** - 完整的系统配置管理
- **定时任务** - 支持定时重启和维护任务
- **资源监控** - 系统资源使用情况监控

## 🚀 快速开始

### 环境要求

- **Node.js** 18.0+ 
- **npm** 或 **yarn**
- **操作系统**: Windows 10+, Linux, macOS

### 安装部署

#### 1. 下载项目
```bash
git clone https://github.com/xhzngm/onebot-manager.git
cd onebot-manager
```

#### 2. 安装依赖
```bash
npm install
# 或
yarn install
```

#### 3. 首次运行

由于上游代码[PR](https://github.com/LagrangeDev/Lagrange.Core/pull/863)修改未完成合并，导致无法正常启动请前往[releases](https://github.com/xhzngm/onebot-manager/releases)下载编译好的Lagrange.OneBot主程序 publish.xxxx

```bash
noed .
```

#### 4. 访问管理界面
打开浏览器访问：`http://localhost:12345`

首次启动会进入配置向导，按照提示完成初始配置。

### Docker 部署

```bash
# 拉取镜像
docker pull maimai977/onebot-manager

# 运行容器
docker run -d \
  --name onebot-manager \
  --network host \          # 使用宿主机网络，自动开放所有端口
  -v $(pwd):/app/host \
  -v ./data:/app/onebot \
  -v ./logs:/app/logs \
  maimai977/onebot-manager:latest

```

## 📚 目录结构

```
onebot-manager/
├── server.js              # 主服务器文件
├── config.json            # 系统配置文件
├── package.json            # 项目配置
├── modules/                # 核心模块
│   ├── BotManager.js      # 机器人管理器
│   ├── ProcessManager.js  # 进程管理器
│   ├── ApiRoutes.js       # API 路由
│   └── LagrangeInstaller.js # Lagrange 安装器
├── public/                 # Web 前端文件
│   ├── index.html         # 主页面
│   ├── app.js             # 前端应用逻辑
│   └── style.css          # 样式文件
├── onebot/                 # 机器人数据目录
├── logs/                   # 日志目录
└── docs/                   # 文档目录
```

## ⚙️ 配置说明

### 系统配置 (config.json)

```json
{
  "server": {
    "port": 12345,
    "host": "0.0.0.0",
    "apiKey": "your-api-key"
  },
  "bot": {
    "checkInterval": 3000,
    "qrCodeCheckInterval": 3000,
    "maxRestartAttempts": 3,
    "autoRestart": true
  },
  "scheduler": {
    "autoRestartAll": true,
    "autoRestartTime": "03:00"
  }
}
```

### 机器人配置

每个机器人都有独立的配置文件，支持：
- 账号设置（QQ号、协议类型）
- 连接配置（正向/反向 WebSocket、HTTP）
- 日志配置
- 签名服务器配置

## 🛠️ 开发指南

### 项目架构

- **server.js** - 主服务器，处理HTTP/WebSocket请求
- **BotManager** - 核心机器人管理逻辑
- **ProcessManager** - 进程生命周期管理
- **ApiRoutes** - RESTful API 接口
- **LagrangeInstaller** - 自动下载安装器

### 本地开发

```bash
# 开发模式启动（自动重载）
npm run dev

# 运行测试
npm test

# 代码格式化
npm run lint
```

### API 接口

详细的 API 文档请参考 [API.md](./docs/API.md)

主要接口：
- `POST /api/login` - 用户登录
- `GET /api/bots` - 获取机器人列表
- `POST /api/bots` - 创建机器人
- `POST /api/bots/:id/start` - 启动机器人
- `POST /api/bots/:id/stop` - 停止机器人

## 🔧 故障排除

### 常见问题

1. **端口占用**
   ```bash
   # 检查端口占用
   netstat -ano | findstr :12345
   # 修改配置文件中的端口
   ```

2. **权限问题**
   ```bash
   # 确保有执行权限
   chmod +x Lagrange.OneBot
   ```

3. **网络问题**
   ```bash
   # 检查防火墙设置
   sudo ufw allow 12345
   ```

### 日志调试

- 查看系统日志：`./logs/system.log`
- 查看机器人日志：`./logs/bots/{botId}.log`
- 启用调试模式：设置环境变量 `DEBUG=true`

## 🤝 贡献指南

我们欢迎任何形式的贡献！

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详情请查看 [LICENSE](LICENSE) 文件。

## 📞 支持与反馈

- **Issues**: [GitHub Issues](https://github.com/xhzngm/onebot-manager/issues)
- **QQ群**: [1030501081](https://qm.qq.com/q/leCEnTswTY)

## 🎉 致谢

特别感谢以下项目：

- [Lagrange.Core](https://github.com/LagrangeDev/Lagrange.Core) - 核心 OneBot 实现
- [OneBot](https://onebot.dev/) - 聊天机器人应用接口标准
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [Express.js](https://expressjs.com/) - 快速、开放、极简的 Web 框架

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给个 Star！⭐**

Made with ❤️ by OneBot Manager Team

</div>
