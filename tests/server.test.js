import { describe, expect, test } from '@jest/globals';
import axios from 'axios';
import { createApp } from '../src/server.js';

const startServer = async (app) => new Promise((resolve) => {
  const server = app.listen(0, () => {
    const address = server.address();
    resolve({
      server,
      baseURL: `http://127.0.0.1:${address.port}`
    });
  });
});

const closeServer = async (server) => new Promise((resolve) => {
  server.close(() => resolve());
});

const createHttpClient = (baseURL, apiKey) => axios.create({
  baseURL,
  validateStatus: () => true,
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey
  }
});

const buildAppConfig = () => ({
  apiKey: 'test-api-key',
  defaultDeliveryMode: 'sync',
  syncWaitTimeoutMs: 50,
  rateLimit: {
    windowMs: 60 * 1000,
    max: 1000
  },
  queue: {
    maxSize: 1000,
    maxConcurrentChats: 10,
    retryTtlMs: 5000,
    retryBaseDelayMs: 10,
    retryMaxDelayMs: 20,
    statusTtlMs: 1000
  }
});

const createLogger = () => ({
  info: () => {},
  warn: () => {},
  error: () => {}
});

const createTestApp = (botService, appConfig = buildAppConfig(), strategyReminderService) => createApp({
  appConfig,
  botServiceInstance: botService,
  loggerInstance: createLogger(),
  ...(strategyReminderService ? { strategyReminderService } : {})
});

