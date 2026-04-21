const fs = require('fs');
const nodemailer = require('nodemailer');

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
  const body = `
PSCO Docket Tracker Digest
${new Date().toISOString()}

=== SABESS IMPLICATIONS ===

${sabessReport}

=== ALL FILINGS ===

${latestFilings}

---
Check your repo for full details: https://github.com/your-username/PSCO-Docket-Tracker
  `;

  try {
    await transporter.sendMail({
      from: gmailUser,
      to: recipientEmail,
      subject: subject,
      text: body
    });
    console.log(`Email sent to ${recipientEmail}`);
  } catch (error) {
    console.error('Error sending email:', error.message);
    process.exit(1);
  }
}

sendEmail();
