/*
 * Shared HTML for the transactional emails Payload sends (verify email,
 * password reset). Mirrors the landing page's look — `~/rss-parser` wordmark,
 * one monospace stack, black on white, #0000ee as the only accent — but in
 * email-safe HTML: everything is inline-styled (clients strip <style> and CSS
 * variables) and there's no webfont/external request.
 *
 * The CTA copies the site's boxy button. The landing page's hard offset shadow
 * is a `box-shadow`, which Gmail/Outlook strip, so we reproduce the same look
 * with a thick accent right/bottom border, which every client honours.
 */

const INK = '#000000'
const MUTED = '#8a8a8a'
const ACCENT = '#0000ee'
const HAIRLINE = '#cccccc'
const MONO = `ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`

/** The `~/rss-parser` mark: the `~/` prefix is muted, the rest is black. */
const wordmark = `<span style="color:${MUTED};">~/</span>rss-parser`

export interface EmailContent {
  /** Bold line at the top of the message body. */
  heading: string
  /** One or more sentences of plain body copy (already escaped/trusted). */
  intro: string
  /** The primary action. */
  cta: { label: string; url: string }
}

export function emailLayout({ heading, intro, cta }: EmailContent): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;">
    <div style="font-family:${MONO};font-size:15px;line-height:1.7;color:${INK};max-width:32rem;margin:0 auto;padding:2.5rem 1.25rem;">
      <div style="font-weight:700;padding-bottom:0.75rem;border-bottom:1px dashed ${HAIRLINE};">${wordmark}</div>

      <p style="font-weight:700;margin:2rem 0 1rem;">${heading}</p>
      <p style="margin:0 0 1.75rem;">${intro}</p>

      <a href="${cta.url}" style="display:inline-block;font-family:${MONO};font-weight:700;color:${INK};text-decoration:none;background:#ffffff;padding:0.5rem 0.75rem;border:1px solid ${INK};border-right:3px solid ${ACCENT};border-bottom:3px solid ${ACCENT};">${cta.label}</a>

      <p style="margin:1.75rem 0 0;font-size:13px;color:${MUTED};">
        Or paste this link into your browser:<br />
        <a href="${cta.url}" style="color:${ACCENT};word-break:break-all;">${cta.url}</a>
      </p>

      <div style="margin-top:2.5rem;padding-top:0.75rem;border-top:1px dashed ${HAIRLINE};font-size:13px;color:${MUTED};">
        ${wordmark} — you're receiving this because someone used this address to sign up. If that wasn't you, ignore this email.
      </div>
    </div>
  </body>
</html>`
}
