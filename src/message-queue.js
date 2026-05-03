const TERMINAL_STATUSES = new Set(['sent', 'failed', 'expired']);

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const toIso = (timestamp) => {
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return new Date(timestamp).toISOString();
};

class MessageQueueService {
  constructor({
    botService,
    logger,
    queueConfig = {},
    taskIdFactory
  }) {
    if (!botService || typeof botService.sendMessage !== 'function') {
      throw new Error('MessageQueueService requires botService.sendMessage');
    }
    if (!logger) {
      throw new Error('MessageQueueService requires logger');
    }

    this.botService = botService;
    this.logger = logger;
    this.maxSize = toPositiveInt(queueConfig.maxSize, 5000);
    this.maxConcurrentChats = toPositiveInt(queueConfig.maxConcurrentChats, 20);
    this.maxAttempts = toPositiveInt(queueConfig.maxAttempts, 5);
    this.retryTtlMs = toPositiveInt(queueConfig.retryTtlMs, 60 * 60 * 1000);
    this.retryBaseDelayMs = toPositiveInt(queueConfig.retryBaseDelayMs, 1000);
    this.retryMaxDelayMs = toPositiveInt(queueConfig.retryMaxDelayMs, 60 * 1000);
    this.statusTtlMs = toPositiveInt(queueConfig.statusTtlMs, 24 * 60 * 60 * 1000);

    this.taskIdFactory = taskIdFactory || (() => `msg_${Date.now()}_${++this.sequence}`);
    this.sequence = 0;

    this.tasks = new Map();
    this.perChatQueue = new Map();
    this.processingChats = new Set();
    this.readyChats = [];
    this.readyChatSet = new Set();
    this.waiters = new Map();

    this.inFlightCount = 0;
    this.activeTaskCount = 0;
  }

  _isTerminalStatus(status) {
    return TERMINAL_STATUSES.has(status);
  }

  _getCurrentQueueSize() {
    return this.activeTaskCount;
  }

  _toPublicTask(task) {
    if (!task) {
      return null;
    }

    return {
      taskId: task.taskId,
      chatId: task.chatId,
      status: task.status,
      attempts: task.attempts,
      messageId: task.messageId,
      lastError: task.lastError,
      retryable: task.retryable,
      statusCode: task.statusCode,
      nextAttemptAt: toIso(task.nextAttemptAt),
      createdAt: toIso(task.createdAt),
      updatedAt: toIso(task.updatedAt),
      startedAt: toIso(task.startedAt),
      completedAt: toIso(task.completedAt)
    };
  }

  _markChatReady(chatId) {
    if (this.processingChats.has(chatId) || this.readyChatSet.has(chatId)) {
      return;
    }
    this.readyChats.push(chatId);
    this.readyChatSet.add(chatId);
  }

  _cleanChatQueueHead(chatId) {
    const queue = this.perChatQueue.get(chatId);
    if (!queue) {
      return;
    }

    while (queue.length > 0) {
      const firstTask = this.tasks.get(queue[0]);
      if (!firstTask || this._isTerminalStatus(firstTask.status)) {
        queue.shift();
        continue;
      }
      break;
    }

    if (queue.length === 0) {
      this.perChatQueue.delete(chatId);
    }
  }

  _pullNextReadyChat() {
    while (this.readyChats.length > 0) {
      const chatId = this.readyChats.shift();
      this.readyChatSet.delete(chatId);

      if (this.processingChats.has(chatId)) {
        continue;
      }

      this._cleanChatQueueHead(chatId);
      const queue = this.perChatQueue.get(chatId);
      if (!queue || queue.length === 0) {
        continue;
      }

      const firstTask = this.tasks.get(queue[0]);
      if (!firstTask || firstTask.status !== 'queued') {
        continue;
      }

      return chatId;
    }

    return null;
  }

  _notifyWaiters(taskId) {
    const watcherSet = this.waiters.get(taskId);
    if (!watcherSet || watcherSet.size === 0) {
      return;
    }

    const task = this.tasks.get(taskId);
    const payload = {
      found: Boolean(task),
      completed: Boolean(task && this._isTerminalStatus(task.status)),
      task: this._toPublicTask(task)
    };

    for (const watcher of watcherSet) {
      clearTimeout(watcher.timeoutId);
      watcher.resolve(payload);
    }

    this.waiters.delete(taskId);
  }

  _scheduleStatusCleanup(taskId) {
    const cleanupTimer = setTimeout(() => {
      const task = this.tasks.get(taskId);
      if (!task || !this._isTerminalStatus(task.status)) {
        return;
      }
      this.tasks.delete(taskId);
      this.waiters.delete(taskId);
    }, this.statusTtlMs);

    if (typeof cleanupTimer.unref === 'function') {
      cleanupTimer.unref();
    }
  }

