# Telegram Bot with Local HTTP Interface

这是一个基于 Node.js 的 Telegram Bot，提供本地 HTTP 接口用于发送消息。使用 Telegram 官方 API 直接通信，确保稳定性和安全性。

## 功能特点

- 通过 HTTP 接口发送消息到 Telegram
- 支持 HTML 格式的消息内容
- 支持基本的认证机制
- 实现请求频率限制
- 完整的错误处理和日志记录
- 支持获取聊天信息和更新
- 支持同步和异步两种消息投递模式
- 内置消息队列，支持按聊天顺序发送、失败重试和任务状态查询

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

# 默认投递模式：sync 表示等待发送结果，async 表示立即返回任务 ID
DEFAULT_DELIVERY_MODE=sync

# 同步模式等待发送完成的最长时间（毫秒）
SYNC_WAIT_TIMEOUT_MS=12000

# 队列配置
QUEUE_MAX_SIZE=5000
QUEUE_MAX_CONCURRENT_CHATS=20
QUEUE_RETRY_TTL_MS=3600000
QUEUE_RETRY_BASE_DELAY_MS=1000
QUEUE_RETRY_MAX_DELAY_MS=60000
QUEUE_STATUS_TTL_MS=86400000

# TradeResearch 策略买卖提醒
TRADE_RESEARCH_DB_PATH=/Users/easthash/code/tradeResearch/data/market_engine.db
TRADE_RESEARCH_STRATEGY_ALERT_LIMIT=20
SUPPRESS_LEGACY_STRATEGY_REMINDERS=true

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

`/send-message` 支持两种模式：
- `sync`: 等待消息发送完成后返回结果
- `async`: 消息进入队列后立即返回任务 ID，之后通过 `/message-status` 查询状态

**请求**
```http
POST /send-message
Content-Type: application/json
X-API-Key: your_api_key_here

{
    "chatId": "目标聊天ID",
    "message": "要发送的消息内容",
    "mode": "sync"
}
```

**同步成功响应（200）**
```json
{
    "success": true,
    "taskId": "msg_1710000000000_1",
    "status": "sent",
    "mode": "sync",
    "attempts": 1,
    "messageId": "消息ID"
}
```

**同步等待超时或异步响应（202）**
```json
{
    "success": true,
    "taskId": "msg_1710000000000_1",
    "status": "queued",
    "mode": "sync"
}
```

### 异步入队发送

`/enqueue-message` 固定使用异步模式，适合不想让调用方等待 Telegram 返回结果的场景。

**请求**
```http
POST /enqueue-message
Content-Type: application/json
X-API-Key: your_api_key_here

{
    "chatId": "目标聊天ID",
    "message": "要发送的消息内容"
}
```

**响应（202）**
```json
{
    "success": true,
    "taskId": "msg_1710000000000_1",
    "status": "queued",
    "mode": "async"
}
```

### 查询消息任务状态

**请求**
```http
GET /message-status?taskId=msg_1710000000000_1
Content-Type: application/json
X-API-Key: your_api_key_here
```

**响应**
```json
{
    "success": true,
    "taskId": "msg_1710000000000_1",
    "chatId": "目标聊天ID",
    "status": "sent",
    "attempts": 1,
    "messageId": "消息ID",
    "createdAt": "2026-05-03T06:00:00.000Z",
    "updatedAt": "2026-05-03T06:00:01.000Z",
    "startedAt": "2026-05-03T06:00:00.100Z",
    "completedAt": "2026-05-03T06:00:01.000Z"
}
```

### 查询 TradeResearch 策略买卖提醒

只读读取 TradeResearch 的 `strategy_trade_alert` / `strategy_trade_execution`，仅展示当前六个实盘/候选策略。旧策略提醒会在 `/send-message` / `/enqueue-message` 入口被拦截，不再转发到 Telegram。

**请求**
```http
GET /trade-research/strategy-alerts?limit=10
Content-Type: application/json
X-API-Key: your_api_key_here
```

