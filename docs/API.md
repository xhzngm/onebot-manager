# OneBot Manager API 文档

## 📖 概述

OneBot Manager 提供了完整的 RESTful API 接口，用于管理机器人、查看状态、配置系统等。所有 API 请求都需要通过认证。

## 🔐 认证

### 登录认证

所有 API 请求（除了登录接口）都需要先通过认证。系统使用基于 Session 的认证方式。

#### 登录
```http
POST /api/login
Content-Type: application/json

{
  "key": "your-api-key"
}
```

**响应示例**:
```json
{
  "success": true,
  "message": "登录成功"
}
```

#### 登出
```http
POST /api/logout
```

#### 检查认证状态
```http
GET /api/auth-status
```

**响应示例**:
```json
{
  "authenticated": true
}
```

## 🤖 机器人管理

### 获取机器人列表

```http
GET /api/bots
```

**响应示例**:
```json
[
  {
    "id": "bot1",
    "uin": 123456789,
    "protocol": "Linux",
    "status": "running",
    "loginStatus": "online",
    "statusMessage": "运行中",
    "hasQrCode": false,
    "autoRestart": true,
    "restartCount": 0,
    "lastUpdate": 1640995200000,
    "implementations": [
      {
        "Type": "ForwardWebSocket",
        "Host": "127.0.0.1",
        "Port": 8081,
        "AccessToken": ""
      }
    ],
    "isOnline": true
  }
]
```

### 创建机器人

```http
POST /api/bots
Content-Type: application/json

{
  "botId": "bot1",
  "config": {
    "Account": {
      "Uin": 123456789,
      "Protocol": "Linux"
    },
    "Implementations": [
      {
        "Type": "ForwardWebSocket",
        "Host": "127.0.0.1",
        "Port": 8081
      }
    ]
  }
}
```

### 启动机器人

```http
POST /api/bots/{botId}/start
```

### 停止机器人

```http
POST /api/bots/{botId}/stop
```

### 重启机器人

```http
POST /api/bots/{botId}/restart
```

### 删除机器人

```http
DELETE /api/bots/{botId}
```

### 切换自动重启

```http
POST /api/bots/{botId}/toggle-auto-restart
```

### 重启所有机器人

```http
POST /api/bots/restart-all
```

## ⚙️ 配置管理

### 获取机器人原始配置

```http
GET /api/bots/{botId}/config/raw
```

### 获取机器人简化配置

```http
GET /api/bots/{botId}/config/simple
```

**响应示例**:
```json
{
  "account": {
    "uin": 123456789,
    "protocol": "Linux",
    "autoReconnect": true,
    "getOptimumServer": true
  },
  "message": {
    "ignoreSelf": true,
    "stringPost": false
  },
  "implementations": [
    {
      "Type": "ForwardWebSocket",
      "Host": "127.0.0.1",
      "Port": 8081
    }
  ]
}
```

### 保存机器人原始配置

```http
POST /api/bots/{botId}/config/raw
Content-Type: application/json

{
  "$schema": "https://raw.githubusercontent.com/LagrangeDev/Lagrange.Core/master/Lagrange.OneBot/Resources/appsettings_schema.json",
  "Account": {
    "Uin": 123456789,
    "Protocol": "Linux"
  }
}
```

### 保存机器人简化配置

```http
POST /api/bots/{botId}/config/simple
Content-Type: application/json

{
  "account": {
    "uin": 123456789,
    "protocol": "Linux"
  }
}
```

### 创建默认配置

```http
POST /api/bots/{botId}/config/create-default
```

## 📊 日志管理

### 获取机器人日志

```http
GET /api/logs/{botId}
```

**响应示例**:
```json
[
  {
    "timestamp": 1640995200000,
    "time": "2022-01-01 12:00:00",
    "type": "info",
    "message": "机器人启动成功"
  }
]
```

### 清空机器人日志

```http
DELETE /api/logs/{botId}
```

## 🔍 状态检测

### 检查机器人状态

```http
GET /api/bots/{botId}/status
```

**响应示例**:
```json
{
  "success": true,
  "status": "running",
  "isOnline": true,
  "loginStatus": "online",
  "hasQrCode": false
}
```

