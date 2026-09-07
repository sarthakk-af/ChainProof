import { config } from "./config.js";
import { logger } from "./logger.js";

/**
 * Thin wrapper around Brevo's transactional email REST API — plain fetch,
 * no SDK dependency. Brevo's free tier can send to any recipient without a
 * verified custom domain first, which matters for a project that doesn't
 * own a domain yet (unlike most competitors' free tiers).
 */
export async function sendEmail({ to, subject, html }) {
  if (!config.brevoApiKey || !config.emailFromAddress) {
    logger.error("email_not_configured", { to, subject });
    throw new Error("Email sending is not configured (BREVO_API_KEY / EMAIL_FROM_ADDRESS).");
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": config.brevoApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: config.emailFromAddress, name: config.emailFromName },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brevo send failed (${res.status}): ${body}`);
  }
}

export function buildPasswordResetEmail(token) {
  const link = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
  return {
    subject: "Reset your ChainProof password",
    html: `
      <p>Someone requested a password reset for this ChainProof account.</p>
      <p><a href="${link}">Click here to set a new password</a> — this link expires in 1 hour.</p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  };
}
