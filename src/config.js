export const config = {
  projectId: Number(process.env.BW_PROJECT_ID ?? 102194),
  dayFlag: Number(process.env.BW_DAY_FLAG ?? 0),
  clickLimitIntervalMs: Number(process.env.BW_CLICK_LIMIT_INTERVAL_MS ?? 285),
  checkTicketIntervalMs: Number(process.env.BW_CHECK_TICKET_INTERVAL_MS ?? 520),
  chromeProfile: process.env.BW_CHROME_PROFILE ?? 'E:/code/bw_tickets/.chrome-profile',
  edgeProfile: process.env.BW_EDGE_PROFILE ?? 'E:/code/bw_tickets/.edge-profile',
  browserExecutable: process.env.BW_BROWSER_EXECUTABLE ?? '',
  headless: process.env.BW_HEADLESS === '1',
  maxDetailReloadWaitMs: Number(process.env.BW_DETAIL_RELOAD_WAIT_MS ?? 10000),
  submitWithoutTicketChance: Number(process.env.BW_SUBMIT_WITHOUT_TICKET_CHANCE ?? 0.26),
  successUrl: process.env.BW_SUCCESS_URL ?? 'https://www.bilibili.com/video/BV1sa4y1H7ek'
};

export function detailUrl(projectId = config.projectId) {
  return `https://mall.bilibili.com/neul-next/ticket/detail.html?id=${projectId}`;
}

export function ticketApiUrl(projectId = config.projectId) {
  return `https://show.bilibili.com/api/ticket/project/getV2?version=134&id=${projectId}&project_id=${projectId}&requestSource=pc-new`;
}
