import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const toBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
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
  tradeResearch: {
    dbPath: process.env.TRADE_RESEARCH_DB_PATH ||
      path.join('/Users/easthash/code/tradeResearch', 'data', 'market_engine.db'),
    sqliteBin: process.env.SQLITE_BIN || 'sqlite3',
    latestAlertLimit: toPositiveInt(process.env.TRADE_RESEARCH_STRATEGY_ALERT_LIMIT, 20),
    suppressLegacyStrategyReminders: toBoolean(
      process.env.SUPPRESS_LEGACY_STRATEGY_REMINDERS,
      true
    )
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  }
};
