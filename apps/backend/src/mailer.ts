import nodemailer from 'nodemailer';
import { SmtpSettings, loadStorageSettings } from './storage-settings.js';

// --- Resend HTTP transport (works on Render free tier where SMTP is blocked) ---
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() ?? '';
const RESEND_FROM = process.env.RESEND_FROM?.trim() ?? '';

function useResend(): boolean {
  return Boolean(RESEND_API_KEY);
}

async function sendViaResend(opts: { from: string; to: string[]; subject: string; html: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: opts.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API error (${res.status}): ${body}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

if (useResend()) {
  console.info('[studiocam][mailer] Using Resend HTTP transport (RESEND_API_KEY set)');
} else {
  console.info('[studiocam][mailer] Using SMTP transport (no RESEND_API_KEY)');
}

// --- SMTP transport (works when outbound SMTP ports are not blocked) ---
function createTransport(smtp: SmtpSettings) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    // Render/free-tier cold starts can delay SMTP handshakes.
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });
}

export interface RecordingMailInput {
  to: string[];
  sessionId: string;
  chunkIndex: number;
  filename: string;
  viewLink: string;
  downloadLink: string;
  sizeBytes: number;
  storageLabel?: string;
  /** If true, CC the google drive linked email with social media consent notice. */
  socialMediaConsent?: boolean;
  /** The connected Google Drive email to CC when consent is given. */
  googleLinkedEmail?: string;
}

export async function sendRecordingMail(input: RecordingMailInput) {
  const settings = loadStorageSettings();
  const smtp = settings.smtp;
  const sizeMb = (input.sizeBytes / (1024 * 1024)).toFixed(2);
  const storageLabel = input.storageLabel ?? 'storage';

  // Build a human-friendly timestamp label instead of a hex session ID.
  const now = new Date();
  const timeLabel = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}_${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${now.getFullYear()}`;
  const partLabel = `part ${input.chunkIndex + 1}`;

  const html = `
    <h2>Lemon Hub Studio Cam Recording</h2>
    <p>${timeLabel} &mdash; ${partLabel}</p>
    <ul>
      <li><b>File:</b> ${escapeHtml(input.filename)}</li>
      <li><b>Size:</b> ${sizeMb} MB</li>
    </ul>
    <p>
      <a href="${input.viewLink}">▶ Open recording</a><br/>
      <a href="${input.downloadLink}">⬇ Download</a>
    </p>
    ${input.socialMediaConsent ? '<p style="color:#2563eb;font-weight:bold">✅ The artist has permitted this recording to be posted on social media.</p>' : ''}
    <p style="color:#888;font-size:12px">
      Hosted in ${escapeHtml(storageLabel)}. The link works for anyone you forward it to.
    </p>
  `;

  const from = useResend()
    ? (RESEND_FROM || 'StudioCam <onboarding@resend.dev>')
    : (smtp.from || `StudioCam <${smtp.user}>`);
  const subject = `Lemon Hub Studio Cam recording - ${input.filename}`;

  // Build recipient list: original recipients + Google Drive email if social media consent given.
  const allRecipients = [...input.to];
  if (input.socialMediaConsent && input.googleLinkedEmail?.trim() && !allRecipients.includes(input.googleLinkedEmail.trim())) {
    allRecipients.push(input.googleLinkedEmail.trim());
  }

  if (useResend()) {
    await sendViaResend({ from, to: allRecipients, subject, html });
    return;
  }

  const transport = createTransport(smtp);
  await transport.sendMail({ from, to: allRecipients.join(', '), subject, html });
}

export async function testSmtpConnection(smtp: SmtpSettings): Promise<{ ok: boolean; error?: string }> {
  // If Resend is configured, SMTP verification is not needed.
  if (useResend()) {
    return { ok: true };
  }
  try {
    const transport = createTransport(smtp);
    await transport.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
