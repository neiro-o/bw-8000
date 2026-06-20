import { closeFeishu, sendSuccessCard, sendText } from '../src/feishu/index.js';

const textOk = await sendText('🧪 飞书普通消息测试成功');
const cardOk = await sendSuccessCard();
await closeFeishu();
if (!textOk || !cardOk) {
  console.error('飞书消息测试失败，请检查环境变量、应用权限和接收目标 ID。');
  process.exitCode = 1;
} else {
  console.log('飞书普通消息和卡片消息均发送成功。');
}
