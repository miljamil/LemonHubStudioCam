import nodemailer from 'nodemailer';
import { SmtpSettings, loadStorageSettings } from './storage-settings.js';

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
  const transport = createTransport(smtp);
  await transport.sendMail({
    from: smtp.from || `StudioCam <${smtp.user}>`,
    to: input.to.join(', '),
    subject: `StudioCam recording — ${input.filename}`,
    html,
  });
}

export async function testSmtpConnection(smtp: SmtpSettings): Promise<{ ok: boolean; error?: string }> {
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
