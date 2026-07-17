import nodemailer from "nodemailer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { query } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const faviconPath = path.join(__dirname, "frontend", "favicon.jpg");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "mail.podhyperush.com",
  port: parseInt(process.env.SMTP_PORT || "587", 10),
  secure: false, // false for port 587 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER || "noreply@podhyperush.com",
    pass: process.env.SMTP_PASS || "",
  },
  tls: {
    rejectUnauthorized: false, // Bypass self-signed/unverified certificate warnings
  },
});

/**
 * Sends a gorgeous notification email to the target user.
 * @param {Object} notification The inserted notification row from database
 */
export async function sendNotificationEmail(notification) {
  try {
    const { user_id, title, content, type, task_id } = notification;

    // 1. Fetch target user's email and full name
    const userRes = await query("SELECT email, full_name FROM users WHERE id = $1", [user_id]);
    if (!userRes.rowCount) {
      console.warn(`[email] User not found for ID: ${user_id}`);
      return;
    }
    const user = userRes.rows[0];
    if (!user.email) {
      console.warn(`[email] User ${user_id} does not have an email address`);
      return;
    }

    // 2. Load system configurations
    const cfg = loadConfig();
    const appUrl = cfg?.appUrl || "http://localhost:3000";
    const brand = cfg?.brand || "ClanBoard";

    // 3. Build redirection link
    let targetLink = `${appUrl}/board`;
    if (task_id) {
      targetLink = `${appUrl}/board?task=${task_id}`;
    }

    // 4. Set action label
    let actionLabel = "Panoya Git";
    if (type === "comment") {
      actionLabel = "Yoruma Git";
    } else if (type === "task") {
      actionLabel = "Göreve Git";
    } else if (type === "announcement") {
      actionLabel = "Duyuruyu Oku";
    }

    // 5. Select type badge display name
    let typeDisplay = "BİLDİRİM";
    if (type === "comment") typeDisplay = "YORUM";
    if (type === "task") typeDisplay = "GÖREV";
    if (type === "announcement") typeDisplay = "DUYURU";

    // 6. Handle CID Logo attachments
    const attachments = [];
    let logoHtml = `<span class="logo-badge">CB</span>`;
    
    if (fs.existsSync(faviconPath)) {
      attachments.push({
        filename: "logo.jpg",
        path: faviconPath,
        cid: "logoimage",
      });
      logoHtml = `<img src="cid:logoimage" alt="${brand}" class="logo-img" />`;
    }

    // 7. Generate premium responsive template
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      background-color: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      padding: 30px 15px;
      max-width: 600px;
      margin: 0 auto;
    }
    .container {
      background-color: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
      border-bottom: 1px solid #27272a;
      padding-bottom: 20px;
    }
    .logo-container {
      display: inline-flex;
      align-items: center;
      gap: 12px;
    }
    .logo-badge {
      background-color: #6366f1;
      color: #ffffff;
      padding: 6px 12px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .logo-img {
      height: 36px;
      width: 36px;
      border-radius: 8px;
      object-fit: cover;
    }
    .brand-name {
      font-size: 20px;
      font-weight: 700;
      color: #fafafa;
      letter-spacing: -0.5px;
    }
    .notification-badge {
      display: inline-block;
      background-color: rgba(99, 102, 241, 0.15);
      color: #818cf8;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      color: #ffffff;
      margin-top: 0;
      margin-bottom: 16px;
      line-height: 1.3;
    }
    .content-box {
      background-color: #27272a;
      border-left: 4px solid #6366f1;
      border-radius: 6px;
      padding: 18px;
      margin-bottom: 28px;
      color: #e4e4e7;
      font-size: 15px;
      line-height: 1.6;
    }
    .cta-container {
      text-align: center;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      background-color: #6366f1;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      padding: 12px 30px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }
    .btn:hover {
      background-color: #4f46e5;
    }
    .link-fallback {
      font-size: 12px;
      color: #71717a;
      word-break: break-all;
      text-align: center;
      margin-top: 15px;
    }
    .link-fallback a {
      color: #a1a1aa;
      text-decoration: underline;
    }
    .footer {
      text-align: center;
      margin-top: 32px;
      border-top: 1px solid #27272a;
      padding-top: 20px;
      font-size: 12px;
      color: #71717a;
      line-height: 1.5;
    }
    .footer a {
      color: #a1a1aa;
      text-decoration: none;
    }
    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-container">
          ${logoHtml}
          <span class="brand-name">${brand}</span>
        </div>
      </div>
      
      <div class="notification-badge">${typeDisplay}</div>
      
      <h1 class="title">${title}</h1>
      
      <div class="content-box">
        ${content}
      </div>
      
      <div class="cta-container">
        <a href="${targetLink}" class="btn" target="_blank">${actionLabel}</a>
        <div class="link-fallback">
          Butona tıklayamıyorsanız bu linki tarayıcınıza yapıştırın:<br>
          <a href="${targetLink}" target="_blank">${targetLink}</a>
        </div>
      </div>
      
      <div class="footer">
        Bu e-posta <strong>${brand}</strong> tarafından otomatik olarak oluşturulmuştur.<br>
        Lütfen bu adrese yanıt göndermeyiniz.<br>
        <a href="${appUrl}">${brand} Çalışma Alanı</a>
      </div>
    </div>
  </div>
</body>
</html>
    `;

    // 8. Send email with attachments
    const mailOptions = {
      from: `"${brand}" <noreply@podhyperush.com>`,
      to: user.email,
      subject: `[${brand}] ${title}`,
      html: htmlContent,
      attachments,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[email] Notification sent to ${user.email} (${info.messageId})`);
  } catch (err) {
    console.error("[email] Send failed:", err);
  }
}