  _finalizeTask(task, { status, result }) {
    const now = Date.now();
    const wasTerminal = this._isTerminalStatus(task.status);

    if (task.retryTimer) {
      clearTimeout(task.retryTimer);
      task.retryTimer = null;
    }

    task.status = status;
    task.updatedAt = now;
    task.completedAt = now;
    task.nextAttemptAt = undefined;
    task.lastError = result?.error;
    task.statusCode = Number(result?.statusCode) || undefined;
    task.retryable = Boolean(result?.retryable);

    if (status === 'sent') {
      task.messageId = result?.messageId;
    }

    if (!wasTerminal && this._isTerminalStatus(status)) {
      this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);
    }

    if (status === 'sent') {
      this.logger.info('task_sent', {
        taskId: task.taskId,
        chatId: task.chatId,
        attempt: task.attempts,
        status: task.status,
        messageId: task.messageId
      });
    } else {
      this.logger.error('task_failed', {
        taskId: task.taskId,
        chatId: task.chatId,
        attempt: task.attempts,
        status: task.status,
        error: task.lastError,
        retryable: task.retryable,
        statusCode: task.statusCode
      });
    }

    this._notifyWaiters(task.taskId);
    this._scheduleStatusCleanup(task.taskId);
  }

  _getRetryDelayMs(task, failure, now, deadline) {
    const remainingMs = deadline - now;
    if (remainingMs <= 0) {
      return 0;
    }

    const explicitRetryAfter = Number(failure.retryAfterMs);
    const backoffDelay = Math.min(
      this.retryMaxDelayMs,
      this.retryBaseDelayMs * (2 ** Math.max(0, task.attempts - 1))
    );

    let delayMs = Number.isFinite(explicitRetryAfter) && explicitRetryAfter > 0
      ? explicitRetryAfter
      : backoffDelay;

    delayMs = Math.min(delayMs, remainingMs);
    return Math.max(1, Math.floor(delayMs));
  }

  _scheduleRetry(task, delayMs) {
    if (task.retryTimer) {
      clearTimeout(task.retryTimer);
    }

    task.retryTimer = setTimeout(() => {
      const latestTask = this.tasks.get(task.taskId);
      if (!latestTask || this._isTerminalStatus(latestTask.status)) {
        return;
      }

      latestTask.status = 'queued';
      latestTask.updatedAt = Date.now();
      latestTask.nextAttemptAt = undefined;
      latestTask.retryTimer = null;

      this._markChatReady(latestTask.chatId);
      this._drain();
    }, delayMs);

    if (typeof task.retryTimer.unref === 'function') {
      task.retryTimer.unref();
    }
  }

  _handleFailedAttempt(task, failure) {
    const now = Date.now();
    const deadline = task.createdAt + this.retryTtlMs;
    const retryable = Boolean(failure.retryable);

    task.lastError = failure.error || 'Unknown send failure';
    task.statusCode = Number(failure.statusCode) || 502;
    task.retryable = retryable;
    task.updatedAt = now;

    if (!retryable) {
      this._finalizeTask(task, { status: 'failed', result: failure });
      return 'failed';
    }

    if (task.attempts >= this.maxAttempts) {
      this._finalizeTask(task, { status: 'failed', result: failure });
      return 'failed';
    }

    if (now >= deadline) {
      this._finalizeTask(task, { status: 'expired', result: failure });
      return 'expired';
    }

    const delayMs = this._getRetryDelayMs(task, failure, now, deadline);
    if (delayMs <= 0) {
      this._finalizeTask(task, { status: 'expired', result: failure });
      return 'expired';
    }

    task.status = 'retry_scheduled';
    task.nextAttemptAt = now + delayMs;

    this.logger.warn('task_retry_scheduled', {
      taskId: task.taskId,
      chatId: task.chatId,
      attempt: task.attempts,
      status: task.status,
      error: task.lastError,
      retryable: task.retryable,
      statusCode: task.statusCode,
      delayMs,
      nextAttemptAt: toIso(task.nextAttemptAt)
    });

    this._scheduleRetry(task, delayMs);
    return 'retry_scheduled';
  }

  async _processChat(chatId) {
    if (this.processingChats.has(chatId)) {
      return;
    }

    this._cleanChatQueueHead(chatId);
    const queue = this.perChatQueue.get(chatId);
    if (!queue || queue.length === 0) {
      return;
    }

    const firstTask = this.tasks.get(queue[0]);
    if (!firstTask || firstTask.status !== 'queued') {
      return;
    }

    this.processingChats.add(chatId);
    this.inFlightCount += 1;

    try {
      while (true) {
        this._cleanChatQueueHead(chatId);
        const chatQueue = this.perChatQueue.get(chatId);
        if (!chatQueue || chatQueue.length === 0) {
          break;
        }

        const task = this.tasks.get(chatQueue[0]);
        if (!task) {
          chatQueue.shift();
          continue;
        }

        if (task.status !== 'queued') {
          break;
        }

        const now = Date.now();
        task.status = 'processing';
        task.attempts += 1;
        task.updatedAt = now;
        if (!task.startedAt) {
          task.startedAt = now;
        }

        this.logger.info('task_processing', {
          taskId: task.taskId,
          chatId: task.chatId,
          attempt: task.attempts,
          status: task.status
        });

        let sendResult;
        try {
          sendResult = await this.botService.sendMessage(task.chatId, task.message);
        } catch (error) {
          sendResult = {
            success: false,
            error: error?.message || String(error),
            retryable: true,
            statusCode: 502
          };
        }

        if (sendResult?.success) {
          this._finalizeTask(task, {
            status: 'sent',
            result: sendResult
          });
          chatQueue.shift();
          continue;
        }

        const action = this._handleFailedAttempt(task, sendResult || {});
        if (action === 'retry_scheduled') {
          break;
        }

        chatQueue.shift();
      }
    } finally {
      this.processingChats.delete(chatId);
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);

      this._cleanChatQueueHead(chatId);
      const pendingQueue = this.perChatQueue.get(chatId);
      if (pendingQueue && pendingQueue.length > 0) {
        const firstPendingTask = this.tasks.get(pendingQueue[0]);
        if (firstPendingTask?.status === 'queued') {
          this._markChatReady(chatId);
        }
      }

      this._drain();
    }
  }

  _drain() {
    while (this.inFlightCount < this.maxConcurrentChats) {
      const chatId = this._pullNextReadyChat();
      if (!chatId) {
        break;
      }

      this._processChat(chatId).catch((error) => {
        this.logger.error('queue_processor_error', {
          chatId,
          error: error?.message || String(error)
        });
      });
    }
  }

  enqueue({ chatId, message }) {
    if (!chatId || !message) {
      throw new Error('enqueue requires chatId and message');
    }

    const currentQueueSize = this._getCurrentQueueSize();
    if (currentQueueSize >= this.maxSize) {
      this.logger.warn('queue_overloaded', {
        status: 'queue_overloaded',
        maxQueueSize: this.maxSize,
        currentQueueSize
      });

      return {
        accepted: false,
        error: 'QUEUE_OVERLOADED',
        maxQueueSize: this.maxSize,
        currentQueueSize
      };
    }

    const normalizedChatId = String(chatId);
    const now = Date.now();
    const task = {
      taskId: this.taskIdFactory(),
      chatId: normalizedChatId,
      message,
      status: 'queued',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: undefined,
      completedAt: undefined,
      nextAttemptAt: undefined,
      retryTimer: null,
      retryable: undefined,
      statusCode: undefined,
      messageId: undefined,
      lastError: undefined
    };

    this.tasks.set(task.taskId, task);
    this.activeTaskCount += 1;

    const chatQueue = this.perChatQueue.get(normalizedChatId) || [];
    chatQueue.push(task.taskId);
    this.perChatQueue.set(normalizedChatId, chatQueue);

    if (!this.processingChats.has(normalizedChatId)) {
      const firstTask = this.tasks.get(chatQueue[0]);
      if (firstTask?.status === 'queued') {
        this._markChatReady(normalizedChatId);
      }
    }

    this.logger.info('task_enqueued', {
      taskId: task.taskId,
      chatId: task.chatId,
      attempt: task.attempts,
      status: task.status,
      queueSize: this._getCurrentQueueSize()
    });

    this._drain();

    return {
      accepted: true,
      taskId: task.taskId,
      status: task.status,
      queueSize: this._getCurrentQueueSize()
    };
  }

  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    return this._toPublicTask(task);
  }

  async waitForCompletion(taskId, timeoutMs) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return { found: false, completed: false, task: null };
    }

    if (this._isTerminalStatus(task.status)) {
      return {
        found: true,
        completed: true,
        task: this._toPublicTask(task)
      };
    }

    const safeTimeoutMs = toPositiveInt(timeoutMs, 12000);

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const watcherSet = this.waiters.get(taskId);
        if (watcherSet) {
          watcherSet.delete(watcher);
          if (watcherSet.size === 0) {
            this.waiters.delete(taskId);
          }
        }

        resolve({
          found: true,
          completed: false,
          task: this.getTaskStatus(taskId)
        });
      }, safeTimeoutMs);

      const watcher = {
        resolve,
        timeoutId
      };

      if (!this.waiters.has(taskId)) {
        this.waiters.set(taskId, new Set());
      }
      this.waiters.get(taskId).add(watcher);
    });
  }
}

export { MessageQueueService };
