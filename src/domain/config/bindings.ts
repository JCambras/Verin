/**
 * PRIMITIVE BINDINGS AND THE EVALUATION DAG (v3 prompt 10 deliverable 4;
 * ADR-0058).
 *
 * A binding is "this domain uses THIS catalog primitive with THESE parameters".
 * It carries no `publishes` field on purpose: the published key space is DERIVED
 * by the primitive's own `publishedKeys(parameters)` (prompt 8), so there is
 * exactly one source of truth for the context-key vocabulary and a configuration
 * can never claim a key the primitive does not mint (D-185's declared-origin
 * resolution depends on that being true).
 *
 * EVALUATION ORDER IS A PROPERTY OF THE CONFIGURATION, NOT OF THE FILE. Prompt
 * 8's parameters bind context keys directly, so the dataflow edges are already
 * in the parameters; the loader reads them, topologically orders the bindings,
 * and REJECTS a cycle. Shuffling the YAML list changes nothing (property P-2).
 */
import { z } from "zod";
import { compareCanonicalStrings } from "@contracts/decision-core/ids";
import { PrimitiveIdSchema } from "@contracts/decision-core/ids";
import { ParameterMapSchema } from "./parameters";
import { kebabId } from "./vocabulary";

const primitiveBindingSchemaImpl = z
  .strictObject({
    id: kebabId<"PrimitiveBindingId">(),
    describes: z.string().min(1),
    primitiveId: PrimitiveIdSchema,
    parameters: ParameterMapSchema,
    /**
     * The strategy a selection primitive runs under when firm policy selects
     * none. Must be in that primitive's own `allowedStrategies` (load-checked);
     * absent for every primitive whose strategy vocabulary is empty.
     */
    defaultStrategy: z.string().min(1).optional(),
  })
  .readonly();

export type BindingNode = {
  readonly id: string;
  readonly primitiveId: string;
  /** Context keys this binding READS (dataflow in-edges). */
  readonly reads: readonly string[];
  /** Context keys this binding PUBLISHES (dataflow out-edges). */
  readonly publishes: readonly string[];
};

export type DagFailure =
  | { readonly kind: "cycle"; readonly members: readonly string[] }
  | { readonly kind: "unknown-producer"; readonly binding: string; readonly key: string };

export type DagResult =
  | { readonly ok: true; readonly order: readonly string[] }
  | { readonly ok: false; readonly failures: readonly DagFailure[] };

/**
 * Deterministic topological order over the binding dataflow. Ties break by
 * (primitiveId, bindingId) lexicographic - the ratified phase-1 tiebreak - so
 * the order is a function of the configuration's CONTENT, never of its
 * authoring order or of a Map's insertion sequence.
 *
 * `intentKeys` are the keys the intent's own slots supply; a read of one of
 * those is not an edge. A read of a key nothing produces is a failure, not a
 * silent no-op: it is exactly the desynchronization prompt 9's loader refuses.
 */
export const orderBindings = (
  nodes: readonly BindingNode[],
  intentKeys: ReadonlySet<string>,
): DagResult => {
  const failures: DagFailure[] = [];
  const producerOf = new Map<string, string>();
  for (const node of nodes) {
    for (const key of node.publishes) producerOf.set(key, node.id);
  }
  const dependencies = new Map<string, Set<string>>();
  for (const node of nodes) {
    const deps = new Set<string>();
    for (const key of node.reads) {
      if (intentKeys.has(key)) continue;
      const producer = producerOf.get(key);
      if (producer === undefined) {
        failures.push({ kind: "unknown-producer", binding: node.id, key });
        continue;
      }
      if (producer !== node.id) deps.add(producer);
    }
    dependencies.set(node.id, deps);
  }
  if (failures.length > 0) return { ok: false, failures };

  const rank = new Map(
    [...nodes]
      .sort(
        (left, right) =>
          compareCanonicalStrings(left.primitiveId, right.primitiveId) ||
          compareCanonicalStrings(left.id, right.id),
      )
      .map((node, index) => [node.id, index] as const),
  );
  const remaining = new Set(nodes.map((node) => node.id));
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => [...(dependencies.get(id) ?? [])].every((dep) => !remaining.has(dep)))
      .sort((left, right) => (rank.get(left) ?? 0) - (rank.get(right) ?? 0));
    const next = ready[0];
    if (next === undefined) {
      return { ok: false, failures: [{ kind: "cycle", members: [...remaining].sort(compareCanonicalStrings) }] };
    }
    order.push(next);
    remaining.delete(next);
  }
  return { ok: true, order };
};

/**
 * COLLAPSED EXPORT (D-222). The schema above stays the single source of truth;
 * what leaves this module is a NAMED type plus a `z.ZodType` view of it. The
 * repo's type-resolving fences materialize the type of EVERY exported value
 * under `src/domain/`, and a `ZodObject` generic instantiation drags its whole
 * nested shape through dozens of method signatures - across this module's
 * twenty-odd composed schemas that walk exhausted a fence worker's heap, and a
 * fence that stops running is worse than one that fails. Naming the output type
 * is what keeps the exported surface small.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- named alias for the inferred shape (D-222)
export interface PrimitiveBinding extends z.infer<typeof primitiveBindingSchemaImpl> {}
export const PrimitiveBindingSchema: z.ZodType<PrimitiveBinding> = primitiveBindingSchemaImpl;
