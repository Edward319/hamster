/**
 * Vercel Cron：每日执行，向「定期自动发送」订阅者中已到期的用户发送今日报告。
 * 仅使用 Gmail SMTP 发送（可发往任意邮箱）；未配置 SMTP 时跳过发送。
 * 需在 Vercel 环境变量中设置 CRON_SECRET，且 Cron 触发时会携带该值。
 */

const KEY = "report_subscribers";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function getKv() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) return null;
  try {
    return require("@vercel/kv").kv;
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "") || (req.query || {}).secret;
  if (secret && token !== secret) {
    return res.status(401).json({ error: "未授权" });
  }

  const kv = getKv();
  if (!kv) {
    return res.status(200).json({ ok: true, message: "未关联 KV 存储，跳过定期发送。", sent: 0 });
  }

  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").trim();
  if (!smtpUser || !smtpPass) {
    return res.status(200).json({
      ok: true,
      message: "未配置 Gmail（SMTP_USER/SMTP_PASS），跳过定期发送。请用 Gmail 配置后重试。",
      sent: 0,
    });
  }

  const { sendViaGmail } = require("./lib/email");

  try {
    let subs = await kv.get(KEY);
    if (!subs || typeof subs !== "object") subs = {};
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let sent = 0;

    for (const [email, data] of Object.entries(subs)) {
      if (!data || !data.lastReport) continue;
      const days = Math.max(1, parseInt(data.remindCycleDays, 10) || 7);
      const lastSent = data.lastSentAt ? new Date(data.lastSentAt).getTime() : 0;
      if (lastSent && now - lastSent < days * dayMs) continue;

      try {
        await sendViaGmail(email, data.lastReport);
        subs[email] = { ...data, lastSentAt: new Date().toISOString() };
        sent++;
      } catch (e) {
        console.error("cron send to", email, e.message);
      }
    }

    if (sent > 0) await kv.set(KEY, subs);

    return res.status(200).json({ ok: true, sent });
  } catch (err) {
    console.error("cron-send-reports", err);
    return res.status(500).json({ error: err.message || "执行失败" });
  }
};
