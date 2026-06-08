import { ticketApiUrl } from './config.js';

const unavailableFlags = new Set([8, 4, 1]);

export async function fetchTicketStatus(request, projectId, dayFlag) {
  const response = await request.get(ticketApiUrl(projectId), {
    headers: {
      referer: `https://mall.bilibili.com/neul-next/ticket/detail.html?id=${projectId}`
    }
  });

  if (!response.ok()) {
    throw new Error(`Ticket API failed: ${response.status()} ${response.statusText()}`);
  }

  const body = await response.json();
  const list = body.data?.screen_list?.[dayFlag]?.ticket_list ?? [];
  let found = false;
  let allSold = true;
  const available = [];

  for (const item of list) {
    const flag = item.sale_flag?.number;
    if (!unavailableFlags.has(flag)) {
      found = true;
      available.push(item);
    } else if (flag !== 4) {
      allSold = false;
    }
  }

  return { found, allSold, available, raw: body };
}