describe('server delivery mode integration', () => {
  test('mode=async returns 202 and task status is queryable', async () => {
    const botService = {
      sendMessage: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { success: true, messageId: 1 };
      },
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const enqueueResponse = await client.post('/send-message', {
        chatId: 'chat-async',
        message: 'hello async',
        mode: 'async'
      });

      expect(enqueueResponse.status).toBe(202);
      expect(enqueueResponse.data.success).toBe(true);
      expect(enqueueResponse.data.mode).toBe('async');
      expect(enqueueResponse.data.taskId).toBeDefined();

      const statusResponse = await client.get('/message-status', {
        params: { taskId: enqueueResponse.data.taskId }
      });

      expect(statusResponse.status).toBe(200);
      expect(statusResponse.data.success).toBe(true);
      expect(statusResponse.data.taskId).toBe(enqueueResponse.data.taskId);
      expect(['queued', 'processing', 'sent', 'retry_scheduled']).toContain(
        statusResponse.data.status
      );
    } finally {
      await closeServer(server);
    }
  });

  test('mode=sync returns 200 when task completes inside wait window', async () => {
    const botService = {
      sendMessage: async () => ({ success: true, messageId: 123 }),
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const response = await client.post('/send-message', {
        chatId: 'chat-sync',
        message: 'hello sync',
        mode: 'sync'
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.mode).toBe('sync');
      expect(response.data.status).toBe('sent');
      expect(response.data.messageId).toBe(123);
    } finally {
      await closeServer(server);
    }
  });

  test('mode=sync returns 202 when task exceeds sync wait timeout', async () => {
    const botService = {
      sendMessage: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { success: true, messageId: 999 };
      },
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService, {
      ...buildAppConfig(),
      syncWaitTimeoutMs: 30
    });

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const response = await client.post('/send-message', {
        chatId: 'chat-timeout',
        message: 'hello timeout',
        mode: 'sync'
      });

      expect(response.status).toBe(202);
      expect(response.data.success).toBe(true);
      expect(response.data.mode).toBe('sync');
      expect(['queued', 'processing', 'retry_scheduled']).toContain(response.data.status);
      expect(response.data.taskId).toBeDefined();
    } finally {
      await closeServer(server);
    }
  });

  test('GET /message-status returns 404 for unknown taskId', async () => {
    const botService = {
      sendMessage: async () => ({ success: true, messageId: 1 }),
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const response = await client.get('/message-status', {
        params: { taskId: 'not-exist' }
      });

      expect(response.status).toBe(404);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('Task not found');
    } finally {
      await closeServer(server);
    }
  });

  test('invalid JSON body returns 400', async () => {
    const botService = {
      sendMessage: async () => ({ success: true, messageId: 1 }),
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService);

    const { server, baseURL } = await startServer(app);
    try {
      const response = await axios.post(
        `${baseURL}/send-message`,
        '{"chatId": "chat-json",',
        {
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': 'test-api-key'
          }
        }
      );

      expect(response.status).toBe(400);
      expect(response.data.success).toBe(false);
      expect(response.data.error).toBe('Invalid JSON body');
    } finally {
      await closeServer(server);
    }
  });

  test('suppresses legacy strategy reminders before Telegram delivery', async () => {
    let sendCount = 0;
    const botService = {
      sendMessage: async () => {
        sendCount += 1;
        return { success: true, messageId: 1 };
      },
      getChat: async () => ({}),
      getUpdates: async () => []
    };
    const strategyReminderService = {
      normalizeMessage: async () => ({
        action: 'suppress',
        reason: 'legacy_strategy_reminder_suppressed',
        strategyId: 'short_squeeze_setup_up_reverse'
      })
    };

    const app = createTestApp(botService, buildAppConfig(), strategyReminderService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const response = await client.post('/send-message', {
        chatId: 'chat-legacy',
        message: '# 策略买卖提醒\n- Strategy ID：short_squeeze_setup_up_reverse',
        mode: 'sync'
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.status).toBe('suppressed');
      expect(response.data.reason).toBe('legacy_strategy_reminder_suppressed');
      expect(sendCount).toBe(0);
    } finally {
      await closeServer(server);
    }
  });

  test('suppresses meme coin capture alerts before Telegram delivery', async () => {
    let sendCount = 0;
    const botService = {
      sendMessage: async () => {
        sendCount += 1;
        return { success: true, messageId: 1 };
      },
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const response = await client.post('/send-message', {
        chatId: 'chat-meme-alert',
        message: '# 妖币捕捉提醒\n- 候选：PUMPUSDT\n- 信号：异常拉盘，进入监控',
        mode: 'sync'
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.status).toBe('suppressed');
      expect(response.data.reason).toBe('meme_coin_alert_suppressed');
      expect(sendCount).toBe(0);
    } finally {
      await closeServer(server);
    }
  });

  test('delivers ordinary non-alert meme coin discussion text', async () => {
    let sendCount = 0;
    let deliveredMessage = null;
    const botService = {
      sendMessage: async (_chatId, message) => {
        sendCount += 1;
        deliveredMessage = message;
        return { success: true, messageId: 2 };
      },
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const message = '今天只是讨论 meme coin 叙事和市场结构，不是交易通知。';
      const response = await client.post('/send-message', {
        chatId: 'chat-normal',
        message,
        mode: 'sync'
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.status).toBe('sent');
      expect(response.data.messageId).toBe(2);
      expect(sendCount).toBe(1);
      expect(deliveredMessage).toBe(message);
    } finally {
      await closeServer(server);
    }
  });

  test('delivers current TradeResearch strategy reminders', async () => {
    let sendCount = 0;
    let deliveredMessage = null;
    const botService = {
      sendMessage: async (_chatId, message) => {
        sendCount += 1;
        deliveredMessage = message;
        return { success: true, messageId: 3 };
      },
      getChat: async () => ({}),
      getUpdates: async () => []
    };

    const app = createTestApp(botService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const message = [
        '# TradeResearch 策略买卖提醒',
        '- 策略中文名：山寨暴跌后止跌反弹后做空',
        '- 策略编号：L_ALT_CRASH_REBOUND__stage8_reverse__tp10_sl15_h48_ee6_mc2_no_micro',
        '- 交易对（symbol）：CGPTUSDT',
        '- 方向：做空',
        '- 信号类型：open（开仓）',
        '- 下单状态：干跑（未真实下单）',
        '- 原因摘要：测试当前策略提醒',
        '- 时间：2026-05-26 10:00:00'
      ].join('\n');
      const response = await client.post('/send-message', {
        chatId: 'chat-trade-research',
        message,
        mode: 'sync'
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.status).toBe('sent');
      expect(response.data.messageId).toBe(3);
      expect(sendCount).toBe(1);
      expect(deliveredMessage).toBe(message);
    } finally {
      await closeServer(server);
    }
  });

  test('GET /trade-research/strategy-alerts returns formatted latest reminders', async () => {
    const botService = {
      sendMessage: async () => ({ success: true, messageId: 1 }),
      getChat: async () => ({}),
      getUpdates: async () => []
    };
    const strategyReminderService = {
      normalizeMessage: async (message) => ({ action: 'deliver', message }),
      loadLatestAlerts: async () => ([{
        strategy_id: 'L_ALT_CRASH_REBOUND__stage8_reverse__tp10_sl15_h48_ee6_mc2_no_micro',
        symbol: 'CGPTUSDT',
        signal_type: 'close'
      }]),
      formatEventsForTelegram: () => 'TradeResearch 策略买卖提醒\n策略中文名：山寨暴跌后止跌反弹后做空',
      getMappings: () => ([{
        id: 'L_ALT_CRASH_REBOUND__stage8_reverse__tp10_sl15_h48_ee6_mc2_no_micro',
        name: '山寨暴跌后止跌反弹后做空',
        side: 'short'
      }])
    };

    const app = createTestApp(botService, buildAppConfig(), strategyReminderService);

    const { server, baseURL } = await startServer(app);
    try {
      const client = createHttpClient(baseURL, 'test-api-key');
      const response = await client.get('/trade-research/strategy-alerts', {
        params: { limit: 1 }
      });

      expect(response.status).toBe(200);
      expect(response.data.success).toBe(true);
      expect(response.data.count).toBe(1);
      expect(response.data.strategies).toHaveLength(1);
      expect(response.data.message).toContain('TradeResearch 策略买卖提醒');
      expect(response.data.message).toContain('山寨暴跌后止跌反弹后做空');
    } finally {
      await closeServer(server);
    }
  });
});
