#!/usr/bin/env node
/**
 * npm run setindex
 *
 * 1. Open the Bilibili detail page in the configured browser (no automation)
 * 2. Intercept the getV2 API response to obtain screen_list
 * 3. Prompt user to pick a day  → writes BW_DAY_FLAG to .env
 * 4. Prompt user to pick a ticket type → writes BW_TICKET_INDEX to .env
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

// ─── load .env ────────────────────────────────────────────────────────────────

function loadEnv(filePath) {
  const map = {};
  if (!fs.existsSync(filePath)) return map;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) {
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      map[m[1]] = val;
    }
  }
  return map;
}

function setEnvKey(content, key, value) {
  const escapedValue = String(value);
  const re = new RegExp(`^(${key}=).*$`, 'm');
  if (re.test(content)) {
    return content.replace(re, `$1${escapedValue}`);
  }
  return content + `\n${key}=${escapedValue}\n`;
}

// ─── readline helper ──────────────────────────────────────────────────────────

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function askIndex(rl, question, max) {
  while (true) {
    const answer = (await prompt(rl, question)).trim();
    const n = parseInt(answer, 10);
    if (!isNaN(n) && n >= 0 && n <= max) return n;
    console.log(`  请输入 0 到 ${max} 之间的数字。`);
  }
}

// ─── browser / page setup ─────────────────────────────────────────────────────

const env = loadEnv(ENV_PATH);

const projectId = env.BW_PROJECT_ID || '1001653';
const detailUrl = `https://mall.bilibili.com/neul-next/ticket/detail.html?id=${projectId}`;
const apiPattern = '**/api/ticket/project/getV2?**';

// Resolve executable (reuse same logic as chromePath.js, inlined for standalone script)
import { execSync } from 'node:child_process';
import os from 'node:os';

function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }
function firstExisting(paths) { for (const p of paths) { if (p && fileExists(p)) return p; } return null; }
function readRegVal(key) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync(`reg query "${key}" /ve`, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/REG_SZ\s+(.+)/);
    return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : null;
  } catch { return null; }
}

function resolveExecutable() {
  const override = env.BW_BROWSER_EXECUTABLE;
  if (override && fileExists(override)) return override;

  const plat = process.platform;
  if (plat === 'darwin') {
    return firstExisting([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]);
  }
  if (plat === 'linux') {
    return firstExisting([
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser', '/usr/bin/chromium',
      '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable',
    ]);
  }
  const local = process.env.LOCALAPPDATA ?? '';
  const pf    = process.env.ProgramFiles ?? '';
  const pfx86 = process.env['ProgramFiles(x86)'] ?? '';
  return firstExisting([
    readRegVal('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'),
    readRegVal('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf,    'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    readRegVal('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'),
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
}

function resolveUserDataDir(executable) {
  if (!executable) return env.BW_CHROME_PROFILE || path.join(ROOT, '.chrome-profile');
  const isEdge = executable.toLowerCase().includes('edge') || executable.toLowerCase().includes('msedge');
  return isEdge
    ? (env.BW_EDGE_PROFILE   || path.join(ROOT, '.edge-profile'))
    : (env.BW_CHROME_PROFILE || path.join(ROOT, '.chrome-profile'));
}

// ─── main ─────────────────────────────────────────────────────────────────────

const { chromium } = await import('playwright');

const executable = resolveExecutable();
if (!executable) {
  console.error('ERROR: No browser found. Please set BW_BROWSER_EXECUTABLE in .env');
  process.exit(1);
}
const userDataDir = resolveUserDataDir(executable);
console.log(`[setindex] browser: ${executable}`);
console.log(`[setindex] profile: ${userDataDir}`);
console.log(`[setindex] navigating to: ${detailUrl}`);
console.log('[setindex] waiting for getV2 API response...\n');

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: executable,
  headless: true,
  ignoreDefaultArgs: ['--no-sandbox'],
  viewport: { width: 480, height: 800 },
});

const page = context.pages()[0] ?? await context.newPage();

// Capture getV2 response
let capturedScreenList = null;

await page.route(apiPattern, async route => {
  const url = new URL(route.request().url());
  const reqId = url.searchParams.get('project_id') ?? url.searchParams.get('id');
  if (reqId !== String(projectId)) {
    await route.continue();
    return;
  }
  try {
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body?.data?.screen_list)) {
      capturedScreenList = body.data.screen_list;
      console.log(`[setindex] getV2 captured: ${capturedScreenList.length} screen(s)`);
    }
    await route.fulfill({ response, json: body });
  } catch {
    await route.continue();
  }
});

await page.goto(detailUrl, { waitUntil: 'domcontentloaded' });

// Wait until we have the data (up to 30s)
const deadline = Date.now() + 30_000;
while (!capturedScreenList && Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 300));
}

await context.close();

if (!capturedScreenList) {
  console.error('\nERROR: getV2 API response not captured within 30 seconds.');
  console.error('Make sure the page loaded correctly and try again.');
  process.exit(1);
}

