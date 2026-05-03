import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pathToFileURL } from 'url';
import { config } from './config.js';
import { botService } from './bot.js';
import { logger } from './logger.js';
import { MessageQueueService } from './message-queue.js';

const VALID_MODES = new Set(['sync', 'async']);

const mergeConfig = (baseConfig, overrideConfig = {}) => ({
  ...baseConfig,
  ...overrideConfig,
  rateLimit: {
    ...baseConfig.rateLimit,
    ...(overrideConfig.rateLimit || {})
  },
  queue: {
    ...baseConfig.queue,
    ...(overrideConfig.queue || {})
  }
});

const normalizeMode = (mode, fallbackMode) => {
  const resolved = String(mode || fallbackMode || 'sync').toLowerCase();
  return VALID_MODES.has(resolved) ? resolved : null;
};

const mapSendMessageStatusCode = (statusCode) => {
  const status = Number(statusCode);

  if (!Number.isInteger(status)) {
    return 500;
  }

  if (status === 502 || status === 504) {
    return status;
  }

  if (status >= 500) {
    return 502;
  }

  if (status >= 400 && status < 500) {
    return status;
  }

  return 500;
};

const isMissingRequiredPayload = (chatId, message) => {
  if (!chatId) {
    return true;
  }
  if (typeof message !== 'string') {
    return true;
  }
  return message.length === 0;
};

const buildAsyncAcceptedResponse = (taskId, task, mode) => ({
  success: true,
  taskId,
  status: task?.status || 'queued',
  mode
});

export const createApp = ({
  appConfig = config,
  botServiceInstance = botService,
  queueService = null,
  loggerInstance = logger
} = {}) => {
  const runtimeConfig = mergeConfig(config, appConfig);

  const messageQueue = queueService || new MessageQueueService({
    botService: botServiceInstance,
    logger: loggerInstance,
    queueConfig: runtimeConfig.queue
  });

  const app = express();
  app.use(helmet());
  app.use(express.json());
  app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON body'
      });
    }

    return next(err);
  });
  app.use(rateLimit(runtimeConfig.rateLimit));

  const authenticate = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== runtimeConfig.apiKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
  };

  const handleEnqueue = async (req, res, next, forcedMode = null) => {
    const { chatId, message, mode } = req.body || {};

    if (isMissingRequiredPayload(chatId, message)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: chatId and message'
      });
    }

    const resolvedMode = forcedMode || normalizeMode(mode, runtimeConfig.defaultDeliveryMode);
    if (!resolvedMode) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mode. Allowed values: sync, async'
      });
    }

    try {
      const enqueueResult = messageQueue.enqueue({ chatId, message });
      if (!enqueueResult.accepted) {
        if (enqueueResult.error === 'QUEUE_OVERLOADED') {
          return res.status(503).json({
            success: false,
            error: enqueueResult.error,
            maxQueueSize: enqueueResult.maxQueueSize,
            currentQueueSize: enqueueResult.currentQueueSize
          });
        }

        return res.status(500).json({
          success: false,
          error: enqueueResult.error || 'Queue enqueue failed'
        });
      }

      const taskId = enqueueResult.taskId;
      const queuedTask = messageQueue.getTaskStatus(taskId);

      if (resolvedMode === 'async') {
        return res
          .status(202)
          .json(buildAsyncAcceptedResponse(taskId, queuedTask, 'async'));
      }

      const waitResult = await messageQueue.waitForCompletion(
        taskId,
        runtimeConfig.syncWaitTimeoutMs
      );

      if (!waitResult.found || !waitResult.task) {
        return res.status(404).json({
          success: false,
          error: 'Task not found',
          taskId
        });
      }

      const task = waitResult.task;
      if (!waitResult.completed) {
        return res
          .status(202)
          .json(buildAsyncAcceptedResponse(taskId, task, 'sync'));
      }

      if (task.status === 'sent') {
        return res.status(200).json({
          success: true,
          taskId,
          status: task.status,
          mode: 'sync',
          attempts: task.attempts,
          messageId: task.messageId
        });
      }

      const statusCode = mapSendMessageStatusCode(task.statusCode);
      return res.status(statusCode).json({
        success: false,
        taskId,
        status: task.status,
        mode: 'sync',
        attempts: task.attempts,
        error: task.lastError,
        statusCode: task.statusCode,
        retryable: task.retryable
      });
    } catch (error) {
      return next(error);
    }
  };

  app.post('/send-message', authenticate, async (req, res, next) => {
    await handleEnqueue(req, res, next);
  });

  app.post('/enqueue-message', authenticate, async (req, res, next) => {
    await handleEnqueue(req, res, next, 'async');
  });

  app.get('/message-status', authenticate, (req, res) => {
    const taskId = req.query.taskId;
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: taskId'
      });
    }

    const task = messageQueue.getTaskStatus(String(taskId));
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found',
        taskId: String(taskId)
      });
    }

    return res.json({
      success: true,
      ...task
    });
  });

  app.get('/chat-info', authenticate, async (req, res) => {
    const chatId = req.query.chatId;
    if (!chatId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: chatId'
      });
    }

    try {
      const chatInfo = await botServiceInstance.getChat(chatId);
      return res.json({
        success: true,
        chatInfo
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  app.get('/updates', authenticate, async (req, res) => {
    try {
      const updates = await botServiceInstance.getUpdates();
      return res.json({
        success: true,
        updates
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  app.use((err, req, res, next) => {
    loggerInstance.error('request_error', {
      error: err?.message || String(err),
      path: req.path
    });

    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  });

  return app;
};

export const app = createApp();

export const startServer = ({ appInstance = app, port = config.port } = {}) =>
  appInstance.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

const isDirectRun = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  startServer();
}
