import { sleep } from './utils.js';

const WINDOW_MS = 20_000;
const ENTRY_THRESHOLD = 3;
const DELAY_MS = 5_000;

const entryHistoryByPage = new WeakMap();

export async function waitForRapidDetailPageEntries(page) {
  const now = Date.now();
  const recentEntries = (entryHistoryByPage.get(page) ?? [])
    .filter(timestamp => now - timestamp <= WINDOW_MS);

  recentEntries.push(now);
  entryHistoryByPage.set(page, recentEntries);

  if (recentEntries.length < ENTRY_THRESHOLD) return;

  console.info(
    `[detail] entered ${recentEntries.length} times within 20 seconds; delaying automation for 5 seconds`
  );
  await sleep(DELAY_MS);
}
