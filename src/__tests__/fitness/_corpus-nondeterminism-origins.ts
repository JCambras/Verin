import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import {
  commonJsModule,
  nodeKey,
  staticMemberNames,
  symbolDeclarations,
  unwrap,
  type CallableShape,
  type OriginResolver,
} from "./_corpus-nondeterminism-ast";
import { callableShapes, callBindings } from "./_corpus-nondeterminism-callables";
import { declarationOrigins, memberValueOrigins } from "./_corpus-nondeterminism-members";
import {
  initialOrigins,
  memberOrigins,
  mergeOrigins,
  moduleOrigin,
  originSet,
  type OriginSet,
} from "./_corpus-nondeterminism-vocabulary";

/**
 * THE ORIGIN WALK and the state it needs. `originOf` answers "which banned
 * roots can this expression have come from", following identifiers, calls,
 * member and element accesses, conditionals and short-circuit operators back to
 * a seed origin - and `createOriginResolver` is the per-source-file state that
 * walk mutates, handed to every step explicitly rather than closed over.
 */
export function originOf(
  resolver: OriginResolver,
  input: Node | undefined,
  trail: ReadonlySet<string>,
  bindings: ReadonlyMap<string, OriginSet>,
): OriginSet | undefined {
  if (input === undefined) return undefined;
  const node = unwrap(input);
  if (Node.isIdentifier(node)) {
    const binding = bindings.get(node.getText());
    if (binding !== undefined) return binding;
  }
  const direct = resolver.origins.get(node.getText());
  if (direct !== undefined) return direct;
  const key = nodeKey(node);
  if (trail.has(key)) return undefined;
  const next = new Set(trail);
  next.add(key);
  if (
    Node.isCallExpression(node) &&
    node.getExpression().getKind() === SyntaxKind.ImportKeyword
  ) {
    const specifier = node.getArguments()[0];
    return specifier !== undefined &&
        (Node.isStringLiteral(specifier) ||
          Node.isNoSubstitutionTemplateLiteral(specifier))
      ? originSet(moduleOrigin(specifier.getLiteralText()))
      : undefined;
  }
  const requiredModule = commonJsModule(node);
  if (requiredModule !== undefined) {
    return originSet(moduleOrigin(requiredModule));
  }
  if (Node.isCallExpression(node)) {
    const target = unwrap(node.getExpression());
    return mergeOrigins(...resolver.callableShapes(target).flatMap((callable) => {
      const nested = resolver.callBindings(callable, node, next, bindings);
      return callable.returns.map((expression) =>
        resolver.originOf(expression, next, nested)
      );
    }));
  }
  if (Node.isIdentifier(node)) {
    return mergeOrigins(...symbolDeclarations(node).map((declaration) =>
      resolver.declarationOrigins(declaration, next, bindings)
    ));
  }
  if (Node.isPropertyAccessExpression(node)) {
    const base = resolver.originOf(node.getExpression(), next, bindings);
    return mergeOrigins(
      memberOrigins(base, node.getName()),
      resolver.memberValueOrigins(node.getExpression(), [node.getName()], next, bindings),
      ...symbolDeclarations(node.getNameNode()).map((declaration) =>
        resolver.declarationOrigins(declaration, next, bindings)
      ),
    );
  }
  if (Node.isElementAccessExpression(node)) {
    const base = resolver.originOf(node.getExpression(), next, bindings);
    const argument = node.getArgumentExpression();
    const members = staticMemberNames(argument);
    if (members !== undefined) {
      return mergeOrigins(...[...members].map((member) =>
        mergeOrigins(
          memberOrigins(base, member),
          resolver.memberValueOrigins(
            node.getExpression(),
            [member],
            next,
            bindings,
          ),
        )
      ));
    }
    if (base !== undefined) {
      return originSet(...[...base].map((origin) => `${origin}.[computed]`));
    }
  }
  if (Node.isConditionalExpression(node)) {
    return mergeOrigins(
      resolver.originOf(node.getWhenTrue(), next, bindings),
      resolver.originOf(node.getWhenFalse(), next, bindings),
    );
  }
  if (
    Node.isBinaryExpression(node) &&
    [
      SyntaxKind.BarBarToken,
      SyntaxKind.AmpersandAmpersandToken,
      SyntaxKind.QuestionQuestionToken,
    ].includes(node.getOperatorToken().getKind())
  ) {
    return mergeOrigins(
      resolver.originOf(node.getLeft(), next, bindings),
      resolver.originOf(node.getRight(), next, bindings),
    );
  }
  return undefined;
}

/** Widen a learned origin, reporting whether anything actually changed - the
 * termination condition of the scanner's fixpoint loop. */
export function setOrigins(
  origins: Map<string, OriginSet>,
  name: string,
  value: OriginSet,
): boolean {
  const current = origins.get(name);
  const merged = mergeOrigins(current, value)!;
  if (current !== undefined && merged.size === current.size) return false;
  origins.set(name, merged);
  return true;
}

const registerLocalFunctions = (
  sf: SourceFile,
  localFunctions: Map<string, CallableShape>,
): void => {
  const registerFunction = (
    name: string,
    callable: {
      getParameters(): Node[];
      getDescendantsOfKind(kind: SyntaxKind.ReturnStatement): Array<{
        getExpression(): Node | undefined;
      }>;
      getBody(): Node | undefined;
    },
  ): void => {
    const body = callable.getBody();
    const returns = callable
      .getDescendantsOfKind(SyntaxKind.ReturnStatement)
      .flatMap((statement) => statement.getExpression() ?? []);
    if (
      body !== undefined &&
      !Node.isBlock(body)
    ) {
      returns.push(body);
    }
    localFunctions.set(name, {
      parameters: callable.getParameters(),
      returns,
    });
  };
  for (const declaration of sf.getDescendantsOfKind(
    SyntaxKind.FunctionDeclaration,
  )) {
    const name = declaration.getName();
    if (name !== undefined) registerFunction(name, declaration);
  }
  for (const declaration of sf.getDescendantsOfKind(
    SyntaxKind.VariableDeclaration,
  )) {
    const name = declaration.getNameNode();
    const initializer = declaration.getInitializer();
    if (
      Node.isIdentifier(name) &&
      initializer !== undefined &&
      (Node.isArrowFunction(initializer) ||
        Node.isFunctionExpression(initializer))
    ) {
      registerFunction(name.getText(), initializer);
    }
  }
};

/** ONE source file's origin state, with the mutually recursive walk wired back
 * through it. Fresh per file: nothing learned in one file is believed in the next. */
export function createOriginResolver(sf: SourceFile): OriginResolver {
  const origins = initialOrigins();
  const localFunctions = new Map<string, CallableShape>();
  const resolver: OriginResolver = {
    origins,
    localFunctions,
    originOf: (input, trail = new Set(), bindings = new Map()) =>
      originOf(resolver, input, trail, bindings),
    memberValueOrigins: (input, path, trail, bindings) =>
      memberValueOrigins(resolver, input, path, trail, bindings),
    callableShapes: (target, trail = new Set()) =>
      callableShapes(resolver, target, trail),
    callBindings: (callable, call, trail, bindings) =>
      callBindings(resolver, callable, call, trail, bindings),
    declarationOrigins: (declaration, trail, bindings) =>
      declarationOrigins(resolver, declaration, trail, bindings),
    setOrigins: (name, value) => setOrigins(origins, name, value),
  };
  registerLocalFunctions(sf, localFunctions);
  return resolver;
}
