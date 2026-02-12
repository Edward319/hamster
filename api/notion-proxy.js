/**
 * Vercel Serverless：仅代理用户请求到 Notion API，不存储、不记录任何用户数据或 token。
 * 请求体中的 token / 数据仅用于当次转发，响应后即丢弃。
 *
 * POST Body: { token: string, action: string, ...actionParams }
 * action: createDatabase | queryDatabase | createPage | updatePage | archivePage
 */

const NOTION_VERSION = "2022-06-28";
const NOTION_BASE = "https://api.notion.com/v1";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function notionFetch(token, method, path, body) {
  const url = path.startsWith("http") ? path : NOTION_BASE + path;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  return { status: res.status, data };
}

/** 存货小管家所需数据库属性（最低必要字段） */
function getInventoryDatabaseSchema() {
  return {
    parent: undefined,
    title: [{ text: { content: "存货小管家" } }],
    properties: {
      名称: { title: {} },
      品牌: { rich_text: {} },
      一级品类: { rich_text: {} },
      二级品类: { rich_text: {} },
      数量: { number: {} },
      购买日期: { date: {} },
      到期日: { date: {} },
      单价: { number: {} },
      备注: { rich_text: {} },
      状态: {
        select: {
          options: [
            { name: "在库", color: "green" },
            { name: "已用完", color: "gray" },
          ],
        },
      },
      用完时间: { date: {} },
      提前提醒天: { number: {} },
      本地ID: { rich_text: {} },
    },
  };
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "请使用 POST" });

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "请求体格式错误" });
  }

  const token = (body.token || "").trim();
  if (!token) return res.status(400).json({ error: "缺少 token" });

  const action = body.action;
  if (!action) return res.status(400).json({ error: "缺少 action" });

  try {
    if (action === "createDatabase") {
      const parentPageId = (body.parentPageId || "").trim().replace(/-/g, "");
      if (!parentPageId) return res.status(400).json({ error: "创建数据库需要 parentPageId" });
      const schema = getInventoryDatabaseSchema();
      schema.parent = { type: "page_id", page_id: parentPageId };
      const { status, data } = await notionFetch(token, "POST", "/databases", schema);
      return res.status(status).json(data);
    }

    if (action === "queryDatabase") {
      const databaseId = (body.databaseId || "").trim().replace(/-/g, "");
      if (!databaseId) return res.status(400).json({ error: "缺少 databaseId" });
      const { status, data } = await notionFetch(token, "POST", `/databases/${databaseId}/query`, body.payload || {});
      return res.status(status).json(data);
    }

    if (action === "createPage") {
      const databaseId = (body.databaseId || "").trim().replace(/-/g, "");
      if (!databaseId) return res.status(400).json({ error: "缺少 databaseId" });
      const { status, data } = await notionFetch(token, "POST", "/pages", body.payload || {});
      return res.status(status).json(data);
    }

    if (action === "updatePage") {
      const pageId = (body.pageId || "").trim().replace(/-/g, "");
      if (!pageId) return res.status(400).json({ error: "缺少 pageId" });
      const { status, data } = await notionFetch(token, "PATCH", `/pages/${pageId}`, body.payload || {});
      return res.status(status).json(data);
    }

    if (action === "archivePage") {
      const pageId = (body.pageId || "").trim().replace(/-/g, "");
      if (!pageId) return res.status(400).json({ error: "缺少 pageId" });
      const { status, data } = await notionFetch(token, "PATCH", `/pages/${pageId}`, { archived: true });
      return res.status(status).json(data);
    }

    return res.status(400).json({ error: "不支持的 action" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "请求失败" });
  }
};
