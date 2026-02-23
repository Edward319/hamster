/**
 * Vercel Serverless：接收今日报告内容，发送邮件
 * 推荐 Gmail SMTP（可发往任意用户邮箱）；未配置则尝试 Resend（可能仅限验证过的收件人）。
 * POST /api/send-report  Body: { to: string, report: { urging, expiring[], summaryNew[], summaryUsed[], summaryWeeks } }
 */

const { Resend } = require("resend");
const { buildEmailHtml, sendViaGmail } = require("./lib/email");

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

  const smtpUser = (process.env.SMTP_USER || "").trim();
  const smtpPass = (process.env.SMTP_PASS || "").trim();
  const useGmail = smtpUser && smtpPass;
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM || "存货小管家 <onboarding@resend.dev>";

  if (!useGmail && !apiKey) {
    return res.status(500).json({
      error: "请配置发信方式：在 Vercel 环境变量中设置 SMTP_USER + SMTP_PASS（Gmail 零成本），或 RESEND_API_KEY（Resend）",
    });
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
  const subject = "今日报告 — 存货小管家";

  try {
    if (useGmail) {
      await sendViaGmail(to, report);
      return res.status(200).json({ success: true });
    }

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject,
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
