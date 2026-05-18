"use strict";
/** Shared constants & types for StudioCam (web, mobile, desktop, backend). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECORDER_MIME_CANDIDATES = exports.DEFAULT_MAX_CHUNK_SECONDS = exports.MAX_RECIPIENTS = void 0;
exports.isValidEmail = isValidEmail;
exports.sanitizeRecipients = sanitizeRecipients;
exports.MAX_RECIPIENTS = 3;
/** Default auto-split window (seconds). */
exports.DEFAULT_MAX_CHUNK_SECONDS = 30 * 60;
/** Preferred MIME types in order of fallback for MediaRecorder. */
exports.RECORDER_MIME_CANDIDATES = [
    'video/mp4;codecs=h264,aac',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
];
/** RFC-5322-ish email validation. */
function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
function sanitizeRecipients(raw) {
    const seen = new Set();
    const out = [];
    for (const r of raw) {
        const v = r.trim().toLowerCase();
        if (!v || seen.has(v) || !isValidEmail(v))
            continue;
        seen.add(v);
        out.push(v);
        if (out.length >= exports.MAX_RECIPIENTS)
            break;
    }
    return out;
}
//# sourceMappingURL=index.js.map