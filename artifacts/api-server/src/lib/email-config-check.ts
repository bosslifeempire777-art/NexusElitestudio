/**
 * Validate email (Resend) configuration at startup.
 *
 * Catches the most common failure modes before any recovery email is
 * actually needed:
 *   1. RESEND_API_KEY missing — emails silently log to stdout only.
 *   2. RECOVERY_EMAIL_FROM missing — falls back to hard-coded address.
 *   3. Domain not verified on Resend — API returns 403.
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

  if (!fromAddr) {
    console.warn(
      '[email-config] RECOVERY_EMAIL_FROM is not set — falling back to ' +
      'hard-coded "hello@nexuselitestudio.com". Set RECOVERY_EMAIL_FROM to ' +
      'override (must be on a Resend-verified domain).',
    );
  } else {
    console.log(`[email-config] RECOVERY_EMAIL_FROM = ${fromAddr}`);
  }

  // Probe the Resend API to catch domain-not-verified errors early.
  // We use /domains (a read-only list endpoint) rather than /emails to
  // avoid sending a real email on every server boot.
  try {
    const resp = await fetch('https://api.resend.com/domains', {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    if (resp.ok) {
      const data = await resp.json() as { data?: Array<{ name: string; status: string }> };
      const domains = data.data ?? [];
      const effectiveFrom = fromAddr ?? 'hello@nexuselitestudio.com';
      const domainFromAddr = effectiveFrom.replace(/^.*@/, '').replace(/\s*>.*$/, '').trim();
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
        console.log(`✓ email-config: domain "${domainFromAddr}" is verified on Resend`);
      }
    } else {
      const body = await resp.text().catch(() => '');
      console.warn(`[email-config] Resend /domains probe returned ${resp.status}: ${body}`);
    }
  } catch (err: any) {
    console.warn('[email-config] Could not reach Resend API:', err?.message ?? err);
  }
}
