export const LAUNCH_PROMO = {
  couponId:        "LAUNCH50",
  discountPercent: 50,
  // 72-hour flash promo (Apr 19 → Apr 22 23:59 UTC) — auto-expires after this
  endsAt:          new Date("2026-04-22T23:59:00Z").getTime(),
};

export function isPromoActive(): boolean {
  return Date.now() < LAUNCH_PROMO.endsAt;
}
