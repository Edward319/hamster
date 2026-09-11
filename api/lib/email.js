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
  const rule = "1px solid rgba(61,90,67,0.16)";
  const muted = "#8a8374";
  const ink = "#2c2a24";
  const moss = "#3d5a43";
  const rust = "#a35c38";
  const expiringRows = expiring
    .map(
      (i) =>
        `<tr><td style="padding:10px 0;border-bottom:${rule};">${escapeHtml(i.name)}</td>
<td style="padding:10px 0;border-bottom:${rule};color:#5e584c;">${escapeHtml(i.brand)} · ${escapeHtml(i.category1)}/${escapeHtml(i.category2)}</td>
<td style="padding:10px 0;border-bottom:${rule};">${escapeHtml(i.expiryDate)}</td></tr>`
    )
    .join("");
  const newRows = summaryNew
    .map((g) => `<tr><td style="padding:8px 0;border-bottom:${rule};">${escapeHtml(g.category1)}</td><td style="padding:8px 0;border-bottom:${rule};">¥${g.totalPrice}</td></tr>`)
    .join("");
  const usedRows = summaryUsed
    .map((g) => `<tr><td style="padding:8px 0;border-bottom:${rule};">${escapeHtml(g.category1)}</td><td style="padding:8px 0;border-bottom:${rule};">¥${g.totalPrice}</td></tr>`)
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>今日报告 — Keeper</title>
</head>
<body style="margin:0;padding:0;background:#efe3c4;font-family:'PingFang SC','Noto Sans SC',sans-serif;font-size:16px;color:${ink};line-height:1.65;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px;">
    <div style="background:#f7edd4;border:1px solid rgba(61,90,67,0.16);border-radius:14px;padding:28px 22px;">
      <p style="margin:0 0 2px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:28px;font-weight:500;letter-spacing:0.01em;color:${moss};text-align:center;">Keeper</p>
      <p style="margin:0 0 16px;font-size:11px;letter-spacing:0.22em;color:${muted};text-align:center;">存货小管家</p>
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:600;text-align:center;letter-spacing:0.08em;color:${ink};">今日报告</h1>
      <p style="margin:0 0 22px;font-size:13px;color:${muted};text-align:center;">保质期与库存提醒</p>

      <div style="border-top:2px solid ${moss};padding-top:16px;margin-bottom:22px;">
        <h2 style="margin:0 0 10px;font-size:18px;letter-spacing:0.08em;color:${ink};">今日提醒</h2>
        ${hasExpiring ? `<p style="margin:0 0 12px;color:${rust};">${escapeHtml(urging)}</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr><th style="text-align:left;padding:8px 0;color:${muted};font-weight:500;">物品</th><th style="text-align:left;padding:8px 0;color:${muted};font-weight:500;">品类 · 品牌</th><th style="text-align:left;padding:8px 0;color:${muted};font-weight:500;">到期日</th></tr></thead>
          <tbody>${expiringRows}</tbody>
        </table>` : `<p style="margin:0;color:#5e584c;">今天没有快过期的东西，真棒！</p>`}
      </div>

      <div style="border-top:1px solid rgba(61,90,67,0.16);padding-top:16px;">
        <h2 style="margin:0 0 10px;font-size:18px;letter-spacing:0.08em;color:${ink};">货单总结 · ${weeksLabel}</h2>
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.16em;color:${muted};">进货</p>
        ${newRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr><th style="text-align:left;padding:6px 0;color:${muted};font-weight:500;">一级品类</th><th style="text-align:left;padding:6px 0;color:${muted};font-weight:500;">总价</th></tr></thead><tbody>${newRows}</tbody></table>` : `<p style="margin:0;color:${muted};">暂无</p>`}
        <p style="margin:16px 0 8px;font-size:12px;letter-spacing:0.16em;color:${muted};">消耗</p>
        ${usedRows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;"><thead><tr><th style="text-align:left;padding:6px 0;color:${muted};font-weight:500;">一级品类</th><th style="text-align:left;padding:6px 0;color:${muted};font-weight:500;">总价</th></tr></thead><tbody>${usedRows}</tbody></table>` : `<p style="margin:0;color:${muted};">暂无</p>`}
      </div>

      <p style="margin:22px 0 0;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:14px;color:${moss};text-align:center;">Keeper</p>
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
  const subject = "今日报告 — Keeper";
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });
  const from = `Keeper <${smtpUser}>`;
  const info = await transporter.sendMail({ from, to, subject, html });
  return info;
}

module.exports = { buildEmailHtml, escapeHtml, sendViaGmail };
