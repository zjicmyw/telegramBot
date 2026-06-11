import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const TRADE_RESEARCH_LIVE_STRATEGIES = [
  {
    id: 'L_EVT_SLOW_ACCUM_UP__stage8_reverse__tp10_sl5_h24_ee6_mc1_liq_medium_large',
    name: '慢趋势吸筹向上事件做空',
    side: 'short'
  },
  {
    id: 'S_EVT_FORCED_ALT_STOP_DOWN__stage8_reverse__tp8_sl12_h24_ee6_mc3_no_micro',
    name: '强制替代止损事件后做多',
    side: 'long'
  },
  {
    id: 'L_ALT_NEG_FUND_REVERSAL__stage8_reverse__tp20_sl8_h48_ee6_mc2_liq_small_medium',
    name: '负资金费反向做空',
    side: 'short'
  },
  {
    id: 'S_ALT_OVERHEAT_REVERSAL__stage8_reverse__tp15_sl12_h24_ee6_mc1_no_micro',
    name: '山寨过热回落后做多',
    side: 'long'
  },
  {
    id: 'L8_EVT_DERIV_NEG_FUNDING_LONG__stage8_reverse__tp10_sl12_h24_ee6_mc3_liq_small_medium',
    name: '衍生品负资金费冲击做空',
    side: 'short'
  },
  {
    id: 'L_ALT_CRASH_REBOUND__stage8_reverse__tp10_sl15_h48_ee6_mc2_no_micro',
    name: '山寨暴跌后止跌反弹后做空',
    side: 'short'
  }
];

const STRATEGY_BY_ID = new Map(
  TRADE_RESEARCH_LIVE_STRATEGIES.map((strategy) => [strategy.id, strategy])
);

const STRATEGY_ID_SQL_LIST = TRADE_RESEARCH_LIVE_STRATEGIES
  .map((strategy) => `'${strategy.id.replace(/'/g, "''")}'`)
  .join(', ');

const SIGNAL_TYPE_LABELS = {
  open: 'open（开仓）',
  close: 'close（平仓）'
};

const LEGACY_STRATEGY_TITLES = new Set([
  '# 策略买卖提醒',
  '# 策略平仓提醒'
]);

function clampLimit(value, fallback = 20) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function sideLabel(side) {
  return side === 'short' ? '做空' : '做多';
}

function cleanTs(value) {
  return String(value || 'n/a').replace('T', ' ').replace('+08:00', '');
}

function normalizeExecutionError(error) {
  const text = String(error || '').trim();
  if (!text) {
    return '';
  }
  if (text.includes('missing_live_open_execution')) {
    return '缺少可核验的真实开仓执行，平仓被拦截';
  }
  if (text.includes('no_live_position_for_close')) {
    return '没有检测到可平的真实仓位，平仓被拦截';
  }
  if (text.includes('real_order_requires_ceo_approval')) {
    return '缺少真实下单批准，已拦截';
  }
  const statusMatch = text.match(/status code\s+(\d+)/i);
  if (statusMatch) {
    return `交易接口返回 ${statusMatch[1]}，未确认真实成交`;
  }
  if (text.includes('trading_client_missing')) {
    return '交易客户端未初始化，仅保留提醒';
  }
  return text;
}

function parseReasonSummary(reasonJson) {
  if (!reasonJson) {
    return '';
  }
  if (typeof reasonJson === 'object') {
    return String(reasonJson.reason_summary || reasonJson.reasonSummary || '').trim();
  }
  try {
    const parsed = JSON.parse(String(reasonJson));
    return String(parsed.reason_summary || parsed.reasonSummary || '').trim();
  } catch (_error) {
    return '';
  }
}

function executionLabel(row) {
  const status = String(row.execution_status || '').trim().toLowerCase();
  const dryRun = Number(row.execution_dry_run) === 1 || row.execution_dry_run === true;
  const errorText = normalizeExecutionError(row.execution_error);

  if (!status) {
    return {
      label: '未触发下单（仅提醒）',
      reason: ''
    };
  }
  if (dryRun || status === 'dry_run') {
    return {
      label: '干跑（未真实下单）',
      reason: errorText || '已写入干跑审计记录'
    };
  }
  if (status === 'submitted') {
    return {
      label: '真实下单已提交',
      reason: errorText
    };
  }
  if (status === 'blocked') {
    return {
      label: '被拦截（未真实下单）',
      reason: errorText || '风控或执行证据校验未通过'
    };
  }
  if (status === 'failed') {
    return {
      label: '真实下单失败（未确认成交）',
      reason: errorText || '交易接口失败'
    };
  }
  return {
    label: `执行状态 ${status}`,
    reason: errorText
  };
}

