// 导入必要的模块
import axios from 'axios';
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
    
    // 创建 axios 实例，配置默认选项
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,  // 10秒超时
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  // 发送消息方法
  async sendMessage(chatId, message) {
    try {
      // 发送请求到 Telegram API
      const response = await this.axiosInstance.post('/sendMessage', {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'  // 支持 HTML 格式的消息
      });

      // 检查响应是否成功
      if (!response.data.ok) {
        throw new Error(response.data.description || 'Unknown error');
      }

      // 记录成功日志
      logger.info('Message sent successfully', { 
        chatId, 
        messageId: response.data.result.message_id 
      });
      
      // 返回成功响应
      return {
        success: true,
        messageId: response.data.result.message_id
      };
    } catch (error) {
      // 处理 axios 错误
      const errorMessage = error.response?.data?.description || error.message;
      
      // 记录错误日志
      logger.error('Failed to send message', { 
        error: errorMessage, 
        chatId 
      });
      
      // 返回错误响应
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // 获取更新方法（可选）
  async getUpdates(offset = 0) {
    try {
      const response = await this.axiosInstance.get('/getUpdates', {
        params: { offset }
      });
      
      if (!response.data.ok) {
        throw new Error(response.data.description || 'Unknown error');
      }

      return response.data.result;
    } catch (error) {
      const errorMessage = error.response?.data?.description || error.message;
      logger.error('Failed to get updates', { error: errorMessage });
      throw error;
    }
  }

  // 获取聊天信息方法（可选）
  async getChat(chatId) {
    try {
      const response = await this.axiosInstance.get('/getChat', {
        params: { chat_id: chatId }
      });
      
      if (!response.data.ok) {
        throw new Error(response.data.description || 'Unknown error');
      }

      return response.data.result;
    } catch (error) {
      const errorMessage = error.response?.data?.description || error.message;
      logger.error('Failed to get chat info', { error: errorMessage, chatId });
      throw error;
    }
  }
}

// 导出 TelegramBotService 的实例
export const botService = new TelegramBotService(); 