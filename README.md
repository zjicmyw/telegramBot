# Telegram Bot with Local HTTP Interface

这是一个基于 Node.js 的 Telegram Bot，提供本地 HTTP 接口用于发送消息。

## 功能特点

- 通过 HTTP 接口发送消息到 Telegram
- 支持基本的认证机制
- 实现请求频率限制
- 完整的错误处理和日志记录

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
TELEGRAM_BOT_TOKEN=your_bot_token_here
PORT=3000
API_KEY=your_api_key_here
```

## 运行

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm start
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

## 安全说明

- 所有请求必须包含有效的 API Key
- 每个 IP 地址在 15 分钟内最多可以发送 100 个请求
- 敏感信息通过环境变量管理

## 日志

日志文件位于项目根目录：
- `error.log`: 错误日志
- `combined.log`: 所有日志

## 测试

运行测试：
```bash
npm test
``` 