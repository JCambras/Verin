import Link from "next/link";
import { Wordmark } from "@app/presentation/brand";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6">
      <h1 className="text-5xl">
        <Wordmark />
      </h1>
      <p className="text-lg text-slate-600">
        Practice intelligence for registered investment advisers.
      </p>
      <p className="text-sm text-slate-600">
        <Link className="underline hover:text-slate-900" href="/login">
          Sign in
        </Link>{" "}
        to open an account, use the house-CRM console, or inspect the tamper-evident audit trail.
      </p>
    </main>
  );
}
