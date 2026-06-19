import { config } from './config.js';
import { sleep } from './utils.js';

export function parseAutomationStartTimestamp(value) {
  const text = value.trim();
  if (!text) return null;

  if (!/^\d+$/.test(text)) return null;

  const timestamp = Number(text);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) return null;

  return timestamp;
}

export async function waitUntilAutomationStartTime(label, shouldContinue = () => true) {
  if (!config.detailStartTime.trim()) return true;

  const targetTimestamp = parseAutomationStartTimestamp(config.detailStartTime);
  if (targetTimestamp === null) {
    console.warn(`[${label}] invalid BW_DETAIL_START_TIME timestamp: ${config.detailStartTime}`);
    return true;
  }

  let lastLogAt = 0;
  while (Date.now() < targetTimestamp) {
    if (!shouldContinue()) return false;

    const remainingMs = targetTimestamp - Date.now();
    const now = Date.now();
    if (now - lastLogAt >= 60000 || remainingMs <= 1000) {
      console.log(`[${label}] waiting for automation start timestamp ${config.detailStartTime}, remaining ${(remainingMs / 1000).toFixed(1)}s`);
      lastLogAt = now;
    }
    await sleep(Math.min(100, Math.max(1, remainingMs)));
  }

  return shouldContinue();
}
