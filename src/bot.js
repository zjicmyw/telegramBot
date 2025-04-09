import TelegramBot from 'node-telegram-bot-api';
import winston from 'winston';
import { config } from './config.js';

// 配置日志
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

class TelegramBotService {
  constructor() {
    this.bot = new TelegramBot(config.botToken, { polling: false });
  }

  async sendMessage(chatId, message) {
    try {
      const result = await this.bot.sendMessage(chatId, message);
      logger.info('Message sent successfully', { chatId, messageId: result.message_id });
      return {
        success: true,
        messageId: result.message_id
      };
    } catch (error) {
      logger.error('Failed to send message', { error: error.message, chatId });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export const botService = new TelegramBotService(); 