function fallbackEventTime(row) {
  if (row.signal_type === 'close') {
    return row.event_time || row.execution_at || row.close_delivered_at ||
      row.close_requested_at || row.planned_exit_ts || row.updated_at || row.created_at;
  }
  return row.event_time || row.execution_at || row.open_delivered_at ||
    row.entry_ts || row.created_at || row.signal_ts;
}

export function formatTradeResearchStrategyReminder(row) {
  const strategy = STRATEGY_BY_ID.get(row.strategy_id);
  if (!strategy) {
    throw new Error(`unsupported TradeResearch strategy: ${row.strategy_id || 'missing'}`);
  }

  const signalType = row.signal_type === 'close' ? 'close' : 'open';
  const execution = executionLabel(row);
  const reasonSummary = execution.reason ||
    String(row.reason_summary || '').trim() ||
    parseReasonSummary(row.reason_json) ||
    '无额外原因';

  return [
    '# TradeResearch 策略买卖提醒',
    `- 策略中文名：${strategy.name}`,
    `- 策略编号：${strategy.id}`,
    `- 交易对（symbol）：${row.symbol || 'n/a'}`,
    `- 方向：${sideLabel(strategy.side || row.side)}`,
    `- 信号类型：${SIGNAL_TYPE_LABELS[signalType]}`,
    `- 下单状态：${execution.label}`,
    `- 原因摘要：${reasonSummary}`,
    `- 时间：${cleanTs(fallbackEventTime(row))}`
  ].join('\n');
}

export function formatStrategyMappingText() {
  return [
    '# TradeResearch 当前策略映射',
    ...TRADE_RESEARCH_LIVE_STRATEGIES.map((strategy, index) =>
      `${index + 1}. ${strategy.name}｜${sideLabel(strategy.side)}｜${strategy.id}`
    )
  ].join('\n');
}

export function formatStrategyAlertEventsForTelegram(events) {
  const rows = Array.isArray(events) ? events : [];
  if (!rows.length) {
    return `${formatStrategyMappingText()}\n\n暂无新的 TradeResearch 策略买卖提醒。`;
  }
  return rows.map((row) => formatTradeResearchStrategyReminder(row)).join('\n\n');
}

function buildLatestEventsSql(limit, extraWhere = '') {
  const where = extraWhere ? `AND ${extraWhere}` : '';
  return `
    WITH strategy_events AS (
      SELECT
        a.id AS alert_id,
        a.strategy_id,
        a.strategy_name,
        a.symbol,
        a.side,
        a.status AS alert_status,
        a.signal_ts,
        a.entry_ts,
        a.planned_exit_ts,
        a.reason_json,
        a.open_delivered_at,
        a.close_requested_at,
        a.close_delivered_at,
        a.created_at,
        a.updated_at,
        'open' AS signal_type,
        COALESCE(e.created_at, a.open_delivered_at, a.entry_ts, a.created_at) AS event_time,
        e.status AS execution_status,
        e.dry_run AS execution_dry_run,
        e.error AS execution_error,
        e.created_at AS execution_at,
        e.exchange_order_id AS exchange_order_id
      FROM strategy_trade_alert a
      LEFT JOIN strategy_trade_execution e
        ON e.alert_id = a.id
       AND e.action = 'open'
      WHERE a.strategy_id IN (${STRATEGY_ID_SQL_LIST})
        ${where}

      UNION ALL

      SELECT
        a.id AS alert_id,
        a.strategy_id,
        a.strategy_name,
        a.symbol,
        a.side,
        a.status AS alert_status,
        a.signal_ts,
        a.entry_ts,
        a.planned_exit_ts,
        a.reason_json,
        a.open_delivered_at,
        a.close_requested_at,
        a.close_delivered_at,
        a.created_at,
        a.updated_at,
        'close' AS signal_type,
        COALESCE(e.created_at, a.close_delivered_at, a.close_requested_at, a.planned_exit_ts, a.updated_at) AS event_time,
        e.status AS execution_status,
        e.dry_run AS execution_dry_run,
        e.error AS execution_error,
        e.created_at AS execution_at,
        e.exchange_order_id AS exchange_order_id
      FROM strategy_trade_alert a
      LEFT JOIN strategy_trade_execution e
        ON e.alert_id = a.id
       AND e.action = 'close'
      WHERE a.strategy_id IN (${STRATEGY_ID_SQL_LIST})
        AND (
          e.id IS NOT NULL
          OR a.close_delivered_at IS NOT NULL
          OR a.close_requested_at IS NOT NULL
          OR a.status IN ('closing', 'closed')
        )
        ${where}
    )
    SELECT *
    FROM strategy_events
    ORDER BY event_time DESC, alert_id DESC
    LIMIT ${clampLimit(limit)}
  `;
}

