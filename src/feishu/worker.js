import { parentPort, workerData } from 'node:worker_threads';
import * as lark from '@larksuiteoapi/node-sdk';

const client = new lark.Client({ appId: workerData.appId, appSecret: workerData.appSecret });
parentPort.on('message', async message => {
  if (message.type === 'close') {
    parentPort.postMessage({ id: message.id, ok: true });
    process.exit(0);
  }
  try {
    const content = message.msgType === 'interactive' ? JSON.stringify(message.content) : JSON.stringify({ text: message.content });
    const response = await client.im.v1.message.create({
      params: { receive_id_type: workerData.receiveIdType },
      data: { receive_id: workerData.receiveId, msg_type: message.msgType, content },
    });
    if (response.code) throw new Error(`${response.code}: ${response.msg}`);
    parentPort.postMessage({ id: message.id, ok: true });
  } catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: error.message });
  }
});
