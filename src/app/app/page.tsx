import Link from "next/link";
import { cardClassName } from "@app/presentation/ui";

export const runtime = "nodejs";

export default function AppHome() {
  const cards = [
    { href: "/app/households", title: "Households", desc: "The firm's whole book: people, entities, accounts, instructions, and a health score computed from the evidence behind it.", regulation: "SEC Rule 204-2 / FINRA 4512" },
    { href: "/app/demo", title: "Money-movement demo", desc: "The governed decision journey on labeled fakes: intent to verification, Firm A vs Firm B, policy authoring.", regulation: "Phase 1 demo contract (D-034)" },
    { href: "/app/account-opening", title: "Open an account", desc: "Run the account-opening flow: KYC, e-signature, and finalize.", regulation: "SEC Reg BI / FINRA 2090" },
    { href: "/app/console", title: "House-CRM console", desc: "Create and edit households. Every edit is an audited, tamper-evident record.", regulation: "SEC Rule 204-2" },
    { href: "/app/audit", title: "Audit trail", desc: "Inspect the append-only, hash-chained audit log and verify its integrity.", regulation: "SEC 17a-4 / SOC 2 CC7.4" },
    { href: "/app/ledger", title: "Decision ledger", desc: "Inspect typed decision events and verify the independent L1-L4 integrity chain.", regulation: "Verin v3 invariant 5 / SEC 17a-4" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">What do you want to do?</h1>
        <p className="mt-1 text-sm text-slate-600">Practice intelligence for registered investment advisers.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href}
              className={cardClassName({ variant: "white", padding: "none", interactive: true, className: "block p-5" })}
            >
              <p className="text-base font-semibold text-slate-900">{c.title}</p>
              <p className="mt-1 text-sm text-slate-600">{c.desc}</p>
              <p className="mt-3 text-xs text-slate-600">{c.regulation}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
