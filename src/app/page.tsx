import Link from "next/link";

/**
 * Phase 0 placeholder landing. The real presentation-tier home (app/presentation)
 * and the walking-skeleton entry (login -> account opening) arrive in Phases D/E.
 */
export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-5xl font-bold tracking-tight text-slate-900">Verin.</h1>
      <p className="text-lg text-slate-600">
        Practice intelligence for registered investment advisers. Foundation build in progress.
      </p>
      <p className="text-sm text-slate-600">
        Governance: read <code className="font-mono">CHARTER.md</code> first.{" "}
        <Link className="underline hover:text-slate-900" href="/health">
          Health
        </Link>
      </p>
    </main>
  );
}
