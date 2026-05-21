import nodemailer from 'nodemailer';
import { SmtpSettings, loadStorageSettings } from './storage-settings.js';

// --- Resend HTTP transport (works on Render free tier where SMTP is blocked) ---
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() ?? '';
const RESEND_FROM = process.env.RESEND_FROM?.trim() ?? '';

function useResend(): boolean {
  return Boolean(RESEND_API_KEY);
}

async function sendViaResend(opts: { from: string; to: string[]; subject: string; html: string }) {
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
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${body}`);
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
}

export async function sendRecordingMail(input: RecordingMailInput) {
  const settings = loadStorageSettings();
  const smtp = settings.smtp;
  const sizeMb = (input.sizeBytes / (1024 * 1024)).toFixed(2);
  const storageLabel = input.storageLabel ?? 'storage';
  const html = `
    <h2>New StudioCam recording</h2>
    <p>Session <code>${input.sessionId}</code> &mdash; part <b>${input.chunkIndex + 1}</b></p>
    <ul>
      <li><b>File:</b> ${escapeHtml(input.filename)}</li>
      <li><b>Size:</b> ${sizeMb} MB</li>
    </ul>
    <p>
      <a href="${input.viewLink}">▶ Open recording</a><br/>
      <a href="${input.downloadLink}">⬇ Download</a>
    </p>
    <p style="color:#888;font-size:12px">
      Hosted in ${escapeHtml(storageLabel)}. The link works for anyone you forward it to.
    </p>
  `;

  const from = useResend()
    ? (RESEND_FROM || 'StudioCam <onboarding@resend.dev>')
    : (smtp.from || `StudioCam <${smtp.user}>`);
  const subject = `StudioCam recording — ${input.filename}`;

  if (useResend()) {
    await sendViaResend({ from, to: input.to, subject, html });
    return;
  }

  const transport = createTransport(smtp);
  await transport.sendMail({ from, to: input.to.join(', '), subject, html });
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
