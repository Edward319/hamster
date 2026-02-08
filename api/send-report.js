/**
 * Vercel Serverless：接收今日报告内容，用 Resend 发送邮件
 * POST /api/send-report  Body: { to: string, report: { urging, expiring[], summaryNew[], summaryUsed[] } }
 */

const { Resend } = require("resend");

function buildEmailHtml(report) {
  const { urging = "", expiring = [], summaryNew = [], summaryUsed = [] } = report;
  const hasExpiring = expiring.length > 0;
  const expiringRows = expiring
    .map(
      (i) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #ddd6c8;">${escapeHtml(i.name)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #ddd6c8;">${escapeHtml(i.brand)} · ${escapeHtml(i.category1)}/${escapeHtml(i.category2)}</td>
<td style="padding:8px 12px;border-bottom:1px solid #ddd6c8;">${escapeHtml(i.expiryDate)}</td></tr>`
    )
    .join("");
  const newRows = summaryNew
    .map((g) => `<tr><td style="padding:6px 12px;">${escapeHtml(g.category1)}</td><td style="padding:6px 12px;">¥${g.totalPrice}</td></tr>`)
    .join("");
  const usedRows = summaryUsed
    .map((g) => `<tr><td style="padding:6px 12px;">${escapeHtml(g.category1)}</td><td style="padding:6px 12px;">¥${g.totalPrice}</td></tr>`)
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>今日报告 — 存货小管家</title>
</head>
<body style="margin:0;padding:0;background:#faf6f0;font-family:'PingFang SC',sans-serif;font-size:15px;color:#3d3630;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#fef9e7;border:1px solid #ddd6c8;border-radius:12px;padding:20px;box-shadow:0 2px 8px rgba(61,54,48,0.06);position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;left:20px;right:20px;height:6px;background:rgba(228,196,168,0.6);border-radius:2px;"></div>
      <p style="text-align:center;margin:0 0 12px;font-size:36px;">🐹</p>
      <h1 style="margin:0 0 16px;font-size:1.25rem;font-weight:600;text-align:center;color:#3d3630;">今日报告</h1>
      <p style="margin:0 0 16px;font-size:0.95rem;color:#6b635a;text-align:center;">存货小管家 · 保质期与库存提醒</p>

      <div style="background:#fff;border-radius:8px;padding:14px;margin-bottom:16px;border-left:4px solid #c4a77d;">
        <h2 style="margin:0 0 10px;font-size:1rem;color:#3d3630;">今日提醒</h2>
        ${hasExpiring ? `<p style="margin:0 0 8px;font-weight:500;color:#c4a77d;">${escapeHtml(urging)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr><th style="text-align:left;padding:8px 12px;color:#6b635a;">物品</th><th style="text-align:left;padding:8px 12px;color:#6b635a;">品类 · 品牌</th><th style="text-align:left;padding:8px 12px;color:#6b635a;">到期日</th></tr></thead>
          <tbody>${expiringRows}</tbody>
        </table>` : `<p style="margin:0;color:#6b635a;">今天没有快过期的东西，真棒！</p>`}
      </div>

      <div style="background:#fff;border-radius:8px;padding:14px;border-left:4px solid #c4a77d;">
        <h2 style="margin:0 0 10px;font-size:1rem;color:#3d3630;">货单总结 · 过去一个月</h2>
        <p style="margin:0 0 8px;font-size:12px;color:#6b635a;">进货</p>
        ${newRows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:6px 12px;color:#6b635a;">一级品类</th><th style="text-align:left;padding:6px 12px;color:#6b635a;">总价</th></tr></thead><tbody>${newRows}</tbody></table>` : "<p style=\"margin:0;color:#6b635a;\">暂无</p>"}
        <p style="margin:12px 0 8px;font-size:12px;color:#6b635a;">消耗</p>
        ${usedRows ? `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr><th style="text-align:left;padding:6px 12px;color:#6b635a;">一级品类</th><th style="text-align:left;padding:6px 12px;color:#6b635a;">总价</th></tr></thead><tbody>${usedRows}</tbody></table>` : "<p style=\"margin:0;color:#6b635a;\">暂无</p>"}
      </div>

      <p style="margin:16px 0 0;font-size:12px;color:#6b635a;text-align:center;">— 存货小管家 · 手帐风保质期管理 —</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s) {
  if (s == null) return "";
  const t = String(s);
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "请使用 POST" });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM || "存货小管家 <onboarding@resend.dev>";

  if (!apiKey) {
    return res.status(500).json({ error: "未配置 RESEND_API_KEY，请在 Vercel 环境变量中设置" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: "请求体格式错误" });
  }

  const to = (body.to || "").trim();
  const report = body.report || {};

  if (!to) {
    return res.status(400).json({ error: "请提供收件邮箱 to" });
  }

  const html = buildEmailHtml(report);
  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject: "今日报告 — 存货小管家",
      html,
    });
    if (error) {
      return res.status(400).json({ error: error.message || "发送失败" });
    }
    return res.status(200).json({ success: true, id: data?.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "发送失败" });
  }
};
