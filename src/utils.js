export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function nowText() {
  return new Date().toLocaleTimeString();
}

export function jitter(baseMs, spreadMs) {
  return baseMs + Math.floor(Math.random() * (spreadMs * 2 + 1)) - spreadMs;
}

export async function isVisible(locator) {
  try {
    return await locator.isVisible();
  } catch {
    return false;
  }
}

export async function isClickableButton(locator) {
  try {
    if (!(await locator.count())) return false;
    const first = locator.first();
    if (!(await first.isVisible())) return false;
    const className = await first.getAttribute('class');
    if (className?.includes('is-disabled')) return false;
    return await first.isEnabled();
  } catch {
    return false;
  }
}
