// 导入必要的模块
import TelegramBot from 'node-telegram-bot-api';
import winston from 'winston';
import { config } from './config.js';

// 配置日志系统
// 使用 winston 创建日志记录器，支持文件和控制台输出
const logger = winston.createLogger({
  level: 'info',  // 设置日志级别为 info
  format: winston.format.json(),  // 使用 JSON 格式记录日志
  transports: [
    // 错误日志单独记录到 error.log 文件
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    // 所有日志记录到 combined.log 文件
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// 在非生产环境下，同时输出日志到控制台
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()  // 控制台使用简单格式
  }));
}

// Telegram Bot 服务类
class TelegramBotService {
  constructor() {
    // 初始化 Telegram Bot，使用配置中的 token
    // polling: false 表示不使用轮询模式
    this.bot = new TelegramBot(config.botToken, { polling: false });
  }

  // 发送消息方法
  async sendMessage(chatId, message) {
    try {
      // 调用 Telegram Bot API 发送消息
      const result = await this.bot.sendMessage(chatId, message);
      
      // 记录成功日志
      logger.info('Message sent successfully', { 
        chatId, 
        messageId: result.message_id 
      });
      
      // 返回成功响应
      return {
        success: true,
        messageId: result.message_id
      };
    } catch (error) {
      // 记录错误日志
      logger.error('Failed to send message', { 
        error: error.message, 
        chatId 
      });
      
      // 返回错误响应
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// 导出 TelegramBotService 的实例
export const botService = new TelegramBotService(); 