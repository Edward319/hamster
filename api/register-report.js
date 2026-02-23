/**
 * 定期报告订阅：用户开启「定期自动发送」时，前端把邮箱、周期、当前报告快照提交到此接口存储。
 * 定时任务（cron）会按周期用 Gmail 向这些邮箱发送上次快照的报告。
 * POST Body: { email: string, remindCycleDays: number, report?: object, enabled: boolean }
 */

const { kv } = require("@vercel/kv");

const KEY = "report_subscribers";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

  const email = (body.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "请提供 email" });

  const enabled = !!body.enabled;
  const remindCycleDays = Math.max(1, Math.min(90, parseInt(body.remindCycleDays, 10) || 7));
  const report = body.report && typeof body.report === "object" ? body.report : null;

  try {
    let subs = await kv.get(KEY);
    if (!subs || typeof subs !== "object") subs = {};

    if (!enabled) {
      delete subs[email];
      await kv.set(KEY, subs);
      return res.status(200).json({ success: true, action: "unsubscribed" });
    }

    const now = new Date().toISOString();
    subs[email] = {
      remindCycleDays,
      lastReport: report || (subs[email] && subs[email].lastReport) || null,
      lastSentAt: (subs[email] && subs[email].lastSentAt) || null,
      updatedAt: now,
    };
    if (report) subs[email].lastReport = report;

    await kv.set(KEY, subs);
    return res.status(200).json({ success: true, action: "subscribed" });
  } catch (err) {
    console.error("register-report", err);
    return res.status(500).json({ error: err.message || "保存失败。请确认已配置 Vercel KV 存储。" });
  }
};
