import { useState, useEffect } from "react";
import { Zap, X } from "lucide-react";
import { Link } from "wouter";

const PROMO_ENDS_AT = new Date("2026-04-22T23:59:00Z").getTime();
const DISCOUNT = 45;

function getTimeLeft() {
  const diff = Math.max(0, PROMO_ENDS_AT - Date.now());
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { h, m, s, expired: diff === 0 };
}

function pad(n: number) { return String(n).padStart(2, "0"); }

export function PromoBanner() {
  const [time, setTime]       = useState(getTimeLeft);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem("promo-dismissed");
    if (stored === "1") setDismissed(true);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTime(getTimeLeft()), 1000);
    return () => clearInterval(id);
  }, []);

  if (time.expired || dismissed) return null;

  function dismiss() {
    sessionStorage.setItem("promo-dismissed", "1");
    setDismissed(true);
  }

  return (
    <div className="relative z-50 bg-gradient-to-r from-orange-600 via-red-600 to-pink-600 text-white">
      <div className="container mx-auto px-4 py-2.5 flex flex-col sm:flex-row items-center justify-center gap-2 text-center">

        <div className="flex items-center gap-2 font-bold text-sm">
          <Zap className="w-4 h-4 shrink-0 animate-pulse" />
          <span className="uppercase tracking-wide">
            🚀 LAUNCH OFFER — {DISCOUNT}% OFF your first month
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-white/70 text-xs font-mono hidden sm:inline">·</span>

          {/* Countdown */}
          <div className="flex items-center gap-1 font-mono text-sm font-bold tabular-nums">
            <span className="bg-black/30 px-1.5 py-0.5 rounded">{pad(time.h)}</span>
            <span className="text-white/70 animate-pulse">:</span>
            <span className="bg-black/30 px-1.5 py-0.5 rounded">{pad(time.m)}</span>
            <span className="text-white/70 animate-pulse">:</span>
            <span className="bg-black/30 px-1.5 py-0.5 rounded">{pad(time.s)}</span>
          </div>
          <span className="text-white/70 text-xs font-mono">left</span>

          <span className="text-white/70 text-xs font-mono hidden sm:inline">·</span>

          <Link
            href="/pricing"
            className="bg-white text-red-600 font-bold text-xs px-3 py-1 rounded-full hover:bg-yellow-50 transition-colors whitespace-nowrap"
          >
            CLAIM DEAL →
          </Link>
        </div>
      </div>

      <button
        onClick={dismiss}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/60 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
