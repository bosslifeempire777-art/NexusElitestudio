/**
 * Validate email (Resend) configuration at startup.
 *
 * Catches the most common failure modes before any recovery email is
 * actually needed:
 *   1. RESEND_API_KEY missing — emails silently log to stdout only.
 *   2. RECOVERY_EMAIL_FROM missing — falls back to hard-coded address.
 *   3. Domain not verified on Resend — API returns 403 on sends.
 *
 * Domain-list probing requires a full (non-restricted) Resend API key.
 * If the key is send-only (restricted), we skip the domain list check
 * and instead probe by attempting a send to the Resend no-delivery
 * address so we can detect a 403 (unverified domain) vs 200 (ok).
 *
 * Logs only; never throws. A misconfigured email provider must not
 * prevent the API server from serving non-email traffic.
 */
export async function checkEmailConfig(): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.RECOVERY_EMAIL_FROM;

  if (!apiKey) {
    console.warn(
      '[email-config] RESEND_API_KEY is not set — recovery emails will only be ' +
      'logged to stdout. Set the secret to enable real email delivery.',
    );
    return;
  }
  console.log('[email-config] RESEND_API_KEY is configured');

  const effectiveFrom = fromAddr ?? 'hello@nexuselitestudio.com';
  if (!fromAddr) {
    console.warn(
      '[email-config] RECOVERY_EMAIL_FROM is not set — falling back to ' +
      `hard-coded "${effectiveFrom}". Set RECOVERY_EMAIL_FROM to ` +
      'override (must be on a Resend-verified domain).',
    );
  } else {
    console.log(`[email-config] RECOVERY_EMAIL_FROM = ${fromAddr}`);
  }

  const domainFromAddr = effectiveFrom.replace(/^.*@/, '').replace(/\s*>.*$/, '').trim();

  // First try the /domains list endpoint (requires a full, non-restricted key).
  try {
    const resp = await fetch('https://api.resend.com/domains', {
      headers: { authorization: `Bearer ${apiKey}` },
    });

    if (resp.ok) {
      const data = await resp.json() as { data?: Array<{ name: string; status: string }> };
      const domains = data.data ?? [];
      const matched = domains.find(d => d.name === domainFromAddr);
      if (!matched) {
        console.warn(
          `[email-config] Domain "${domainFromAddr}" is NOT listed in your Resend account. ` +
          'Add and verify it at https://resend.com/domains — until then all recovery ' +
          'emails will fail with a 403 error.',
        );
      } else if (matched.status !== 'verified') {
        console.warn(
          `[email-config] Domain "${domainFromAddr}" exists in Resend but status = "${matched.status}". ` +
          'Complete DNS verification at https://resend.com/domains — recovery emails ' +
          'will fail until the domain is verified.',
        );
      } else {
        console.log(`✓ email-config: domain ${domainFromAddr} is verified on Resend`);
      }
      return;
    }

    // 401 with restricted_api_key → fall through to the send-probe below.
    if (resp.status === 401) {
      const body = await resp.json().catch(() => ({})) as { name?: string };
      if (body?.name === 'restricted_api_key') {
        console.log(
          '[email-config] RESEND_API_KEY is a restricted (send-only) key — ' +
          'skipping domain-list check. Probing domain verification via a test send…',
        );
        await probeDomainViaSend(apiKey, effectiveFrom, domainFromAddr);
        return;
      }
    }

    const body = await resp.text().catch(() => '');
    console.warn(`[email-config] Resend /domains probe returned ${resp.status}: ${body}`);
  } catch (err: any) {
    console.warn('[email-config] Could not reach Resend API:', err?.message ?? err);
  }
}

/**
 * Fall-back domain check for restricted (send-only) API keys.
 *
 * Sends to Resend's built-in sink address so nothing is actually delivered.
 * A 403 response means the sending domain is not verified. A 2xx means it is.
 */
async function probeDomainViaSend(
  apiKey: string,
  from: string,
  domainName: string,
): Promise<void> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: ['delivered@resend.dev'],
        subject: '[startup-check] domain verification probe',
        html: '<p>startup probe — ignore</p>',
        tags: [{ name: 'type', value: 'startup-probe' }],
      }),
    });

    if (resp.ok) {
      console.log(`✓ email-config: domain ${domainName} is verified on Resend`);
    } else if (resp.status === 403) {
      const body = await resp.json().catch(() => ({})) as { message?: string };
      console.warn(
        `[email-config] Domain "${domainName}" is NOT verified on Resend (403). ` +
        'Add and verify it at https://resend.com/domains, then add the required ' +
        'DNS records (SPF/DKIM/DMARC) at your domain registrar. ' +
        `Resend message: ${body?.message ?? 'no details'}`,
      );
    } else {
      const body = await resp.text().catch(() => '');
      console.warn(`[email-config] Resend send-probe returned ${resp.status}: ${body}`);
    }
  } catch (err: any) {
    console.warn('[email-config] Could not reach Resend API for send-probe:', err?.message ?? err);
  }
}
