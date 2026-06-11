const MEME_COIN_KEYWORDS = [
  /妖币/i,
  /meme\s*coin/i,
  /memecoin/i,
  /meme/i,
  /pump/i,
  /爆拉/i,
  /异常拉盘/i,
  /土狗/i,
  /金狗/i
];

const ALERT_TRIGGER_KEYWORDS = [
  /提醒/i,
  /捕捉/i,
  /监控/i,
  /预警/i,
  /信号/i,
  /候选/i,
  /alert/i,
  /watch\s*list/i,
  /monitor/i,
  /signal/i,
  /candidate/i
];

export const MEME_COIN_ALERT_SUPPRESSED_REASON = 'meme_coin_alert_suppressed';

export function shouldSuppressMemeCoinAlert(message) {
  const text = String(message || '').trim();
  if (!text) {
    return false;
  }

  const hasMemeCoinKeyword = MEME_COIN_KEYWORDS.some((pattern) => pattern.test(text));
  if (!hasMemeCoinKeyword) {
    return false;
  }

  return ALERT_TRIGGER_KEYWORDS.some((pattern) => pattern.test(text));
}