async function runSqliteJson({ sqliteBin, dbPath, sql }) {
  const { stdout } = await execFileAsync(sqliteBin || 'sqlite3', ['-json', dbPath, sql], {
    maxBuffer: 10 * 1024 * 1024
  });
  const output = String(stdout || '').trim();
  if (!output) {
    return [];
  }
  return JSON.parse(output);
}

export async function queryLatestStrategyAlertEvents({
  dbPath,
  sqliteBin = 'sqlite3',
  limit = 20
}) {
  return runSqliteJson({
    sqliteBin,
    dbPath,
    sql: buildLatestEventsSql(limit)
  });
}

async function queryMatchingStrategyAlertEvent({
  dbPath,
  sqliteBin = 'sqlite3',
  parsed
}) {
  const clauses = [
    `a.strategy_id = ${sqlString(parsed.strategyId)}`,
    `a.symbol = ${sqlString(parsed.symbol)}`
  ];
  if (parsed.signalTs) {
    clauses.push(`a.signal_ts = ${sqlString(parsed.signalTs)}`);
  }
  if (parsed.signalType === 'close' && parsed.eventTs) {
    clauses.push(`a.planned_exit_ts = ${sqlString(parsed.eventTs)}`);
  }
  const rows = await runSqliteJson({
    sqliteBin,
    dbPath,
    sql: buildLatestEventsSql(1, clauses.join(' AND '))
  });
  return rows.find((row) => row.signal_type === parsed.signalType) || rows[0] || null;
}

function parseLegacyStrategyReminder(message) {
  const lines = String(message || '').split(/\r?\n/).map((line) => line.trim());
  const title = lines.find(Boolean);
  if (!LEGACY_STRATEGY_TITLES.has(title)) {
    return null;
  }

  const parsed = {
    signalType: title === '# 策略平仓提醒' ? 'close' : 'open'
  };

  for (const line of lines) {
    const match = line.match(/^-\s*([^：:]+)[：:]\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    const value = match[2].trim();
    if (key === '策略') {
      parsed.strategyName = value;
    } else if (['Strategy ID', '策略ID', '策略编号'].includes(key)) {
      parsed.strategyId = value;
    } else if (key === '标的') {
      parsed.symbol = value;
    } else if (key === '方向') {
      parsed.side = value.includes('空') ? 'short' : 'long';
    } else if (key === '信号时间' || key === '开单信号时间') {
      parsed.signalTs = value.replace(' ', 'T').endsWith('+08:00')
        ? value.replace(' ', 'T')
        : `${value.replace(' ', 'T')}+08:00`;
    } else if (key.startsWith('计划')) {
      parsed.eventTs = value.replace(' ', 'T').endsWith('+08:00')
        ? value.replace(' ', 'T')
        : `${value.replace(' ', 'T')}+08:00`;
    } else if (key === '说明' || key === '触发原因') {
      parsed.reasonSummary = value;
    }
  }

  return parsed;
}

export async function normalizeStrategyReminderMessage(message, options = {}) {
  const parsed = parseLegacyStrategyReminder(message);
  if (!parsed) {
    return { action: 'deliver', message };
  }

  const strategy = STRATEGY_BY_ID.get(parsed.strategyId);
  if (!strategy) {
    if (options.suppressLegacyStrategyReminders === false) {
      return { action: 'deliver', message };
    }
    return {
      action: 'suppress',
      reason: 'legacy_strategy_reminder_suppressed',
      strategyId: parsed.strategyId || null
    };
  }

  let row = null;
  if (options.dbPath) {
    try {
      row = await queryMatchingStrategyAlertEvent({
        dbPath: options.dbPath,
        sqliteBin: options.sqliteBin,
        parsed
      });
    } catch (_error) {
      row = null;
    }
  }

  return {
    action: 'deliver',
    transformed: true,
    message: formatTradeResearchStrategyReminder(row || {
      strategy_id: strategy.id,
      strategy_name: strategy.name,
      symbol: parsed.symbol,
      side: strategy.side,
      signal_type: parsed.signalType,
      signal_ts: parsed.signalTs,
      event_time: parsed.eventTs || parsed.signalTs,
      reason_summary: parsed.reasonSummary || 'Telegram 原始提醒未匹配到执行表记录'
    })
  };
}

export function getTradeResearchStrategyMappings() {
  return TRADE_RESEARCH_LIVE_STRATEGIES.map((strategy) => ({ ...strategy }));
}
