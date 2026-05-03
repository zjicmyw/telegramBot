import axios from 'axios';
import https from 'https';
import { config } from './config.js';
import { logger } from './logger.js';

class TelegramBotService {
  constructor() {
    this.baseUrl = `https://api.telegram.org/bot${config.botToken}`;
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
      httpsAgent: new https.Agent({ keepAlive: true }),
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.retryOptions = {
      maxAttempts: Number(process.env.TELEGRAM_MAX_RETRIES || 3),
      baseDelayMs: Number(process.env.TELEGRAM_RETRY_BASE_DELAY_MS || 500),
      maxDelayMs: Number(process.env.TELEGRAM_RETRY_MAX_DELAY_MS || 5000),
      jitterMs: Number(process.env.TELEGRAM_RETRY_JITTER_MS || 300)
    };
  }

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

  _extractRetryAfterMs(error) {
    const retryAfterSec = Number(error.response?.data?.parameters?.retry_after);
    if (!Number.isFinite(retryAfterSec) || retryAfterSec <= 0) {
      return undefined;
    }
    return retryAfterSec * 1000;
  }

  _getRetryDelayMs(error, attempt) {
    const retryAfterMs = this._extractRetryAfterMs(error);
    if (retryAfterMs) {
      return retryAfterMs;
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
    const retryAfterMs = this._extractRetryAfterMs(error);

    let statusCode = upstreamStatus;
    if (!statusCode) {
      statusCode = isTimeout ? 504 : 502;
    }

    return {
      success: false,
      error: this._getErrorMessage(error),
      statusCode,
      retryable: this._isRetryableError(error),
      retryAfterMs,
      attempts
    };
  }

  async _sendMessageWithRetries(payload, chatId, mode) {
    let lastError;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= this.retryOptions.maxAttempts; attempt += 1) {
      attemptsMade = attempt;
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

    if (lastError) {
      lastError.sendAttempts = attemptsMade;
    }
    throw lastError;
  }

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
          const attempts = Number(retryErr.sendAttempts || this.retryOptions.maxAttempts);
          const failure = this._buildFailureResult(retryErr, attempts);
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

      const attempts = Number(error.sendAttempts || this.retryOptions.maxAttempts);
      const failure = this._buildFailureResult(error, attempts);
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

export { TelegramBotService };
export const botService = new TelegramBotService();
