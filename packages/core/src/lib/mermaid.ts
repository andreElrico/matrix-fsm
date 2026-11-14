/**
 * @matrix-fsm/core - Static Mermaid stateDiagram-v2 Exporter
 */

import {
  isAfterNode,
  isAlwaysNode,
  isAnyStateNode,
  isAwaitingNode,
  isCombinatorNode,
  isEachNode,
  isEveryNode,
  isFinalNode,
  isFSMDefinition,
  isStayNode,
  isSubMachineRef,
} from './primitives.js';
import type {
  AnyFSMDefinition,
  AnyTransitionRow,
  TransitionOptions,
} from './types.js';

function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function renderMachineBody(
  fsm: AnyFSMDefinition,
  indent = '  ',
  claimedIds = new Set<string>(
    [...fsm.states].map((s) => sanitizeMermaidId(s)),
  ),
  scopePrefix = '',
): string[] {
  const lines: string[] = [];
  const localIdMap = new Map<string, string>();

  const resolveScopedId = (rawState: string): string => {
    const existing = localIdMap.get(rawState);
    if (existing) {
      return existing;
    }
    const baseSafe = sanitizeMermaidId(rawState);
    if (scopePrefix && claimedIds.has(baseSafe)) {
      const scoped = `${scopePrefix}_${baseSafe}`;
      claimedIds.add(scoped);
      localIdMap.set(rawState, scoped);
      return scoped;
    }
    claimedIds.add(baseSafe);
    localIdMap.set(rawState, baseSafe);
    return baseSafe;
  };

  for (const st of fsm.states) {
    resolveScopedId(st);
  }

  // 1. Render awaiting state badges (⚡)
  for (const awaitingState of fsm.awaitingStates) {
    const safeId = resolveScopedId(awaitingState);
    lines.push(`${indent}state "⚡ ${awaitingState}" as ${safeId}`);
  }

  // 1b. Render state label aliases for any non-awaiting state whose ID was scoped to avoid collision
  for (const [rawState, scopedId] of localIdMap.entries()) {
    if (
      scopedId !== sanitizeMermaidId(rawState) &&
      !fsm.awaitingStates.has(rawState) &&
      !fsm.eachNodes.has(rawState) &&
      !fsm.combinatorNodes?.has(rawState) &&
      !fsm.subMachines.has(rawState)
    ) {
      lines.push(`${indent}state "${rawState}" as ${scopedId}`);
    }
  }

  // 2. Render each() parallel orchestration badges (⇉)
  for (const [, eachNode] of fsm.eachNodes) {
    const safeId = resolveScopedId(eachNode.id);
    lines.push(
      `${indent}state "⇉ each(${eachNode.key}: ${eachNode.machine.id})" as ${safeId}`,
    );
  }

  // 2b. Render combinator badges (all / race / any)
  if (fsm.combinatorNodes) {
    for (const [, combNode] of fsm.combinatorNodes) {
      const safeId = resolveScopedId(combNode.id);
      const childNames = combNode.machines
        .map((m: AnyFSMDefinition) => m.id)
        .join(', ');
      lines.push(
        `${indent}state "⇉ ${combNode.__type}(${childNames})" as ${safeId}`,
      );
    }
  }

  // 2c. Render anyState() wildcard badge if used in transitions
  const hasAnyState = fsm.transitions.some((row: AnyTransitionRow) =>
    isAnyStateNode((row as unknown as readonly [unknown])[0]),
  );
  const anyStateId = scopePrefix ? `${scopePrefix}_anyState` : 'anyState';
  if (hasAnyState) {
    lines.push(`${indent}state "(*)" as ${anyStateId}`);
  }

  // 3. Render composite sub-machine blocks
  for (const [, subRef] of fsm.subMachines) {
    const safeSubId = resolveScopedId(subRef.id);
    const childLines = renderMachineBody(
      subRef.machine,
      `${indent}  `,
      claimedIds,
      safeSubId,
    );
    const childInitialSafe = sanitizeMermaidId(subRef.machine.initial);
    const childInitialScoped = childLines.some((l) =>
      l.includes(`as ${safeSubId}_${childInitialSafe}`),
    )
      ? `${safeSubId}_${childInitialSafe}`
      : childInitialSafe;
    lines.push(`${indent}state ${safeSubId} {`);
    lines.push(`${indent}  [*] --> ${childInitialScoped}`);
    lines.push(...childLines);
    lines.push(`${indent}}`);
  }

  // 4. Render transition edges
  for (const row of fsm.transitions) {
    const [from, via, to, options] = row as readonly [
      unknown,
      unknown,
      unknown,
      TransitionOptions<any, any, any> | undefined,
    ];

    const fromItems = Array.isArray(from) ? from : [from];
    for (const fromItem of fromItems) {
      const fromRaw = isAnyStateNode(fromItem)
        ? anyStateId
        : isAwaitingNode(fromItem)
          ? fromItem.state
          : isSubMachineRef(fromItem) || isFSMDefinition(fromItem)
            ? fromItem.id
            : isEachNode(fromItem) || isCombinatorNode(fromItem)
              ? fromItem.id
              : String(fromItem);
      const fromId = isAnyStateNode(fromItem)
        ? anyStateId
        : resolveScopedId(fromRaw);
      const formatViaSingle = (v: unknown): string =>
        isAfterNode(v)
          ? `after(${typeof v.ms === 'number' ? `${v.ms}ms` : 'dynamic'})`
          : isEveryNode(v)
            ? `every(${typeof v.ms === 'number' ? `${v.ms}ms` : 'dynamic'})`
            : isAlwaysNode(v)
              ? 'always()'
              : String(v);
      const viaLabel = Array.isArray(via)
        ? via.map(formatViaSingle).join(' | ')
        : formatViaSingle(via);

      const guardName = options?.guard
        ? options.guard.name
          ? ` [${options.guard.name}]`
          : ' [guard]'
        : '';

      if (isStayNode(to)) {
        lines.push(
          `${indent}${fromId} --> ${fromId} : ${viaLabel}${guardName} (stay)`,
        );
        continue;
      }

      if (isFinalNode(to)) {
        const outcomeLabel = options?.output
          ? typeof options.output === 'string'
            ? options.output
            : String(options.output[0])
          : to.outcome;
        lines.push(
          `${indent}${fromId} --> [*] : ${viaLabel}${guardName} (${outcomeLabel})`,
        );
        continue;
      }

      const toRaw = isAwaitingNode(to)
        ? to.state
        : isSubMachineRef(to) || isFSMDefinition(to)
          ? to.id
          : isEachNode(to) || isCombinatorNode(to)
            ? to.id
            : String(to);
      const toId = resolveScopedId(toRaw);

      lines.push(`${indent}${fromId} --> ${toId} : ${viaLabel}${guardName}`);
    }
  }

  return lines;
}

