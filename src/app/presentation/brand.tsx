/**
 * The "Verin." wordmark (ADR-0012 — ported from Meridian's BrandReveal; the
 * trailing period is brand). Recipe: bold, tight tracking, slate-900.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-bold tracking-tight text-slate-900 ${className}`}>Verin.</span>;
}