**响应**
```json
{
  "success": true,
  "count": 1,
  "strategies": [
    {
      "id": "L_EVT_SLOW_ACCUM_UP__stage8_reverse__tp10_sl5_h24_ee6_mc1_liq_medium_large",
      "name": "慢趋势吸筹向上事件做空",
      "side": "short"
    }
  ],
  "message": "# TradeResearch 策略买卖提醒\n- 策略中文名：慢趋势吸筹向上事件做空\n- 交易对（symbol）：BROCCOLIF3BUSDT\n- 方向：做空\n- 信号类型：open（开仓）\n- 下单状态：被拦截（未真实下单）\n- 原因摘要：缺少可核验的真实开仓执行，平仓被拦截\n- 时间：2026-05-20 20:39:26",
  "rows": []
}
```

### 获取聊天信息

**请求**
```http
GET /chat-info?chatId=目标聊天ID
Content-Type: application/json
X-API-Key: your_api_key_here
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

## 服务集成与调用示例

### 基础配置

服务默认运行在 `http://localhost:3000`（可通过环境变量 `PORT` 修改）。

**基础 URL：**
```
http://localhost:3000
```

**认证方式：**
所有请求需要在请求头中包含 `X-API-Key`，值为 `.env` 文件中配置的 `API_KEY`。

### 使用 Node.js 调用

```javascript
import axios from 'axios';

const API_BASE_URL = 'http://localhost:3000';
const API_KEY = 'your_api_key_here';

// 发送消息
async function sendMessage(chatId, message) {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/send-message`,
      {
        chatId: chatId,
        message: message,
        mode: 'sync'
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        }
      }
    );
    
    if (response.data.success) {
      console.log('消息任务状态:', response.data.status);
      console.log('任务ID:', response.data.taskId);
      console.log('消息ID:', response.data.messageId);
      return response.data;
    } else {
      console.error('消息发送失败:', response.data.error);
      return null;
    }
  } catch (error) {
    console.error('请求错误:', error.response?.data || error.message);
    return null;
  }
}

// 查询消息任务状态
async function getMessageStatus(taskId) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/message-status`,
      {
        params: { taskId },
        headers: {
          'X-API-Key': API_KEY
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('请求错误:', error.response?.data || error.message);
    return null;
  }
}

// 获取聊天信息
async function getChatInfo(chatId) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/chat-info`,
      {
        params: { chatId },
        headers: {
          'X-API-Key': API_KEY
        }
      }
    );
    
    if (response.data.success) {
      console.log('聊天信息:', response.data.chatInfo);
      return response.data.chatInfo;
    } else {
      console.error('获取失败:', response.data.error);
      return null;
    }
  } catch (error) {
    console.error('请求错误:', error.response?.data || error.message);
    return null;
  }
}

// 使用示例
sendMessage('123456789', 'Hello from Node.js!');
getChatInfo('123456789');
```

### 使用 Python 调用

```python
import requests

API_BASE_URL = 'http://localhost:3000'
API_KEY = 'your_api_key_here'

def send_message(chat_id, message):
    """发送消息到 Telegram"""
    url = f'{API_BASE_URL}/send-message'
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY
    }
    data = {
        'chatId': chat_id,
        'message': message,
        'mode': 'sync'
    }
    
    try:
        response = requests.post(url, json=data, headers=headers)
        response.raise_for_status()
        result = response.json()
        
        if result.get('success'):
            print(f"消息任务状态: {result.get('status')}")
            print(f"任务ID: {result.get('taskId')}")
            print(f"消息ID: {result.get('messageId')}")
            return result
        else:
            print(f"消息发送失败: {result.get('error')}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"请求错误: {e}")
        return None

def get_message_status(task_id):
    """查询消息任务状态"""
    url = f'{API_BASE_URL}/message-status'
    headers = {
        'X-API-Key': API_KEY
    }
    params = {
        'taskId': task_id
    }

    try:
        response = requests.get(url, params=params, headers=headers)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"请求错误: {e}")
        return None

def get_chat_info(chat_id):
    """获取聊天信息"""
    url = f'{API_BASE_URL}/chat-info'
    headers = {
        'X-API-Key': API_KEY
    }
    params = {
        'chatId': chat_id
    }
    
    try:
        response = requests.get(url, params=params, headers=headers)
        response.raise_for_status()
        result = response.json()
        
        if result.get('success'):
            print(f"聊天信息: {result.get('chatInfo')}")
            return result.get('chatInfo')
        else:
            print(f"获取失败: {result.get('error')}")
            return None
    except requests.exceptions.RequestException as e:
        print(f"请求错误: {e}")
        return None