// ─── interactive prompts ──────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log('\n═══════════════════════════════════════');
console.log('  请选择抢票日期（BW_DAY_FLAG）');
console.log('═══════════════════════════════════════');
capturedScreenList.forEach((screen, i) => {
  console.log(`  [${i}] ${screen.name}`);
});

const dayFlag = await askIndex(rl, `\n请输入日期编号 (0–${capturedScreenList.length - 1}): `, capturedScreenList.length - 1);
const chosenScreen = capturedScreenList[dayFlag];

console.log(`\n已选择: [${dayFlag}] ${chosenScreen.name}`);

const ticketList = chosenScreen.ticket_list ?? [];
if (!ticketList.length) {
  console.error('ERROR: 该场次没有 ticket_list 数据');
  rl.close();
  process.exit(1);
}

console.log('\n═══════════════════════════════════════');
console.log('  请选择票档（BW_TICKET_INDEX）');
console.log('═══════════════════════════════════════');
ticketList.forEach((ticket, i) => {
  const price = ticket.price != null ? `¥${(ticket.price / 100).toFixed(0)}` : '';
  console.log(`  [${i}] ${ticket.desc}${price ? '  ' + price : ''}`);
});

const ticketIndex = await askIndex(rl, `\n请输入票档编号 (0–${ticketList.length - 1}): `, ticketList.length - 1);
const chosenTicket = ticketList[ticketIndex];

console.log(`\n已选择: [${ticketIndex}] ${chosenTicket.desc}`);

// ─── start time selection ─────────────────────────────────────────────────────

const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

function formatSgt(ms) {
  const d = new Date(ms + SGT_OFFSET_MS);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} (SGT/北京时间)`;
}

function noonSgtMs(offsetDays = 0) {
  const nowSgt = new Date(Date.now() + SGT_OFFSET_MS);
  const y = nowSgt.getUTCFullYear(), m = nowSgt.getUTCMonth(), d = nowSgt.getUTCDate();
  // 12:00 SGT = 04:00 UTC on the same calendar day
  return Date.UTC(y, m, d + offsetDays, 4, 0, 0, 0);
}

const nowMs = Date.now();
const todayNoonMs = noonSgtMs(0);
const tomorrowNoonMs = noonSgtMs(1);
const todayNoonPassed = nowMs >= todayNoonMs;

const startOptions = [];
startOptions.push({ label: '直接开始（立即抢票）', value: nowMs });
startOptions.push({ label: `明天 12:00:00  →  ${formatSgt(tomorrowNoonMs)}`, value: tomorrowNoonMs });
if (!todayNoonPassed) {
  startOptions.push({ label: `今天 12:00:00  →  ${formatSgt(todayNoonMs)}`, value: todayNoonMs });
}
startOptions.push({ label: '不修改（保留当前 BW_DETAIL_START_TIME）', value: null });

console.log('\n═══════════════════════════════════════');
console.log('  请选择抢票开始时间（BW_DETAIL_START_TIME）');
console.log('═══════════════════════════════════════');
startOptions.forEach((opt, i) => {
  console.log(`  [${i}] ${opt.label}`);
});

const rawAnswer = (await prompt(rl, `\n请输入编号 (0–${startOptions.length - 1})，直接 Enter 不修改: `)).trim();

let chosenStartTime = null; // null = no change
if (rawAnswer !== '') {
  const n = parseInt(rawAnswer, 10);
  if (!isNaN(n) && n >= 0 && n < startOptions.length) {
    chosenStartTime = startOptions[n].value; // null means "keep"
    if (chosenStartTime !== null) {
      console.log(`\n已选择: ${startOptions[n].label}`);
    } else {
      console.log('\n已选择: 不修改开始时间');
    }
  } else {
    console.log('\n输入无效，开始时间不变。');
  }
} else {
  console.log('\n未输入，开始时间不变。');
}

rl.close();

// ─── write .env ───────────────────────────────────────────────────────────────

if (!fs.existsSync(ENV_PATH)) {
  console.error(`ERROR: ${ENV_PATH} not found. Run "npm run setenv" first.`);
  process.exit(1);
}

let envContent = fs.readFileSync(ENV_PATH, 'utf8');
envContent = setEnvKey(envContent, 'BW_DAY_FLAG', dayFlag);
envContent = setEnvKey(envContent, 'BW_TICKET_INDEX', ticketIndex);
if (chosenStartTime !== null) {
  envContent = setEnvKey(envContent, 'BW_DETAIL_START_TIME', chosenStartTime);
}
fs.writeFileSync(ENV_PATH, envContent, 'utf8');

console.log(`\n[setindex] .env updated:`);
console.log(`  BW_DAY_FLAG      = ${dayFlag}  (${chosenScreen.name})`);
console.log(`  BW_TICKET_INDEX  = ${ticketIndex}  (${chosenTicket.desc})`);
if (chosenStartTime !== null) {
  console.log(`  BW_DETAIL_START_TIME = ${chosenStartTime}  (${formatSgt(chosenStartTime)})`);
} else {
  console.log(`  BW_DETAIL_START_TIME = 未修改`);
}
console.log('\n配置完成！可以运行 pnpm start 开始抢票。');
