# Telegram Bot with Local HTTP Interface

这是一个基于 Node.js 的 Telegram Bot，提供本地 HTTP 接口用于发送消息。使用 Telegram 官方 API 直接通信，确保稳定性和安全性。

## 功能特点

- 通过 HTTP 接口发送消息到 Telegram
- 支持 HTML 格式的消息内容
- 支持基本的认证机制
- 实现请求频率限制
- 完整的错误处理和日志记录
- 支持获取聊天信息和更新

## 技术栈

- Node.js >= 16.x
- Express.js - Web 服务器框架
- Axios - HTTP 客户端
- Winston - 日志系统
- Helmet - 安全中间件
- Express Rate Limit - 请求限制

## 安装

1. 克隆仓库
```bash
git clone [repository-url]
cd telegram-bot
```

2. 安装依赖
```bash
npm install
```

3. 配置环境变量
复制 `.env.example` 文件为 `.env`，并填写必要的配置信息：
```
# Telegram Bot Token（从 @BotFather 获取）
TELEGRAM_BOT_TOKEN=your_bot_token_here

# 服务器端口号
PORT=3000

# API 密钥（用于接口认证）
API_KEY=your_api_key_here

# 机器人用户名
handle=@your_bot_username

# 获取聊天 ID 的 API 地址
CHAT_ID_API=https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
```

## 运行

开发模式（支持热重载）：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

停止服务器（端口 3000）：
```bash
# Windows
# 查找占用 3000 端口的进程
netstat -ano | findstr :3000
# 使用找到的 PID 终止进程（替换 PID）
taskkill /F /PID <PID>

# Linux/Mac
# 查找占用 3000 端口的进程
lsof -i :3000
# 终止该进程
kill -9 $(lsof -t -i:3000)
```

## API 使用说明

### 发送消息

**请求**
```http
POST /send-message
Content-Type: application/json
X-API-Key: your_api_key_here

{
    "chatId": "目标聊天ID",
    "message": "要发送的消息内容"
}
```

**响应**
```json
{
    "success": true,
    "messageId": "消息ID"
}
```

### 获取聊天信息

**请求**
```http
GET /chat-info
Content-Type: application/json
X-API-Key: your_api_key_here

{
    "chatId": "目标聊天ID"
}
```

**响应**
```json
{
    "success": true,
    "chatInfo": {
        "id": "聊天ID",
        "type": "聊天类型",
        "title": "群组标题（如果是群组）",
        "username": "用户名（如果有）"
    }
}
```

## 安全说明

- 所有请求必须包含有效的 API Key
- 每个 IP 地址在 15 分钟内最多可以发送 100 个请求
- 敏感信息通过环境变量管理
- 使用 Helmet 中间件增强安全性
- 支持 HTTPS（建议在生产环境使用）

## 日志系统

日志文件位于项目根目录：
- `error.log`: 错误日志，记录所有错误信息
- `combined.log`: 所有日志，包含所有级别的日志信息

日志级别：
- error: 错误信息
- warn: 警告信息
- info: 一般信息
- debug: 调试信息

## 测试

运行测试：
```bash
npm test
```

测试内容包括：
- 消息发送功能
- 错误处理
- 认证机制
- 速率限制

## 部署

### Docker 部署
1. 构建镜像：
```bash
docker build -t telegram-bot .
```

2. 运行容器：
```bash
docker run -d \
  -p 3000:3000 \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e API_KEY=your_api_key \
  telegram-bot
```

### 直接部署
1. 安装 Node.js 和 npm
2. 克隆代码库
3. 安装依赖
4. 配置环境变量
5. 启动服务

## 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 许可证

MIT License 