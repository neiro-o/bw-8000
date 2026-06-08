import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const statsPath = fileURLToPath(new URL('../data/stats.json', import.meta.url));

const defaults = {
  countEnter: 0,
  enterLog: [],
  countFound: 0,
  lastFoundTime: 'no',
  countClick: 0,
  lastClickTime: 'no',
  lastConfirmPage: ''
};

export async function readStats() {
  try {
    const raw = await readFile(statsPath, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export async function writeStats(stats) {
  await mkdir(dirname(statsPath), { recursive: true });
  await writeFile(statsPath, JSON.stringify({ ...defaults, ...stats }, null, 2));
}

export async function resetStats() {
  await writeStats(defaults);
}

export async function updateStats(updater) {
  const current = await readStats();
  const next = updater({ ...current });
  await writeStats(next);
  return next;
}

export async function recordEnter(timeText) {
  await updateStats(stats => {
    stats.countEnter += 1;
    stats.enterLog = [...stats.enterLog, timeText].slice(-10);
    return stats;
  });
}

export async function recordFound(timeText) {
  await updateStats(stats => {
    stats.countFound += 1;
    stats.lastFoundTime = timeText;
    return stats;
  });
}

export async function recordLimitClick(timeText) {
  await updateStats(stats => {
    stats.countClick += 1;
    stats.lastClickTime = timeText;
    return stats;
  });
}
