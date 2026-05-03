import { describe, expect, test, jest } from '@jest/globals';
import { MessageQueueService } from '../src/message-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
});

describe('MessageQueueService', () => {
  test('keeps strict order within the same chat', async () => {
    const callOrder = [];
    const botService = {
      sendMessage: async (chatId, message) => {
        callOrder.push(`${chatId}:${message}`);
        await sleep(10);
        return { success: true, messageId: callOrder.length };
      }
    };

    const queue = new MessageQueueService({
      botService,
      logger: createLogger(),
      queueConfig: {
        maxConcurrentChats: 5,
        statusTtlMs: 1000
      }
    });

    const first = queue.enqueue({ chatId: 'chat-a', message: 'm1' });
    const second = queue.enqueue({ chatId: 'chat-a', message: 'm2' });

    const secondResult = await queue.waitForCompletion(second.taskId, 2000);
    expect(secondResult.completed).toBe(true);
    expect(secondResult.task.status).toBe('sent');

    const firstStatus = queue.getTaskStatus(first.taskId);
    expect(firstStatus.status).toBe('sent');
    expect(callOrder).toEqual(['chat-a:m1', 'chat-a:m2']);
  });

  test('processes different chats concurrently', async () => {
    let currentConcurrency = 0;
    let maxConcurrency = 0;

    const botService = {
      sendMessage: async () => {
        currentConcurrency += 1;
        maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
        await sleep(30);
        currentConcurrency -= 1;
        return { success: true, messageId: Date.now() };
      }
    };

    const queue = new MessageQueueService({
      botService,
      logger: createLogger(),
      queueConfig: {
        maxConcurrentChats: 2,
        statusTtlMs: 1000
      }
    });

    const task1 = queue.enqueue({ chatId: 'chat-1', message: 'hello-1' });
    const task2 = queue.enqueue({ chatId: 'chat-2', message: 'hello-2' });

    await Promise.all([
      queue.waitForCompletion(task1.taskId, 2000),
      queue.waitForCompletion(task2.taskId, 2000)
    ]);

    expect(maxConcurrency).toBe(2);
  });

  test('retries retryable errors and eventually sends', async () => {
    let attempts = 0;
    const botService = {
      sendMessage: async () => {
        attempts += 1;
        if (attempts === 1) {
          return {
            success: false,
            error: 'temporary',
            retryable: true,
            statusCode: 502,
            retryAfterMs: 20
          };
        }
        return { success: true, messageId: 100 };
      }
    };

    const queue = new MessageQueueService({
      botService,
      logger: createLogger(),
      queueConfig: {
        retryBaseDelayMs: 10,
        retryMaxDelayMs: 20,
        retryTtlMs: 2000,
        statusTtlMs: 1000
      }
    });

    const queued = queue.enqueue({ chatId: 'chat-r', message: 'retry-me' });
    const result = await queue.waitForCompletion(queued.taskId, 2000);

    expect(result.completed).toBe(true);
    expect(result.task.status).toBe('sent');
    expect(result.task.attempts).toBe(2);
  });

  test('fails immediately on non-retryable errors', async () => {
    const botService = {
      sendMessage: async () => ({
        success: false,
        error: 'bad request',
        retryable: false,
        statusCode: 400
      })
    };

    const queue = new MessageQueueService({
      botService,
      logger: createLogger(),
      queueConfig: {
        statusTtlMs: 1000
      }
    });

    const queued = queue.enqueue({ chatId: 'chat-f', message: 'no-retry' });
    const result = await queue.waitForCompletion(queued.taskId, 2000);

    expect(result.completed).toBe(true);
    expect(result.task.status).toBe('failed');
    expect(result.task.attempts).toBe(1);
  });

  test('marks task as expired when retry ttl is exceeded', async () => {
    const botService = {
      sendMessage: async () => ({
        success: false,
        error: 'still failing',
        retryable: true,
        statusCode: 502
      })
    };

    const queue = new MessageQueueService({
      botService,
      logger: createLogger(),
      queueConfig: {
        retryTtlMs: 40,
        retryBaseDelayMs: 10,
        retryMaxDelayMs: 20,
        statusTtlMs: 1000
      }
    });

    const queued = queue.enqueue({ chatId: 'chat-e', message: 'expire-me' });
    const result = await queue.waitForCompletion(queued.taskId, 2000);

    expect(result.completed).toBe(true);
    expect(result.task.status).toBe('expired');
    expect(result.task.attempts).toBeGreaterThan(1);
  });

  test('rejects enqueue when queue is full', async () => {
    const botService = {
      sendMessage: async () => new Promise(() => {})
    };

    const queue = new MessageQueueService({
      botService,
      logger: createLogger(),
      queueConfig: {
        maxSize: 1
      }
    });

    const first = queue.enqueue({ chatId: 'chat-full', message: 'first' });
    const second = queue.enqueue({ chatId: 'chat-full', message: 'second' });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(second.error).toBe('QUEUE_OVERLOADED');
    expect(second.currentQueueSize).toBe(1);
    expect(second.maxQueueSize).toBe(1);
  });
});
