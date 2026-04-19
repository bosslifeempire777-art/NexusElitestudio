export const LAUNCH_PROMO = {
  couponId:        "LAUNCH45",
  discountPercent: 45,
  // 72-hour flash promo (Apr 19 → Apr 22 23:59 UTC)
  endsAt:          new Date("2026-04-22T23:59:00Z").getTime(),
};

export function isPromoActive(): boolean {
  return Date.now() < LAUNCH_PROMO.endsAt;
}
