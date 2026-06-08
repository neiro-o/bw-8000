import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function firstExisting(paths) {
  for (const candidate of paths) {
    if (candidate && fileExists(candidate)) return candidate;
  }
  return null;
}

function readRegistryValue(key) {
  if (process.platform !== 'win32') return null;
  try {
    const output = execSync(`reg query "${key}" /ve`, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = output.match(/REG_SZ\s+(.+)/);
    if (!match) return null;
    return match[1].trim().replace(/^"(.*)"$/, '$1');
  } catch {
    return null;
  }
}

function findInPath(exeName) {
  if (process.platform !== 'win32') return [];
  try {
    const output = execSync(`where ${exeName}`, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.toLowerCase().endsWith(`${exeName}.exe`) || line.toLowerCase().endsWith(exeName));
  } catch {
    return [];
  }
}

function chromeCandidates() {
  const local = process.env.LOCALAPPDATA;
  const pf = process.env.ProgramFiles;
  const pfx86 = process.env['ProgramFiles(x86)'];

  return [
    ...findInPath('chrome'),
    readRegistryValue('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'),
    readRegistryValue('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'),
    readRegistryValue('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'),
    readRegistryValue('HKLM\\SOFTWARE\\Clients\\StartMenuInternet\\Google Chrome\\shell\\open\\command')
      ?.match(/^"([^"]+)"/)?.[1],
    local && path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    pf && path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    pfx86 && path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
}

function edgeCandidates() {
  const local = process.env.LOCALAPPDATA;
  const pf = process.env.ProgramFiles;
  const pfx86 = process.env['ProgramFiles(x86)'];

  return [
    ...findInPath('msedge'),
    readRegistryValue('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'),
    readRegistryValue('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe'),
    readRegistryValue('HKLM\\SOFTWARE\\Clients\\StartMenuInternet\\Microsoft Edge\\shell\\open\\command')
      ?.match(/^"([^"]+)"/)?.[1],
    pfx86 && path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    pf && path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    local && path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean);
}

/**
 * Resolve browser executable.
 *
 * Priority:
 *   1. BW_BROWSER_EXECUTABLE (explicit override)
 *   2. Chrome (standard paths + registry + PATH)
 *   3. Edge (standard paths + registry + PATH)
 *
 * Returns { executable, browser } where browser is 'chrome' or 'edge'.
 */
export function resolveBrowserExecutable(overridePath) {
  if (overridePath) {
    if (!fileExists(overridePath)) {
      throw new Error(`BW_BROWSER_EXECUTABLE does not exist: ${overridePath}`);
    }
    const browser = overridePath.toLowerCase().includes('msedge') ? 'edge' : 'chrome';
    return { executable: overridePath, browser };
  }

  const chrome = firstExisting(chromeCandidates());
  if (chrome) return { executable: chrome, browser: 'chrome' };

  const edge = firstExisting(edgeCandidates());
  if (edge) return { executable: edge, browser: 'edge' };

  return null;
}

export function resolveBrowserExecutableOrThrow(overridePath) {
  const result = resolveBrowserExecutable(overridePath);
  if (result) return result;

  const local = process.env.LOCALAPPDATA ?? '';
  const pf = process.env.ProgramFiles ?? '';
  throw new Error(
    [
      'No browser (Chrome or Edge) found.',
      'Set BW_BROWSER_EXECUTABLE to your browser executable path, for example:',
      `  $env:BW_BROWSER_EXECUTABLE="${path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')}"`,
      'Checked common install locations, including:',
      `  - ${path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe')}`,
      `  - ${path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe')}`
    ].join('\n')
  );
}
