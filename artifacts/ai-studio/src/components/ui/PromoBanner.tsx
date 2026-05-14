import { useState, useEffect } from "react";
import { Flame, X, Copy, Check, Clock } from "lucide-react";
import { Link } from "wouter";

type PromoData = {
  active: boolean;
  promoCode: string;
  starterFinalPrice: number;
  endsAt: number;
};

function useCountdown(endsAt: number) {
  const calc = () => {
    const diff = endsAt - Date.now();
    if (diff <= 0) return { h: 0, m: 0, s: 0, expired: true };
    return {
      h: Math.floor(diff / 3_600_000),
      m: Math.floor((diff % 3_600_000) / 60_000),
      s: Math.floor((diff % 60_000) / 1_000),
      expired: false,
    };
  };
  const [time, setTime] = useState(calc);
  useEffect(() => {
    const id = setInterval(() => setTime(calc()), 1_000);
    return () => clearInterval(id);
  }, [endsAt]);
  return time;
}

const pad = (n: number) => String(n).padStart(2, "0");
const SESSION_KEY = "promo_dismissed_LAUNCH7";

export function PromoBanner() {
  const [promo, setPromo]       = useState<PromoData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied]     = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) { setDismissed(true); return; }
    fetch("/api/stripe/promo")
      .then(r => r.json())
      .then((d: PromoData) => { if (d.active) setPromo(d); })
      .catch(() => {});
  }, []);

  const countdown = useCountdown(promo?.endsAt ?? 0);

  const dismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(SESSION_KEY, "1");
  };

  const copyCode = () => {
    const code = promo?.promoCode ?? "LAUNCH7";
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };

  if (!promo || dismissed || countdown.expired) return null;

  return (
    <div className="relative z-50 w-full bg-gradient-to-r from-yellow-600/90 via-orange-600/90 to-red-600/90 border-b border-yellow-400/40 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5">

        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-yellow-200 animate-pulse shrink-0" />
          <span className="text-sm font-black text-white uppercase tracking-wide">
            3-Day Launch Special
          </span>
        </div>

        <span className="text-sm text-yellow-100 hidden sm:inline">
          Get Starter for just
        </span>
        <span className="text-base font-black text-white">
          $7 <span className="text-yellow-200 font-normal text-xs line-through ml-1">$29</span>
        </span>
        <span className="text-xs text-yellow-200 hidden sm:inline">first month</span>

        {/* Promo code pill */}
        <button
          onClick={copyCode}
          title="Click to copy code"
          className="flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/40 bg-white/10 hover:bg-white/20 transition-colors font-mono text-xs font-bold text-white"
        >
          {copied
            ? <><Check className="w-3 h-3 text-green-300" /> Copied!</>
            : <><Copy className="w-3 h-3" /> {promo.promoCode}</>
          }
        </button>
        <span className="text-xs text-yellow-200 hidden md:inline">at checkout</span>

        {/* Countdown */}
        <div className="flex items-center gap-1 text-xs font-mono text-yellow-100">
          <Clock className="w-3 h-3" />
          <span className="font-bold tabular-nums text-white">
            {pad(countdown.h)}:{pad(countdown.m)}:{pad(countdown.s)}
          </span>
          <span className="hidden sm:inline">left</span>
        </div>

        <Link
          href="/pricing"
          className="px-3 py-1 rounded-full bg-white text-orange-700 text-xs font-black hover:bg-yellow-50 transition-colors whitespace-nowrap shadow"
        >
          Claim Now →
        </Link>
      </div>

      <button
        onClick={dismiss}
        aria-label="Dismiss promo"
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white p-1 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
