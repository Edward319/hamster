/**
 * Notion 同步：仅与用户自己的 Notion 通信，通过 /api/notion-proxy 转发，代理不存储任何数据。
 * 数据仅存在于用户 Notion 与浏览器内存/本地缓存。
 */

const DEFAULT_REMIND_DAYS = 30;

function getProxyUrl() {
  const origin = typeof window !== "undefined" && window.location && window.location.origin;
  if (origin && origin !== "null" && origin !== "file://") return origin + "/api/notion-proxy";
  return "";
}

/** 从 Notion 属性对象取文本 */
function propText(prop) {
  if (!prop || !prop.rich_text) return "";
  const t = prop.rich_text[0];
  return t ? (t.plain_text || "") : "";
}

function propTitle(prop) {
  if (!prop || !prop.title) return "";
  const t = prop.title[0];
  return t ? (t.plain_text || "") : "";
}

function propNumber(prop) {
  if (prop == null || prop.number == null) return 0;
  return Number(prop.number) || 0;
}

function propDate(prop) {
  if (!prop || !prop.date || !prop.date.start) return "";
  return String(prop.date.start).slice(0, 10);
}

function propSelect(prop) {
  if (!prop || !prop.select) return "";
  return prop.select.name === "已用完" ? "used_up" : "in_stock";
}

/** Notion 页面 → 本地 item */
function notionPageToItem(page) {
  const p = page.properties || {};
  const status = propSelect(p.状态);
  const usedUpAt = status === "used_up" ? propDate(p.用完时间) || new Date().toISOString().slice(0, 10) : undefined;
  return {
    id: page.id,
    notionPageId: page.id,
    name: propTitle(p.名称),
    brand: propText(p.品牌),
    category1: propText(p.一级品类),
    category2: propText(p.二级品类),
    quantity: propNumber(p.数量),
    purchaseDate: propDate(p.购买日期),
    expiryDate: propDate(p.到期日),
    unitPrice: propNumber(p.单价),
    note: propText(p.备注),
    status,
    remindBeforeDays: propNumber(p.提前提醒天) || DEFAULT_REMIND_DAYS,
    usedUpAt,
  };
}

/** 本地 item → Notion 创建/更新用的 properties */
function itemToNotionProperties(item) {
  const status = item.status === "used_up" ? "used_up" : "in_stock";
  const statusName = status === "used_up" ? "已用完" : "在库";
  const usedUpAt = status === "used_up" && item.usedUpAt ? item.usedUpAt : undefined;
  return {
    名称: { title: [{ text: { content: String(item.name || "").slice(0, 2000) } }] },
    品牌: { rich_text: [{ text: { content: String(item.brand || "").slice(0, 2000) } }] },
    一级品类: { rich_text: [{ text: { content: String(item.category1 || "").slice(0, 2000) } }] },
    二级品类: { rich_text: [{ text: { content: String(item.category2 || "").slice(0, 2000) } }] },
    数量: { number: Number(item.quantity) || 0 },
    购买日期: { date: item.purchaseDate ? { start: item.purchaseDate } : null },
    到期日: { date: item.expiryDate ? { start: item.expiryDate } : null },
    单价: { number: Number(item.unitPrice) || 0 },
    备注: { rich_text: [{ text: { content: String(item.note || "").slice(0, 2000) } }] },
    状态: { select: { name: statusName } },
    用完时间: { date: usedUpAt ? { start: usedUpAt } : null },
    提前提醒天: { number: typeof item.remindBeforeDays === "number" ? item.remindBeforeDays : DEFAULT_REMIND_DAYS },
    本地ID: { rich_text: [{ text: { content: String(item.id || "").slice(0, 2000) } }] },
  };
}

async function proxyPost(body) {
  const url = getProxyUrl();
  if (!url) throw new Error("Notion 同步需在部署后的网址使用");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "请求失败");
  return data;
}

/**
 * 从 Notion 拉取全部存货（仅当次请求经代理，不存储）
 */
async function fetchAllFromNotion(token, databaseId) {
  const items = [];
  let cursor = null;
  for (;;) {
    const payload = cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 };
    const data = await proxyPost({
      token,
      action: "queryDatabase",
      databaseId,
      payload,
    });
    const results = data.results || [];
    items.push(...results.map(notionPageToItem));
    cursor = data.next_cursor || null;
    if (!cursor) break;
  }
  return items;
}

/**
 * 在 Notion 中创建一条（仅当次请求经代理）
 */
async function createNotionPage(token, databaseId, item) {
  const parent = { database_id: databaseId };
  const properties = itemToNotionProperties(item);
  const data = await proxyPost({
    token,
    action: "createPage",
    databaseId,
    payload: { parent, properties },
  });
  return data.id;
}

/**
 * 更新 Notion 页面（仅当次请求经代理）
 */
async function updateNotionPage(token, pageId, item) {
  const properties = itemToNotionProperties(item);
  await proxyPost({
    token,
    action: "updatePage",
    pageId,
    payload: { properties },
  });
}

/**
 * 归档 Notion 页面（软删）
 */
async function archiveNotionPage(token, pageId) {
  await proxyPost({ token, action: "archivePage", pageId });
}

/**
 * 在用户 Notion 中创建「存货小管家」数据库（需用户先把父页面与集成共享）
 */
async function createNotionDatabase(token, parentPageId) {
  const data = await proxyPost({
    token,
    action: "createDatabase",
    parentPageId,
  });
  return data.id;
}
