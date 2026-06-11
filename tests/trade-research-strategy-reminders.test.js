import { describe, expect, test } from '@jest/globals';
import {
  TRADE_RESEARCH_LIVE_STRATEGIES,
  formatStrategyAlertEventsForTelegram,
  formatStrategyMappingText,
  formatTradeResearchStrategyReminder,
  normalizeStrategyReminderMessage
} from '../src/trade-research-strategy-reminders.js';

describe('TradeResearch strategy reminders', () => {
  test('maps all six current live or candidate strategies', () => {
    const mappingText = formatStrategyMappingText();

    expect(TRADE_RESEARCH_LIVE_STRATEGIES).toHaveLength(6);
    for (const strategy of TRADE_RESEARCH_LIVE_STRATEGIES) {
      expect(mappingText).toContain(strategy.id);
      expect(mappingText).toContain(strategy.name);
    }
  });

  test('formats open and close events with required Chinese fields', () => {
    const openMessage = formatTradeResearchStrategyReminder({
      strategy_id: 'L_ALT_NEG_FUND_REVERSAL__stage8_reverse__tp20_sl8_h48_ee6_mc2_liq_small_medium',
      symbol: 'BANANAS31USDT',
      side: 'short',
      signal_type: 'open',
      execution_status: 'failed',
      execution_dry_run: 0,
      execution_error: 'Request failed with status code 401',
      event_time: '2026-05-20T16:19:11+08:00',
      reason_json: JSON.stringify({ reason_summary: '负资金费反向做空' })
    });

    expect(openMessage).toContain('策略中文名：负资金费反向做空');
    expect(openMessage).toContain('交易对（symbol）：BANANAS31USDT');
    expect(openMessage).toContain('方向：做空');
    expect(openMessage).toContain('信号类型：open（开仓）');
    expect(openMessage).toContain('下单状态：真实下单失败（未确认成交）');
    expect(openMessage).toContain('原因摘要：交易接口返回 401，未确认真实成交');
    expect(openMessage).toContain('时间：2026-05-20 16:19:11');
    expect(openMessage).not.toMatch(/<html|<\/?[a-z][^>]*>/i);

    const closeMessage = formatTradeResearchStrategyReminder({
      strategy_id: 'L_ALT_CRASH_REBOUND__stage8_reverse__tp10_sl15_h48_ee6_mc2_no_micro',
      symbol: 'CGPTUSDT',
      side: 'short',
      signal_type: 'close',
      execution_status: 'blocked',
      execution_dry_run: 0,
      execution_error: 'missing_live_open_execution/no_live_position_for_close',
      event_time: '2026-05-22T16:05:10+08:00',
      reason_json: JSON.stringify({ reason_summary: '山寨暴跌后止跌反弹后做空' })
    });

    expect(closeMessage).toContain('策略中文名：山寨暴跌后止跌反弹后做空');
    expect(closeMessage).toContain('信号类型：close（平仓）');
    expect(closeMessage).toContain('下单状态：被拦截（未真实下单）');
    expect(closeMessage).toContain('原因摘要：缺少可核验的真实开仓执行，平仓被拦截');
  });

  test('normalizes new TradeResearch reminder and suppresses legacy strategy reminders', async () => {
    const newReminder = [
      '# 策略买卖提醒',
      '- 策略：慢趋势吸筹向上事件做空',
      '- Strategy ID：L_EVT_SLOW_ACCUM_UP__stage8_reverse__tp10_sl5_h24_ee6_mc1_liq_medium_large',
      '- 标的：BROCCOLIF3BUSDT',
      '- 方向：做空',
      '- 信号时间：2026-05-20 20:00:00',
      '- 说明：24小时价格'
    ].join('\n');

    const normalized = await normalizeStrategyReminderMessage(newReminder, {});
    expect(normalized.action).toBe('deliver');
    expect(normalized.transformed).toBe(true);
    expect(normalized.message).toContain('TradeResearch 策略买卖提醒');
    expect(normalized.message).toContain('策略中文名：慢趋势吸筹向上事件做空');
    expect(normalized.message).not.toContain('Strategy ID');

    const legacyReminder = [
      '# 策略买卖提醒',
      '- 策略：挤压准备向上反向做空',
      '- Strategy ID：short_squeeze_setup_up_reverse',
      '- 标的：IRYSUSDT'
    ].join('\n');

    const suppressed = await normalizeStrategyReminderMessage(legacyReminder, {
      suppressLegacyStrategyReminders: true
    });
    expect(suppressed.action).toBe('suppress');
    expect(suppressed.reason).toBe('legacy_strategy_reminder_suppressed');
  });

  test('formats latest event batches without HTML source', () => {
    const message = formatStrategyAlertEventsForTelegram([
      {
        strategy_id: 'S_EVT_FORCED_ALT_STOP_DOWN__stage8_reverse__tp8_sl12_h24_ee6_mc3_no_micro',
        symbol: 'BLUAIUSDT',
        side: 'long',
        signal_type: 'open',
        execution_status: 'dry_run',
        execution_dry_run: 1,
        event_time: '2026-05-20T16:19:12+08:00',
        reason_summary: '小市值币 24 小时跌幅过深'
      }
    ]);

    expect(message).toContain('强制替代止损事件后做多');
    expect(message).toContain('下单状态：干跑（未真实下单）');
    expect(message).not.toMatch(/<html|<\/?[a-z][^>]*>/i);
  });
});