# 使用示例
send_message('123456789', 'Hello from Python!')
get_chat_info('123456789')
```

### 错误处理

所有接口在出错时会返回相应的 HTTP 状态码和错误信息：

**成功响应（200）：**
```json
{
    "success": true,
    "taskId": "msg_1710000000000_1",
    "status": "sent",
    "messageId": "12345"
}
```

**已接收但尚未完成（202）：**
```json
{
    "success": true,
    "taskId": "msg_1710000000000_1",
    "status": "queued",
    "mode": "async"
}
```

**错误响应（400/401/404/429/500/503）：**
```json
{
    "success": false,
    "error": "错误描述信息"
}
```

**常见错误码：**
- `400` - 请求参数错误（缺少必需参数）
- `401` - 认证失败（API Key 无效或缺失）
- `404` - 任务不存在
- `429` - 请求频率过高（超过速率限制）
- `503` - 消息队列已满，服务暂时无法接收更多任务
- `500` - 服务器内部错误

### 最佳实践

1. **环境变量管理**
   - 将 API Key 和服务器地址存储在环境变量中，不要硬编码
   - 使用配置文件或密钥管理服务

2. **错误处理**
   - 始终检查响应中的 `success` 字段
   - 实现重试机制（指数退避）
   - 记录错误日志以便排查问题

3. **速率限制**
   - 注意速率限制：每个 IP 15 分钟内最多 100 个请求
   - 大批量发送时优先使用异步模式，并通过任务状态接口查询结果

4. **安全性**
   - 使用 HTTPS（生产环境）
   - 定期更换 API Key
   - 不要在客户端代码中暴露 API Key

5. **消息格式**
   - 支持 HTML 格式，可以使用 `<b>粗体</b>`、`<i>斜体</i>` 等标签
   - 注意转义特殊字符

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
- 同步和异步投递模式
- 消息队列顺序、并发、重试和过载保护
- 错误处理
- 认证机制
- 速率限制

## 部署

### PM2 部署（推荐）

PM2 是一个强大的 Node.js 进程管理器，提供自动重启、日志管理、进程监控等功能。

#### 安装 PM2

```bash
# 全局安装 PM2
npm install -g pm2
```

#### 使用配置文件启动

```bash
# 使用 PM2 配置文件启动
pm2 start ecosystem.config.cjs

# 或使用 npm 脚本
npm run pm2:start
```

#### 使用部署脚本（推荐）

```bash
# 赋予执行权限
chmod +x deploy.sh

# 运行部署脚本（会自动检查环境、安装依赖、启动应用）
./deploy.sh

# 或使用其他命令
./deploy.sh restart    # 重启应用
./deploy.sh stop       # 停止应用
./deploy.sh logs       # 查看日志
./deploy.sh status     # 查看状态
./deploy.sh help       # 查看帮助
```

#### PM2 常用命令

```bash
# 查看应用状态
pm2 status
# 或使用 npm 脚本
npm run pm2:status

# 查看日志
pm2 logs telegram-bot
# 或使用 npm 脚本
npm run pm2:logs

# 实时监控
pm2 monit
# 或使用 npm 脚本
npm run pm2:monit

# 重启应用
pm2 restart telegram-bot
# 或使用 npm 脚本
npm run pm2:restart

# 零停机重启（reload）
pm2 reload telegram-bot
# 或使用 npm 脚本
npm run pm2:reload

# 停止应用
pm2 stop telegram-bot
# 或使用 npm 脚本
npm run pm2:stop

# 删除应用
pm2 delete telegram-bot
# 或使用 npm 脚本
npm run pm2:delete
```

#### 设置开机自启

```bash
# 生成启动脚本（根据提示执行相应命令）
pm2 startup

# 保存当前进程列表
pm2 save
```

#### PM2 日志说明

PM2 会生成以下日志文件（位于 `logs/` 目录）：
- `pm2-error.log` - PM2 错误日志
- `pm2-out.log` - PM2 输出日志
- `pm2-combined.log` - PM2 合并日志

这些日志与项目中的 winston 日志（`error.log`、`combined.log`）并存，互不干扰。

#### PM2 配置文件说明

`ecosystem.config.cjs` 文件包含以下配置：
- 应用名称和启动脚本
- 自动重启策略
- 内存限制（500MB）
- 日志路径和格式
- 环境变量配置

可以根据需要修改配置文件。

### Docker 部署（备选）

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
