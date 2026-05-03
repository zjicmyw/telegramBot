import dotenv from 'dotenv';

dotenv.config();

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const defaultDeliveryMode = String(process.env.DEFAULT_DELIVERY_MODE || 'sync').toLowerCase();
const normalizedDefaultDeliveryMode = defaultDeliveryMode === 'async' ? 'async' : 'sync';

export const config = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  port: toPositiveInt(process.env.PORT, 3000),
  apiKey: process.env.API_KEY,
  defaultDeliveryMode: normalizedDefaultDeliveryMode,
  syncWaitTimeoutMs: toPositiveInt(process.env.SYNC_WAIT_TIMEOUT_MS, 12000),
  queue: {
    maxSize: toPositiveInt(process.env.QUEUE_MAX_SIZE, 5000),
    maxConcurrentChats: toPositiveInt(process.env.QUEUE_MAX_CONCURRENT_CHATS, 20),
    retryTtlMs: toPositiveInt(process.env.QUEUE_RETRY_TTL_MS, 60 * 60 * 1000),
    retryBaseDelayMs: toPositiveInt(process.env.QUEUE_RETRY_BASE_DELAY_MS, 1000),
    retryMaxDelayMs: toPositiveInt(process.env.QUEUE_RETRY_MAX_DELAY_MS, 60 * 1000),
    statusTtlMs: toPositiveInt(process.env.QUEUE_STATUS_TTL_MS, 24 * 60 * 60 * 1000)
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  }
};
