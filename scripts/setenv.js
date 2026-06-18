#!/usr/bin/env node
/**
 * npm run setenv
 *
 * 1. Copy .env.example → .env (overwrite)
 * 2. Auto-detect Chrome / Edge executables and profile dirs
 * 3. Set BW_DETAIL_START_TIME to next 12:00:00 SGT (UTC+8)
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── helpers ────────────────────────────────────────────────────────────────

function fileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function firstExisting(paths) {
  for (const p of paths) {
    if (p && fileExists(p)) return p;
  }
  return null;
}

function readRegistryValue(key) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync(`reg query "${key}" /ve`, {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    const m = out.match(/REG_SZ\s+(.+)/);
    return m ? m[1].trim().replace(/^"(.*)"$/, '$1') : null;
  } catch { return null; }
}

function findInPath(exeName) {
  if (process.platform !== 'win32') return [];
  try {
    return execSync(`where ${exeName}`, {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    }).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  } catch { return []; }
}

// ─── browser detection ───────────────────────────────────────────────────────

function detectChrome() {
  const plat = process.platform;
  if (plat === 'darwin') {
    return firstExisting([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]);
  }
  if (plat === 'linux') {
    return firstExisting([
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/snap/bin/chromium',
    ]);
  }
  // win32
  const local = process.env.LOCALAPPDATA ?? '';
  const pf    = process.env.ProgramFiles ?? '';
  const pfx86 = process.env['ProgramFiles(x86)'] ?? '';
  return firstExisting([
    ...findInPath('chrome'),
    readRegistryValue('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'),
    readRegistryValue('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]);
}

function detectEdge() {
  const plat = process.platform;
  if (plat === 'darwin') {
    return firstExisting([
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]);
  }
  if (plat === 'linux') {
    return firstExisting([
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
    ]);
  }
  const local = process.env.LOCALAPPDATA ?? '';
  const pf    = process.env.ProgramFiles ?? '';
  const pfx86 = process.env['ProgramFiles(x86)'] ?? '';
  return firstExisting([
    ...findInPath('msedge'),
    readRegistryValue('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'),
    readRegistryValue('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'),
    path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf,    'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
}

// ─── default profile dirs ────────────────────────────────────────────────────

function defaultChromeProfile() {
  const plat = process.platform;
  if (plat === 'darwin') return path.join(ROOT, '.chrome-profile');
  if (plat === 'linux')  return path.join(ROOT, '.chrome-profile');
  return path.join(ROOT, '.chrome-profile');
}

function defaultEdgeProfile() {
  return path.join(ROOT, '.edge-profile');
}

// ─── next SGT 12:00 timestamp ────────────────────────────────────────────────

function nextNoon12SgtMs() {
  const SGT_OFFSET_MS = 8 * 60 * 60 * 1000; // UTC+8
  const nowUtcMs = Date.now();
  const nowSgtMs = nowUtcMs + SGT_OFFSET_MS;

  // Build a "noon today in SGT" as UTC ms
  const sgtDate = new Date(nowSgtMs);
  const sgtYear  = sgtDate.getUTCFullYear();
  const sgtMonth = sgtDate.getUTCMonth();
  const sgtDay   = sgtDate.getUTCDate();

  // 12:00:00 SGT = 04:00:00 UTC on the same calendar day
  const todayNoonUtcMs = Date.UTC(sgtYear, sgtMonth, sgtDay, 4, 0, 0, 0);

  if (nowUtcMs < todayNoonUtcMs) {
    return todayNoonUtcMs;
  } else {
    // Use tomorrow's noon
    return todayNoonUtcMs + 24 * 60 * 60 * 1000;
  }
}

// ─── .env patching ───────────────────────────────────────────────────────────

function setEnvKey(content, key, value) {
  const escapedValue = String(value).includes(' ') ? `"${value}"` : String(value);
  const re = new RegExp(`^(${key}=).*$`, 'm');
  if (re.test(content)) {
    return content.replace(re, `$1${escapedValue}`);
  }
  // Key not present – append
  return content + `\n${key}=${escapedValue}\n`;
}

// ─── main ────────────────────────────────────────────────────────────────────

const examplePath = path.join(ROOT, '.env.example');
const envPath     = path.join(ROOT, '.env');

if (!fileExists(examplePath)) {
  console.error('ERROR: .env.example not found');
  process.exit(1);
}

let content = fs.readFileSync(examplePath, 'utf8');

// Browser detection
const chromeExe = detectChrome();
const edgeExe   = detectEdge();

const chromeProfile = defaultChromeProfile();
const edgeProfile   = defaultEdgeProfile();

content = setEnvKey(content, 'BW_CHROME_PROFILE', chromeProfile);
content = setEnvKey(content, 'BW_EDGE_PROFILE',   edgeProfile);

if (chromeExe) {
  console.log(`[setenv] Chrome detected: ${chromeExe}`);
  content = setEnvKey(content, 'BW_BROWSER_EXECUTABLE', chromeExe);
} else if (edgeExe) {
  console.log(`[setenv] Edge detected (no Chrome found): ${edgeExe}`);
  content = setEnvKey(content, 'BW_BROWSER_EXECUTABLE', edgeExe);
} else {
  console.warn('[setenv] WARNING: No Chrome or Edge found. Please set BW_BROWSER_EXECUTABLE manually.');
  content = setEnvKey(content, 'BW_BROWSER_EXECUTABLE', '');
}

// Next 12:00 SGT
const nextNoon = nextNoon12SgtMs();
content = setEnvKey(content, 'BW_DETAIL_START_TIME', nextNoon);

// Format as human-readable SGT string
function formatSgt(ms) {
  const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
  const d = new Date(ms + SGT_OFFSET_MS);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} (SGT/北京时间)`;
}

console.log(`[setenv] BW_CHROME_PROFILE   = ${chromeProfile}`);
console.log(`[setenv] BW_EDGE_PROFILE     = ${edgeProfile}`);

fs.writeFileSync(envPath, content, 'utf8');
console.log(`[setenv] .env written to ${envPath}`);
console.log('');
console.log(`⏰  抢票开始时间默认设置为了：${formatSgt(nextNoon)}`);
console.log(`    如需修改，请编辑 .env 中的 BW_DETAIL_START_TIME（毫秒时间戳）`);
console.log(`    接下来请执行 pnpm run login 登录`);
