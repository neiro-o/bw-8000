import { config } from '../config.js';
import { sendSuccessCard } from '../feishu/index.js';

export async function runPaymentPage(page) {
  void sendSuccessCard(page.url());
  console.warn('[payment] payment page reached. Automation stops here for manual payment.');
  if (config.successUrl) {
    console.log(`[payment] opening success notification URL: ${config.successUrl}`);
    await page.goto(config.successUrl, { waitUntil: 'domcontentloaded' });
  }
}
