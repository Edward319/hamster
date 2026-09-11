/**
 * 公共邮件逻辑：构建 HTML、用 Gmail SMTP 发送（可发往任意邮箱）
 * 供 send-report 与 cron-send-reports 使用
 */

const nodemailer = require("nodemailer");

function escapeHtml(s) {
  if (s == null) return "";
  const t = String(s);
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildEmailHtml(report) {
  const { urging = "", summaryWeeks = 4, expiring = [], summaryNew = [], summaryUsed = [] } = report;
  const hasExpiring = expiring.length > 0;
  const weeksLabel = summaryWeeks ? "过去 " + summaryWeeks + " 周" : "过去一个月";
  const expiringRows = expiring
    .map(
      (i) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid rgba(28,25,22,0.08);">${escapeHtml(i.name)}</td>
<td style="padding:10px 0;border-bottom:1px solid rgba(28,25,22,0.08);color:#5a534b;">${escapeHtml(i.brand)} · ${escapeHtml(i.category1)}/${escapeHtml(i.category2)}</td>
<td style="padding:10px 0;border-bottom:1px solid rgba(28,25,22,0.08);">${escapeHtml(i.expiryDate)}</td></tr>`
    )
    .join("");
  const newRows = summaryNew
    .map((g) => `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(28,25,22,0.08);">${escapeHtml(g.category1)}</td><td style="padding:8px 0;border-bottom:1px solid rgba(28,25,22,0.08);">¥${g.totalPrice}</td></tr>`)
    .join("");
  const usedRows = summaryUsed
    .map((g) => `<tr><td style="padding:8px 0;border-bottom:1px solid rgba(28,25,22,0.08);">${escapeHtml(g.category1)}</td><td style="padding:8px 0;border-bottom:1px solid rgba(28,25,22,0.08);">¥${g.totalPrice}</td></tr>`)
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>今日报告 — 存货小管家</title>
</head>
<body style="margin:0;padding:0;background:#f4efe6;font-family:'PingFang SC','Noto Sans SC',sans-serif;font-size:16px;color:#1c1916;line-height:1.65;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="background:#fbf8f2;border:1px solid rgba(28,25,22,0.08);border-radius:18px;padding:28px 22px;">
      <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.28em;color:#c45c38;text-align:center;">存货小管家</p>
      <h1 style="margin:0 0 6px;font-size:26px;font-weight:600;text-align:center;letter-spacing:0.08em;color:#1c1916;">今日报告</h1>
      <p style="margin:0 0 22px;font-size:13px;color:#8a8278;text-align:center;">保质期与库存提醒</p>

      <div style="border-top:2px solid #c45c38;padding-top:16px;margin-bottom:22px;">
        <h2 style="margin:0 0 10px;font-size:18px;letter-spacing:0.08em;color:#1c1916;">今日提醒</h2>
        ${hasExpiring ? `<p style="margin:0 0 12px;color:#c45c38;">${escapeHtml(urging)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr><th style="text-align:left;padding:8px 0;color:#8a8278;font-weight:500;">物品</th><th style="text-align:left;padding:8px 0;color:#8a8278;font-weight:500;">品类 · 品牌</th><th style="text-align:left;padding:8px 0;color:#8a8278;font-weight:500;">到期日</th></tr></thead>
          <tbody>${expiringRows}</tbody>
        </table>` : `<p style="margin:0;color:#5a534b;">今天没有快过期的东西，真棒！</p>`}
      </div>

      <div style="border-top:1px solid rgba(28,25,22,0.08);padding-top:16px;">
        <h2 style="margin:0 0 10px;font-size:18px;letter-spacing:0.08em;color:#1c1916;">货单总结 · ${weeksLabel}</h2>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.16em;color:#8a8278;">进货</p>
        ${newRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr><th style="text-align:left;padding:6px 0;color:#8a8278;font-weight:500;">一级品类</th><th style="text-align:left;padding:6px 0;color:#8a8278;font-weight:500;">总价</th></tr></thead><tbody>${newRows}</tbody></table>` : "<p style=\"margin:0;color:#8a8278;\">暂无</p>"}
        <p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.16em;color:#8a8278;">消耗</p>
        ${usedRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr><th style="text-align:left;padding:6px 0;color:#8a8278;font-weight:500;">一级品类</th><th style="text-align:left;padding:6px 0;color:#8a8278;font-weight:500;">总价</th></tr></thead><tbody>${usedRows}</tbody></table>` : "<p style=\"margin:0;color:#8a8278;\">暂无</p>"}
      </div>

      <p style="margin:22px 0 0;font-size:12px;color:#8a8278;text-align:center;letter-spacing:0.12em;">存货小管家</p>
    </div>
  </div>
</body>
</html>`;
}

/** 使用 Gmail SMTP 发送到任意邮箱（需配置 SMTP_USER + SMTP_PASS） */
async function sendViaGmail(to, report) {
  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").trim();
  if (!smtpUser || !smtpPass) {
    throw new Error("未配置 Gmail：请设置 SMTP_USER 与 SMTP_PASS");
  }
  const html = buildEmailHtml(report);
  const subject = "今日报告 — 存货小管家";
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });
  const from = `存货小管家 <${smtpUser}>`;
  const info = await transporter.sendMail({ from, to, subject, html });
  return info;
}

module.exports = { buildEmailHtml, escapeHtml, sendViaGmail };