### 检查二维码

```http
GET /api/bots/{botId}/qrcode
```

### 二维码检查

```http
GET /api/bots/{botId}/qrcode/check
```

### 刷新二维码

```http
POST /api/bots/{botId}/qrcode/refresh
```

### 删除二维码

```http
DELETE /api/bots/{botId}/qrcode
```

## 🔧 系统管理

### 获取系统配置

```http
GET /api/config
```

### 保存系统配置

```http
POST /api/config
Content-Type: application/json

{
  "server": {
    "port": 12345,
    "host": "0.0.0.0"
  },
  "bot": {
    "checkInterval": 3000
  }
}
```

### 获取系统信息

```http
GET /api/system-info
```

**响应示例**:
```json
{
  "platform": "win32",
  "arch": "x64",
  "nodeVersion": "v18.17.0",
  "uptime": 3600,
  "memoryUsage": {
    "rss": 52428800,
    "heapTotal": 29360128,
    "heapUsed": 20971520
  },
  "executablePath": "./Lagrange.OneBot.exe",
  "botRootDir": "C:\\path\\to\\onebot",
  "logDir": "C:\\path\\to\\logs"
}
```

### 清理系统日志

```http
POST /api/system/clear-logs
```

### 重启服务器

```http
POST /api/system/restart
```

## 📱 WebSocket 事件

系统支持 WebSocket 实时通信，连接地址：`ws://host:port/socket.io/`

### 客户端事件

- `getBotLogs` - 获取机器人历史日志
- `getConnectionInfo` - 获取连接信息

### 服务器事件

- `botList` - 机器人列表更新
- `botStatusChanged` - 机器人状态改变
- `botLog` - 实时日志消息
- `qrCodeDetected` - 检测到二维码
- `botLoginSuccess` - 机器人登录成功
- `connectionInfo` - 连接信息

### WebSocket 事件示例

```javascript
const socket = io();

// 监听机器人状态变化
socket.on('botStatusChanged', (data) => {
  console.log(`机器人 ${data.botId} 状态: ${data.status}`);
});

// 监听实时日志
socket.on('botLog', (data) => {
  console.log(`[${data.botId}] ${data.message}`);
});

// 获取机器人日志
socket.emit('getBotLogs', 'bot1');
```

## 🚨 错误码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未认证或认证失败 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### 错误响应格式

```json
{
  "success": false,
  "message": "错误描述",
  "code": "ERROR_CODE"
}
```

## 📝 使用示例

### JavaScript/Node.js

```javascript
const axios = require('axios');

const api = axios.create({
  baseURL: 'http://localhost:12345/api',
  withCredentials: true
});

// 登录
async function login() {
  const response = await api.post('/login', {
    key: 'your-api-key'
  });
  return response.data;
}

// 获取机器人列表
async function getBots() {
  const response = await api.get('/bots');
  return response.data;
}

// 启动机器人
async function startBot(botId) {
  const response = await api.post(`/bots/${botId}/start`);
  return response.data;
}
```

### Python

```python
import requests

class OneBotManagerAPI:
    def __init__(self, base_url, api_key):
        self.base_url = base_url
        self.api_key = api_key
        self.session = requests.Session()
    
    def login(self):
        response = self.session.post(
            f"{self.base_url}/api/login",
            json={"key": self.api_key}
        )
        return response.json()
    
    def get_bots(self):
        response = self.session.get(f"{self.base_url}/api/bots")
        return response.json()
    
    def start_bot(self, bot_id):
        response = self.session.post(
            f"{self.base_url}/api/bots/{bot_id}/start"
        )
        return response.json()
```

### cURL

```bash
# 登录
curl -X POST http://localhost:12345/api/login \
  -H "Content-Type: application/json" \
  -d '{"key":"your-api-key"}' \
  -c cookies.txt

# 获取机器人列表
curl -X GET http://localhost:12345/api/bots \
  -b cookies.txt

# 启动机器人
curl -X POST http://localhost:12345/api/bots/bot1/start \
  -b cookies.txt
```

## 🔄 版本更新

### v1
- 

---

更多信息请参考项目文档或提交 Issue。
