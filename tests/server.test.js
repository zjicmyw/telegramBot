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

const createTestApp = (botService, appConfig = buildAppConfig()) => createApp({
  appConfig,
  botServiceInstance: botService,
  loggerInstance: createLogger()
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
});
