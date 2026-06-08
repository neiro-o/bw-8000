import { config } from '../config.js';

export async function runPaymentPage(page) {
  console.warn('[payment] payment page reached. Automation stops here for manual payment.');
  if (config.successUrl) {
    console.log(`[payment] opening success notification URL: ${config.successUrl}`);
    await page.goto(config.successUrl, { waitUntil: 'domcontentloaded' });
  }
}
