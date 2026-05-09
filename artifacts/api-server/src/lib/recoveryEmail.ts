/**
 * Cart-recovery email sender. Used by the Stripe `checkout.session.expired`
 * webhook to nudge buyers who started a checkout but never finished.
 *
 * In production we send via Resend (https://resend.com) when RESEND_API_KEY
 * is set. In dev / when the key is missing we just log to stdout so the
 * recovery flow is still testable end-to-end without a real email provider.
 */
export interface RecoveryEmailInput {
  to: string;
  username: string | null;
  planName: string;
  checkoutUrl: string;
  promoActive: boolean;
  discountPercent?: number;
}

const FROM = process.env.RECOVERY_EMAIL_FROM
  || 'Nexus Elite Studio <hello@nexuselitestudio.com>';

function buildSubject(input: RecoveryEmailInput): string {
  if (input.promoActive && input.discountPercent) {
    return `Still want ${input.discountPercent}% off ${input.planName}?`;
  }
  return `Finish upgrading to ${input.planName} on Nexus Elite Studio`;
}

function buildHtml(input: RecoveryEmailInput): string {
  const greeting = input.username ? `Hi ${input.username},` : 'Hi there,';
  const promoLine = input.promoActive && input.discountPercent
    ? `<p>Your launch discount of <strong>${input.discountPercent}% off</strong> is still active and will be applied automatically at checkout.</p>`
    : '';
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 16px">Still interested in ${input.planName}?</h2>
      <p>${greeting}</p>
      <p>It looks like you started checking out for the <strong>${input.planName}</strong> plan but didn't finish. Your spot is still open — pick up right where you left off:</p>
      ${promoLine}
      <p style="margin:28px 0">
        <a href="${input.checkoutUrl}" style="background:#6d28d9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">
          Finish checkout
        </a>
      </p>
      <p style="color:#555;font-size:13px">If you've changed your mind, no worries — you can ignore this message and we won't email you about it again.</p>
    </div>
  `;
}

export async function sendRecoveryEmail(input: RecoveryEmailInput): Promise<void> {
  const subject = buildSubject(input);
  const html = buildHtml(input);

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[recovery-email] (no RESEND_API_KEY) would send to=${input.to} subject="${subject}" url=${input.checkoutUrl}`,
    );
    return;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: [input.to],
      subject,
      html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`[recovery-email] Resend API ${resp.status}: ${body}`);
  }
  console.log(`[recovery-email] sent to=${input.to} plan=${input.planName}`);
}
