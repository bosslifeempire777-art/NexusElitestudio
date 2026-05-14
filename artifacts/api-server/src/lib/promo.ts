export const LAUNCH_PROMO = {
  promoCode:        "LAUNCH7",         // code users type at Stripe checkout
  couponId:         "LAUNCH7",         // Stripe coupon ID
  discountFixed:    22,                // $22 off
  starterFinalPrice: 7,                // Starter becomes $7 first month
  discountPercent:  0,                 // not percent-based
  // 3-day signup bonus — created May 14, expires May 17 2026 02:06 UTC
  endsAt:           1778983573000,
};

export function isPromoActive(): boolean {
  return Date.now() < LAUNCH_PROMO.endsAt;
}
