import {
  normalizeScopedReferences,
  normalizeVersionedScopedReferences,
  type ScopedReference,
  type VersionedScopedReference,
} from "./ids";

export const isPlainRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

type NormalizableExplanationNode = {
  readonly evidenceSnapshotRefs: readonly ScopedReference[];
  readonly sourceRefs: readonly VersionedScopedReference[];
  readonly childNodes: readonly NormalizableExplanationNode[];
};

export const normalizeExplanationNode = <
  T extends NormalizableExplanationNode,
>(
  node: T,
): T => {
  if (!isPlainRecord(node)) return node;
  type Task =
    | {
        readonly kind: "visit";
        readonly input: NormalizableExplanationNode;
        readonly assign: (normalized: NormalizableExplanationNode) => void;
      }
    | { readonly kind: "leave"; readonly input: object };
  const ancestors = new Set<object>();
  let normalized: NormalizableExplanationNode = node;
  const tasks: Task[] = [{
    kind: "visit",
    input: node,
    assign: (result) => {
      normalized = result;
    },
  }];
  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if (task.kind === "leave") {
      ancestors.delete(task.input);
      continue;
    }
    if (!isPlainRecord(task.input) || ancestors.has(task.input)) {
      task.assign(task.input);
      continue;
    }
    ancestors.add(task.input);
    tasks.push({ kind: "leave", input: task.input });
    const childNodes = new Array<NormalizableExplanationNode>(
      task.input.childNodes.length,
    );
    const output = {
      ...task.input,
      evidenceSnapshotRefs: normalizeScopedReferences(
        task.input.evidenceSnapshotRefs,
      ),
      sourceRefs: normalizeVersionedScopedReferences(task.input.sourceRefs),
      childNodes,
    };
    task.assign(output);
    for (
      let index = task.input.childNodes.length - 1;
      index >= 0;
      index -= 1
    ) {
      if (!Object.hasOwn(task.input.childNodes, index)) continue;
      tasks.push({
        kind: "visit",
        input: task.input.childNodes[index]!,
        assign: (result) => {
          childNodes[index] = result;
        },
      });
    }
  }
  return normalized as T;
};
