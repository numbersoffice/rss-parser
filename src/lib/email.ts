import type { PayloadEmailAdapter } from 'payload'

/**
 * Fallback email "adapter" for environments with no SMTP configured (local dev).
 *
 * Without an email adapter Payload silently drops every message, so verification
 * links, password-reset links and the email-change confirmation link never
 * surface. This adapter sends nothing — it logs the full message (to, subject,
 * html) so the links are copy-pastable from the server console. In production
 * `SMTP_HOST` is set and the real nodemailer adapter is used instead
 * (see payload.config.ts).
 */
export const loggingEmailAdapter: PayloadEmailAdapter = ({ payload }) => ({
  name: 'logging',
  defaultFromAddress: process.env.EMAIL_FROM || 'noreply@example.com',
  defaultFromName: 'RSS Parser',
  sendEmail: async ({ to, subject, html }) => {
    payload.logger.info(
      `\n── email (not sent; no SMTP configured) ──\n` +
        `to:      ${String(to)}\n` +
        `subject: ${String(subject)}\n\n` +
        `${typeof html === 'string' ? html : ''}\n` +
        `──────────────────────────────────────────\n`,
    )
  },
})
