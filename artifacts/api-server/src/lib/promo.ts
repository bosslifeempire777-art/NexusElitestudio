export const LAUNCH_PROMO = {
  couponId:        "LAUNCH50",
  discountPercent: 50,
  endsAt:          new Date("2026-04-18T23:59:00Z").getTime(),
};

export function isPromoActive(): boolean {
  return Date.now() < LAUNCH_PROMO.endsAt;
}
