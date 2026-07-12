import fs from 'fs';
import nodemailer from 'nodemailer';
import { marked } from 'marked';

// Removes the leading "# Title" and "Last updated: ..." lines from a generated
// markdown report, since the email already shows its own section header for this
// content — keeping both was creating redundant, cluttered-looking nested titles.
function stripLeadingMeta(markdown) {
  const lines = markdown.split('\n');
  const firstContentIndex = lines.findIndex(line => line.trim().startsWith('##') || line.trim().startsWith('**No SABESS'));
  return firstContentIndex === -1 ? markdown : lines.slice(firstContentIndex).join('\n');
}

async function sendEmail() {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPassword = process.env.GMAIL_APP_PASSWORD;
  const recipientEmail = process.env.RECIPIENT_EMAIL;

  let sabessReport = '';
  if (fs.existsSync('SABESS_IMPLICATIONS.md')) {
    sabessReport = fs.readFileSync('SABESS_IMPLICATIONS.md', 'utf8');
  } else {
    sabessReport = 'No SABESS-relevant filings this cycle.';
  }

  let latestFilings = '';
  if (fs.existsSync('LATEST_FILINGS.md')) {
    latestFilings = fs.readFileSync('LATEST_FILINGS.md', 'utf8');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: gmailUser,
      pass: gmailPassword
    }
  });

  const subject = `PSCO Docket Update — ${new Date().toLocaleDateString()}`;

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

  const sabessHtml = marked.parse(stripLeadingMeta(sabessReport));
  const latestFilingsHtml = marked.parse(stripLeadingMeta(latestFilings));

  const htmlBody = `
    <div style="font-family: -apple-system, Segoe UI, Arial, sans-serif; font-size: 14px; color: #24292f; max-width: 800px; line-height: 1.6;">
      <h1 style="font-size: 20px; margin-bottom: 4px;">PSCO Docket Tracker Digest</h1>
      <p style="color: #656d76; font-size: 12px; margin-top: 0;">${new Date().toISOString()}</p>

      <div style="background: #fff8c5; border: 1px solid #d4a72c; border-radius: 6px; padding: 12px 16px; margin: 20px 0;">
        <h2 style="font-size: 16px; margin: 0 0 8px 0;">⚡ SABESS Implications</h2>
        <div style="font-size: 14px;">
          ${sabessHtml}
        </div>
      </div>

      <div style="margin: 20px 0;">
        <h2 style="font-size: 16px; border-bottom: 1px solid #d0d7de; padding-bottom: 6px;">All Filings</h2>
        <div>
          ${latestFilingsHtml}
        </div>
      </div>

      <hr style="border: none; border-top: 1px solid #d0d7de; margin: 20px 0;">
      <p style="font-size: 12px; color: #656d76;">
        Check your repo for full details:
        <a href="https://github.com/your-username/PSCO-Docket-Tracker">https://github.com/your-username/PSCO-Docket-Tracker</a>
      </p>

      <style>
        h3 { font-size: 15px; margin: 18px 0 4px 0; border-bottom: 1px solid #eaeef2; padding-bottom: 4px; }
        ul { margin: 8px 0; padding-left: 20px; }
        li { margin-bottom: 10px; }
      </style>
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
