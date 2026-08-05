/**
 * DevProvenanceBadge (design language §11.2) - the visible development-only badge on
 * every fake-backed element of the demo skeleton. The dashed border is the established
 * "not yet real" idiom (EmptyState); the chip shape follows the watermark chip in
 * metric.tsx. The badge's presence in the codebase is the honest inventory of what is
 * still fake: it is removed ONLY in the PR that lands the corresponding real path
 * (§11.3; charter #5 / ADR-0027). There is no hide-provenance mode.
 */
export function DevProvenanceBadge({ label }: { label: string }) {
  return (
    <span
      data-testid="dev-provenance-badge"
      className="inline-flex items-center whitespace-nowrap rounded border border-dashed border-slate-400 px-1.5 py-0.5 text-xs text-slate-600"
    >
      {label}
    </span>
  );
}
