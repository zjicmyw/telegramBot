// 导入必要的模块
import fetch from 'node-fetch';
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
    // 设置 API 基础 URL
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`;
  }

  // 发送消息方法
  async sendMessage(chatId, message) {
    try {
      // 构建 API URL
      const url = `${this.baseUrl}/sendMessage`;
      
      // 发送请求到 Telegram API
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'  // 支持 HTML 格式的消息
        })
      });

      // 解析响应
      const result = await response.json();

      // 检查响应是否成功
      if (!result.ok) {
        throw new Error(result.description || 'Unknown error');
      }

      // 记录成功日志
      logger.info('Message sent successfully', { 
        chatId, 
        messageId: result.result.message_id 
      });
      
      // 返回成功响应
      return {
        success: true,
        messageId: result.result.message_id
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

  // 获取更新方法（可选）
  async getUpdates(offset = 0) {
    try {
      const url = `${this.baseUrl}/getUpdates?offset=${offset}`;
      const response = await fetch(url);
      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(result.description || 'Unknown error');
      }

      return result.result;
    } catch (error) {
      logger.error('Failed to get updates', { error: error.message });
      throw error;
    }
  }
}

// 导出 TelegramBotService 的实例
export const botService = new TelegramBotService(); 