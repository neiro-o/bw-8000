import { Worker } from 'node:worker_threads';
import { config } from '../config.js';

let worker;
let nextId = 1;
const pending = new Map();
const onceKeys = new Set();

function getWorker() {
  if (!config.feishuEnabled) return null;
  if (!config.feishuAppId || !config.feishuAppSecret || !config.feishuReceiveId) {
    console.warn('[feishu] enabled but credentials or receive ID are missing; notifications disabled');
    return null;
  }
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: {
    appId: config.feishuAppId, appSecret: config.feishuAppSecret,
    receiveId: config.feishuReceiveId, receiveIdType: config.feishuReceiveIdType,
  }});
  worker.unref();
  worker.on('message', result => {
    const resolve = pending.get(result.id);
    pending.delete(result.id);
    if (!result.ok) console.error(`[feishu] send failed: ${result.error}`);
    resolve?.(result.ok);
  });
  worker.on('error', error => console.error(`[feishu] worker failed: ${error.message}`));
  return worker;
}

function enqueue(msgType, content) {
  const target = getWorker();
  if (!target) return Promise.resolve(false);
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    target.postMessage({ id, msgType, content });
  });
}

const pidLine = `PID: ${process.pid}`;

export const sendText = text => enqueue('text', `${text}\n${pidLine}`);
export function sendTextOnce(key, text) {
  if (onceKeys.has(key)) return Promise.resolve(false);
  onceKeys.add(key);
  return sendText(text);
}
export function sendSuccessCard(url = '') {
  return enqueue('interactive', {
    config: { wide_screen_mode: true },
    header: { template: 'red', title: { tag: 'plain_text', content: '🎉 抢票成功，请立即付款！' } },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '**已进入支付页面**\n请尽快完成付款，避免订单超时。' } },
      { tag: 'div', text: { tag: 'lark_md', content: pidLine } },
      ...(url ? [{ tag: 'action', actions: [{ tag: 'button', type: 'primary', text: { tag: 'plain_text', content: '查看支付页面' }, url }] }] : []),
    ],
  });
}
export async function sendExitNotice(reason) {
  return sendText(`⛔ BW 抢票应用已退出\n原因：${reason}`);
}

export async function closeFeishu() {
  if (!worker) return;
  const id = nextId++;
  await new Promise(resolve => { pending.set(id, resolve); worker.postMessage({ id, type: 'close' }); });
  worker = undefined;
}