/**
 * Generates a static Mermaid `stateDiagram-v2` diagram from a pure FSM definition.
 * Renders `awaiting()` nodes with `⚡` badges and nested sub-machines as composite blocks.
 */
export function toMermaid(
  fsmOrFeature: AnyFSMDefinition | { readonly fsm: AnyFSMDefinition },
): string {
  const fsm =
    'fsm' in fsmOrFeature && isFSMDefinition(fsmOrFeature.fsm)
      ? fsmOrFeature.fsm
      : (fsmOrFeature as AnyFSMDefinition);
  const lines: string[] = [
    'stateDiagram-v2',
    `  [*] --> ${sanitizeMermaidId(fsm.initial)}`,
    ...renderMachineBody(fsm, '  '),
  ];
  return lines.join('\n');
}

export interface ShortestPathStep {
  readonly from: string;
  readonly via: string;
  readonly to: string;
  readonly hasGuard: boolean;
}

/**
 * Computes the deterministic shortest sequence of transitions from `fsm.initial`
 * to every reachable state in the transition matrix using Breadth-First Search (BFS).
 */
export function getShortestPaths(
  fsmOrFeature: AnyFSMDefinition | { readonly fsm: AnyFSMDefinition },
): Readonly<Record<string, ReadonlyArray<ShortestPathStep>>> {
  const fsm =
    'fsm' in fsmOrFeature && isFSMDefinition(fsmOrFeature.fsm)
      ? fsmOrFeature.fsm
      : (fsmOrFeature as AnyFSMDefinition);

  const result: Record<string, ReadonlyArray<ShortestPathStep>> = {
    [fsm.initial]: [],
  };
  const queue: string[] = [fsm.initial];

  const extractStateKey = (node: unknown): string | null => {
    if (isStayNode(node) || isFinalNode(node)) {
      return null;
    }
    if (isAwaitingNode(node)) {
      return node.state;
    }
    if (
      isSubMachineRef(node) ||
      isFSMDefinition(node) ||
      isEachNode(node) ||
      isCombinatorNode(node)
    ) {
      return node.id;
    }
    if (typeof node === 'string') {
      return node;
    }
    return null;
  };

  const formatViaKey = (via: unknown): string => {
    if (isAfterNode(via)) {
      return `after(${typeof via.ms === 'number' ? `${via.ms}ms` : 'dynamic'})`;
    }
    if (isEveryNode(via)) {
      return `every(${typeof via.ms === 'number' ? `${via.ms}ms` : 'dynamic'})`;
    }
    if (isAlwaysNode(via)) {
      return 'always()';
    }
    if (Array.isArray(via) && via.length > 0) {
      return formatViaKey(via[0]);
    }
    return String(via);
  };

  while (queue.length > 0) {
    const current = queue.shift()!;
    const pathSoFar = result[current];

    for (const row of fsm.transitions) {
      const [from, via, to, options] = row as readonly [
        unknown,
        unknown,
        unknown,
        TransitionOptions<any, any, any> | undefined,
      ];
      const fromItems = Array.isArray(from) ? from : [from];
      const matchesSource = fromItems.some((item) =>
        isAnyStateNode(item) ? true : extractStateKey(item) === current,
      );
      if (!matchesSource) {
        continue;
      }
      const targetKey = extractStateKey(to);
      if (!targetKey) {
        continue;
      }
      const isEpsilonAlways =
        isAlwaysNode(via) ||
        (Array.isArray(via) && via.some((v) => isAlwaysNode(v)));
      if (isEpsilonAlways) {
        if (
          !(targetKey in result) ||
          pathSoFar.length < result[targetKey].length
        ) {
          result[targetKey] = [...pathSoFar];
          queue.unshift(targetKey);
        }
      } else {
        const candidateLen = pathSoFar.length + 1;
        if (
          !(targetKey in result) ||
          candidateLen < result[targetKey].length
        ) {
          result[targetKey] = [
            ...pathSoFar,
            {
              from: current,
              via: formatViaKey(via),
              to: targetKey,
              hasGuard: Boolean(options?.guard),
            },
          ];
          queue.push(targetKey);
        }
      }
    }
  }

  return result;
}
