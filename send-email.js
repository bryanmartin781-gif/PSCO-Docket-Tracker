import fs from 'fs';
import nodemailer from 'nodemailer';
import { marked } from 'marked';

async function sendEmail() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  const recipientEmail = process.env.RECIPIENT_EMAIL;

  // Read the SABESS report
  let sabessReport = '';
  if (fs.existsSync('SABESS_IMPLICATIONS.md')) {
    sabessReport = fs.readFileSync('SABESS_IMPLICATIONS.md', 'utf8');
  } else {
    sabessReport = 'No SABESS-relevant filings this cycle.';
  }

  // Read the latest filings
  let latestFilings = '';
  if (fs.existsSync('LATEST_FILINGS.md')) {
    latestFilings = fs.readFileSync('LATEST_FILINGS.md', 'utf8');
  }

  // Create transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPassword
    }
  });

  // Prepare email
  const subject = `PSCO Docket Update — ${new Date().toLocaleDateString()}`;

  // Plain-text fallback (for email clients that can't render HTML)
  const textBody = `
PSCO Docket Tracker Digest
${new Date().toISOString()}

=== SABESS IMPLICATIONS ===
${sabessReport}

=== ALL FILINGS ===
${latestFilings}

---
Check your repo for full details: https://github.com/your-username/PSCO-Docket-Tracker
  `;

  // Convert markdown sections to HTML so they render properly in the email client
  const sabessHtml = marked.parse(sabessReport);
  const latestFilingsHtml = marked.parse(latestFilings);

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #1a1a1a; max-width: 800px;">
      <h1 style="font-size: 18px;">PSCO Docket Tracker Digest</h1>
      <p style="color: #666; font-size: 12px;">${new Date().toISOString()}</p>

      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <h2 style="font-size: 16px; background: #fff3cd; padding: 6px 10px;">⚡ SABESS Implications</h2>
      ${sabessHtml}

      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <h2 style="font-size: 16px; background: #e7f1ff; padding: 6px 10px;">All Filings</h2>
      ${latestFilingsHtml}

      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="font-size: 12px; color: #666;">
        Check your repo for full details:
        <a href="https://github.com/your-username/PSCO-Docket-Tracker">https://github.com/your-username/PSCO-Docket-Tracker</a>
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: gmailUser,
      to: recipientEmail,
      subject: subject,
      text: textBody,
      html: htmlBody
    });
    console.log(`Email sent to ${recipientEmail}`);
  } catch (error) {
    console.error('Error sending email:', error.message);
    process.exit(1);
  }
}

sendEmail();
