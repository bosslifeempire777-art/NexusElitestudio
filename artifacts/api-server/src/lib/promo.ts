export const LAUNCH_PROMO = {
  couponId:        "LAUNCH50",
  discountPercent: 50,
  // 72-hour flash promo (Apr 30 → May 3 23:59 UTC) — auto-expires after this
  endsAt:          new Date("2026-05-03T23:59:00Z").getTime(),
};

export function isPromoActive(): boolean {
  return Date.now() < LAUNCH_PROMO.endsAt;
}
