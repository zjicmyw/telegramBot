import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { botService } from './bot.js';

const app = express();

// 安全中间件
app.use(helmet());
app.use(express.json());

// 速率限制
const limiter = rateLimit(config.rateLimit);
app.use(limiter);

// API 认证中间件
const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== config.apiKey) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
};

// 发送消息接口
app.post('/send-message', authenticate, async (req, res) => {
  const { chatId, message } = req.body;

  if (!chatId || !message) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: chatId and message'
    });
  }

  const result = await botService.sendMessage(chatId, message);
  res.status(result.success ? 200 : 500).json(result);
});

// 错误处理中间件
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