/**
 * Quick smoke-test: sends a recovery email via Resend to verify the
 * RESEND_API_KEY and RECOVERY_EMAIL_FROM env vars are working.
 *
 * Usage:
 *   TEST_EMAIL=you@example.com tsx scripts/test-recovery-email.ts
 */
import { sendRecoveryEmail } from '../src/lib/recoveryEmail.js';

const to = process.env.TEST_EMAIL;
if (!to) {
  console.error('Set TEST_EMAIL=you@example.com before running this script.');
  process.exit(1);
}

console.log(`Sending test recovery email to: ${to}`);
console.log(`RESEND_API_KEY set: ${!!process.env.RESEND_API_KEY}`);
console.log(`RECOVERY_EMAIL_FROM: ${process.env.RECOVERY_EMAIL_FROM ?? '(using default)'}`);

try {
  await sendRecoveryEmail({
    to,
    username: 'Test User',
    planName: 'Pro',
    checkoutUrl: 'https://nexuselitestudio.com',
    promoActive: true,
    discountPercent: 20,
  });
  console.log('✓ Recovery email sent successfully!');
} catch (err: any) {
  console.error('✗ Failed to send recovery email:', err.message ?? err);
  process.exit(1);
}
