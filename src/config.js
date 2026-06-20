export const config = {
  projectId: Number(process.env.BW_PROJECT_ID ?? 102194),
  dayFlag: Number(process.env.BW_DAY_FLAG ?? 0),
  ticketIndex: Number(process.env.BW_TICKET_INDEX ?? 0),
  ticketQuantity: Math.max(1, Math.trunc(Number(process.env.BW_TICKET_QUANTITY ?? 1)) || 1),
  instances: Math.max(1, Math.trunc(Number(process.env.BW_INSTANCES ?? 1)) || 1),
  clickLimitIntervalMs: Number(process.env.BW_CLICK_LIMIT_INTERVAL_MS ?? 285),
  checkTicketIntervalMs: Number(process.env.BW_CHECK_TICKET_INTERVAL_MS ?? 520),
  chromeProfile: process.env.BW_CHROME_PROFILE ?? 'E:/code/bw_tickets/.chrome-profile',
  edgeProfile: process.env.BW_EDGE_PROFILE ?? 'E:/code/bw_tickets/.edge-profile',
  browserExecutable: process.env.BW_BROWSER_EXECUTABLE ?? '',
  headless: process.env.BW_HEADLESS === '1',
  browserWidth: Number(process.env.BW_BROWSER_WIDTH ?? 720),
  browserHeight: Number(process.env.BW_BROWSER_HEIGHT ?? 1080),
  browserFullscreen: process.env.BW_BROWSER_FULLSCREEN === '1',
  detailStartTime: process.env.BW_DETAIL_START_TIME ?? '',
  successUrl: process.env.BW_SUCCESS_URL ?? 'https://www.bilibili.com/video/BV1sa4y1H7ek',
  userAgent: process.env.BW_USER_AGENT ?? '',
  hideWebdriver: process.env.BW_HIDE_WEBDRIVER === '1',
  acceptLanguage: process.env.BW_ACCEPT_LANGUAGE ?? '',
  feishuEnabled: process.env.FEISHU_ENABLED === '1',
  feishuAppId: process.env.FEISHU_APP_ID ?? '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET ?? '',
  feishuReceiveId: process.env.FEISHU_RECEIVE_ID ?? '',
  feishuReceiveIdType: process.env.FEISHU_RECEIVE_ID_TYPE ?? 'chat_id',
};

export function detailUrl(projectId = config.projectId) {
  return `https://mall.bilibili.com/neul-next/ticket/detail.html?id=${projectId}`;
}

export function ticketApiUrl(projectId = config.projectId) {
  return `https://show.bilibili.com/api/ticket/project/getV2?version=134&id=${projectId}&project_id=${projectId}&requestSource=pc-new`;
}
