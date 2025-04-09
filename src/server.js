// 导入必要的模块
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { botService } from './bot.js';

// 创建 Express 应用实例
const app = express();

// 安全中间件
// helmet 提供各种 HTTP 头来增加安全性
app.use(helmet());
// 解析 JSON 请求体
app.use(express.json());

// 配置速率限制中间件
const limiter = rateLimit(config.rateLimit);
app.use(limiter);

// API 认证中间件
// 检查请求头中的 X-API-Key 是否有效
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== config.apiKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
};

// 发送消息接口
// POST /send-message
app.post('/send-message', authenticate, async (req, res) => {
  // 从请求体中获取参数
  const { chatId, message } = req.body;

  // 参数验证
  if (!chatId || !message) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: chatId and message'
    });
  }

  // 调用 bot 服务发送消息
  const result = await botService.sendMessage(chatId, message);
  // 根据发送结果返回相应的状态码
  res.status(result.success ? 200 : 500).json(result);
});

// 获取聊天信息接口
// GET /chat-info
app.get('/chat-info', authenticate, async (req, res) => {
  const chatId = req.query.chatId;

  if (!chatId) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: chatId'
    });
  }

  try {
    const chatInfo = await botService.getChat(chatId);
    res.json({
      success: true,
      chatInfo
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取更新信息接口
// GET /updates
app.get('/updates', authenticate, async (req, res) => {
  try {
    const updates = await botService.getUpdates();
    res.json({
      success: true,
      updates
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 错误处理中间件
// 捕获并处理所有未处理的错误
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error'
  });
});

// 启动服务器
app.listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);
}); 