// 导入必要的模块
import axios from 'axios';
import https from 'https';
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
      httpsAgent: new https.Agent({ keepAlive: true }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // 发送消息重试配置（仅用于可恢复错误）
    this.retryOptions = {
      maxAttempts: Number(process.env.TELEGRAM_MAX_RETRIES || 3),
      baseDelayMs: Number(process.env.TELEGRAM_RETRY_BASE_DELAY_MS || 500),
      maxDelayMs: Number(process.env.TELEGRAM_RETRY_MAX_DELAY_MS || 5000),
      jitterMs: Number(process.env.TELEGRAM_RETRY_JITTER_MS || 300)
    };
  }

  // 从 axios 错误中提取可读的错误信息（便于日志和 API 返回）
  _getErrorMessage(error) {
    const status = this._getUpstreamStatus(error);
    const description = error.response?.data?.description;

    if (status && description) {
      return `Telegram API ${status}: ${description}`;
    }

    if (description) {
      return description;
    }

    if (status) {
      return `Telegram API ${status}: ${error.response?.statusText || 'Request failed'}`;
    }
    if (error.code) {
      return `Network: ${error.code}${error.message ? ` - ${error.message}` : ''}`;
    }
    return error.message || String(error);
  }

  _getUpstreamStatus(error) {
    return Number(error.response?.data?.error_code || error.response?.status);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _isRetryableError(error) {
    const status = this._getUpstreamStatus(error);
    if (status === 429 || (status >= 500 && status < 600)) {
      return true;
    }

    const retryableCodes = new Set([
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNABORTED',
      'EAI_AGAIN',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ERR_NETWORK'
    ]);

    if (error.code && retryableCodes.has(error.code)) {
      return true;
    }

    const msg = String(error.message || '');
    return /socket hang up|timeout/i.test(msg);
  }

  _isParseEntitiesError(error) {
    const status = this._getUpstreamStatus(error);
    const description = error.response?.data?.description || this._getErrorMessage(error);
    return (
      status === 400 &&
      typeof description === 'string' &&
      /parse entities|Unsupported start tag/i.test(description)
    );
  }

  _getRetryDelayMs(error, attempt) {
    const retryAfterSec = Number(error.response?.data?.parameters?.retry_after);
    if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) {
      return retryAfterSec * 1000;
    }

    const exponential = Math.min(
      this.retryOptions.maxDelayMs,
      this.retryOptions.baseDelayMs * (2 ** (attempt - 1))
    );
    const jitter = Math.floor(Math.random() * this.retryOptions.jitterMs);
    return exponential + jitter;
  }

  _buildFailureResult(error, attempts) {
    const upstreamStatus = this._getUpstreamStatus(error);
    const isTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(String(error.message || ''));

    let statusCode = upstreamStatus;
    if (!statusCode) {
      statusCode = isTimeout ? 504 : 502;
    }

    return {
      success: false,
      error: this._getErrorMessage(error),
      statusCode,
      retryable: this._isRetryableError(error),
      attempts
    };
  }

  async _sendMessageWithRetries(payload, chatId, mode) {
    let lastError;

    for (let attempt = 1; attempt <= this.retryOptions.maxAttempts; attempt += 1) {
      try {
        const response = await this.axiosInstance.post('/sendMessage', payload);
        if (!response.data.ok) {
          const apiError = new Error(response.data.description || 'Unknown error');
          apiError.response = {
            status: Number(response.data.error_code || response.status),
            data: response.data
          };
          throw apiError;
        }

        return {
          messageId: response.data.result.message_id,
          attempts: attempt
        };
      } catch (error) {
        lastError = error;
        const retryable = this._isRetryableError(error);
        const isLastAttempt = attempt >= this.retryOptions.maxAttempts;

        if (!retryable || isLastAttempt) {
          break;
        }

        const delayMs = this._getRetryDelayMs(error, attempt);
        logger.warn('Retrying Telegram sendMessage', {
          chatId,
          mode,
          attempt,
          maxAttempts: this.retryOptions.maxAttempts,
          delayMs,
          error: this._getErrorMessage(error),
          statusCode: this._getUpstreamStatus(error),
          code: error.code
        });

        await this._sleep(delayMs);
      }
    }

    throw lastError;
  }

  // 发送消息方法（先尝试 HTML，若 Telegram 报 HTML 解析错误则自动用纯文本重试）
  async sendMessage(chatId, message) {
    const payload = { chat_id: chatId, text: message };
    const withHtml = { ...payload, parse_mode: 'HTML' };

    try {
      const result = await this._sendMessageWithRetries(withHtml, chatId, 'html');
      logger.info('Message sent successfully', {
        chatId,
        messageId: result.messageId,
        mode: 'html',
        attempts: result.attempts
      });
      return { success: true, messageId: result.messageId, attempts: result.attempts, mode: 'html' };
    } catch (error) {
      const originalError = this._getErrorMessage(error);

      if (this._isParseEntitiesError(error)) {
        try {
          const result = await this._sendMessageWithRetries(payload, chatId, 'plain-text');
          logger.info('Message sent successfully (plain text fallback)', {
            chatId,
            messageId: result.messageId,
            mode: 'plain-text',
            attempts: result.attempts
          });
          return {
            success: true,
            messageId: result.messageId,
            attempts: result.attempts,
            mode: 'plain-text'
          };
        } catch (retryErr) {
          const failure = this._buildFailureResult(retryErr, this.retryOptions.maxAttempts);
          logger.error('Failed to send message (after HTML parse retry)', {
            error: failure.error,
            chatId,
            originalError,
            statusCode: failure.statusCode,
            retryable: failure.retryable,
            attempts: failure.attempts
          });
          return failure;
        }
      }

      const failure = this._buildFailureResult(error, this.retryOptions.maxAttempts);
      logger.error('Failed to send message', {
        error: failure.error,
        chatId,
        statusCode: failure.statusCode,
        code: error.code,
        retryable: failure.retryable,
        attempts: failure.attempts
      });
      return failure;
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
