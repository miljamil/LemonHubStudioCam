"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRecordingMail = sendRecordingMail;
exports.testSmtpConnection = testSmtpConnection;
const nodemailer_1 = __importDefault(require("nodemailer"));
const storage_settings_js_1 = require("./storage-settings.js");
function createTransport(smtp) {
    return nodemailer_1.default.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: { user: smtp.user, pass: smtp.pass },
    });
}
async function sendRecordingMail(input) {
    const settings = (0, storage_settings_js_1.loadStorageSettings)();
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
        attachments: input.attachment
            ? [
                {
                    filename: input.attachment.filename,
                    content: input.attachment.content,
                    contentType: input.attachment.contentType,
                },
            ]
            : undefined,
    });
}
async function testSmtpConnection(smtp) {
    try {
        const transport = createTransport(smtp);
        await transport.verify();
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: e.message };
    }
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
//# sourceMappingURL=mailer.js.map