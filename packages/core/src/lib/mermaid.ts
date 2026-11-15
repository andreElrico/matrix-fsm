/**
 * @matrix-fsm/core - Static Mermaid stateDiagram-v2 Exporter
 */

import { sourceIncludesAnyState } from './fsm.js';
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
  AllowedSendEvents,
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
  ancestors = new Set<AnyFSMDefinition>([fsm]),
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
      const childNames = (combNode.actorRefs ?? combNode.machines)
        .map((m: { readonly id: string }) => m.id)
        .join(', ');
      lines.push(
        `${indent}state "⇉ ${combNode.__type}(${childNames})" as ${safeId}`,
      );
    }
  }

  // 2c. Render anyState() wildcard badge if used in transitions
  const hasAnyState = fsm.transitions.some((row: AnyTransitionRow) =>
    sourceIncludesAnyState((row as unknown as readonly [unknown])[0]),
  );
  const anyStateId = scopePrefix ? `${scopePrefix}_anyState` : 'anyState';
  if (hasAnyState) {
    lines.push(`${indent}state "(*)" as ${anyStateId}`);
  }

  // 3. Render composite sub-machine blocks (with ancestor cycle guard)
  for (const [, subRef] of fsm.subMachines) {
    const safeSubId = resolveScopedId(subRef.id);
    if (ancestors.has(subRef.machine)) {
      lines.push(
        `${indent}state "↻ ${subRef.id} (${subRef.machine.id})" as ${safeSubId}`,
      );
      continue;
    }
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(subRef.machine);
    const childLines = renderMachineBody(
      subRef.machine,
      `${indent}  `,
      claimedIds,
      safeSubId,
      nextAncestors,
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
 * Generates a static Mermaid `stateDiagram-v2` diagram from a pure {@link FSMDefinition} or
 * `createMachineFeature` definition.
 *
 * @group Analysis & Visualization
 * @param fsmOrFeature - Compiled FSM definition or wrapper `{ fsm }` object.
 * @returns A Mermaid `stateDiagram-v2` string ready to paste into Markdown or render via Mermaid.
 *
 * @remarks
 * Renders `awaiting()` states with `⚡` badges, parallel combinators (`each`, `all`, `race`, `any`)
 * with `⇉` badges, and nested sub-machines as composite blocks.
 *
 * @example
 * ```ts
 * import { createFSM, toMermaid } from '@matrix-fsm/core';
 *
 * const toggleFSM = createFSM<{ events: { TOGGLE: void }; states: 'off' | 'on' }>()({
 *   id: 'toggle',
 *   initial: 'off',
 *   transitions: [
 *     ['off', 'TOGGLE', 'on'],
 *     ['on',  'TOGGLE', 'off'],
 *   ],
 * });
 *
 * const diagram = toMermaid(toggleFSM);
 * // stateDiagram-v2
 * //   [*] --> off
 * //   off --> on : TOGGLE
 * //   on --> off : TOGGLE
 * ```
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

/**
 * Single transition step inside a shortest-path sequence returned by {@link getShortestPaths}.
 *
 * @group Analysis & Visualization
 */
export interface ShortestPathStep<TVia extends string = string> {
  /** Source state name. */
  readonly from: string;
  /** Triggering event name or timer/always marker ID. */
  readonly via: TVia;
  /** Target state or actor ID. */
  readonly to: string;
  /** Whether the underlying transition row specifies a `guard`. */
  readonly hasGuard: boolean;
  /** Present and `true` when `includeMetadata` is enabled and this edge originates from a child actor output. */
  readonly isChildOutput?: boolean;
}

/**
 * Configuration options for {@link getShortestPaths}.
 *
 * @group Analysis & Visualization
 */
export interface GetShortestPathsOptions {
  /**
   * When `true`, skips child-actor output edges (`subMachine`, `all`/`race`/`any`, `each`)
   * that cannot be driven directly via external `send(step.via)` calls.
   */
  readonly externalOnly?: boolean;
  /**
   * When `true`, attaches optional metadata such as `isChildOutput: true` onto steps.
   */
  readonly includeMetadata?: boolean;
}

type UnwrapMachineDef<T> = T extends { readonly fsm: infer F extends AnyFSMDefinition }
  ? F
  : T extends AnyFSMDefinition
    ? T
    : AnyFSMDefinition;

type ShortestPathViaFor<T> = [AllowedSendEvents<UnwrapMachineDef<T>>] extends [never]
  ? string
  : AllowedSendEvents<UnwrapMachineDef<T>>;

/**
 * Computes the deterministic shortest sequence of transitions from `fsm.initial`
 * to every reachable state in the transition matrix using Breadth-First Search (BFS).
 *
 * @group Analysis & Visualization
 * @param fsmOrFeature - Compiled FSM definition or `{ fsm }` wrapper.
 * @param pathOptions - Optional filtering and metadata flags.
 * @returns Map of reachable state names to their shortest step arrays.
 *
 * @example
 * ```ts
 * import { createFSM, getShortestPaths } from '@matrix-fsm/core';
 *
 * const wizardFSM = createFSM<{
 *   events: { NEXT: void; FINISH: void };
 *   states: 'step1' | 'step2' | 'done';
 * }>()({
 *   id: 'wizard',
 *   initial: 'step1',
 *   transitions: [
 *     ['step1', 'NEXT',   'step2'],
 *     ['step2', 'FINISH', 'done'],
 *   ],
 * });
 *
 * const paths = getShortestPaths(wizardFSM);
 * // paths.done -> [{ from: 'step1', via: 'NEXT', to: 'step2', hasGuard: false }, ...]
 * ```
 */
export function getShortestPaths<
  TFSM extends AnyFSMDefinition | { readonly fsm: AnyFSMDefinition },
>(
  fsmOrFeature: TFSM,
  pathOptions?: GetShortestPathsOptions,
): Readonly<Record<string, ReadonlyArray<ShortestPathStep<ShortestPathViaFor<TFSM>>>>> {
  const fsm =
    'fsm' in fsmOrFeature && isFSMDefinition(fsmOrFeature.fsm)
      ? fsmOrFeature.fsm
      : (fsmOrFeature as AnyFSMDefinition);

  const result: Record<string, ReadonlyArray<ShortestPathStep<any>>> = {
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
        const isActorState =
          fsm.subMachines.has(current) ||
          Boolean(fsm.combinatorNodes?.has(current)) ||
          fsm.eachNodes.has(current);
        const viaStr = formatViaKey(via);
        const isChildOut =
          isActorState &&
          (viaStr === 'DONE' ||
            viaStr === 'ALL_DONE' ||
            viaStr === 'ERROR' ||
            (fsm.subMachines.get(current)?.machine.transitions.some((r: AnyTransitionRow) => {
              const [, , cTo, cOpts] = r as unknown as readonly [
                unknown,
                unknown,
                unknown,
                TransitionOptions<any, any, any> | undefined,
              ];
              if (cOpts?.output) {
                const outName =
                  typeof cOpts.output === 'string'
                    ? cOpts.output
                    : String(cOpts.output[0]);
                if (outName === viaStr) {
                  return true;
                }
              }
              return isFinalNode(cTo) && cTo.outcome === viaStr;
            }) ??
              false));
        if (pathOptions?.externalOnly && isChildOut) {
          continue;
        }
        const candidateLen = pathSoFar.length + 1;
        if (
          !(targetKey in result) ||
          candidateLen < result[targetKey].length
        ) {
          result[targetKey] = [
            ...pathSoFar,
            {
              from: current,
              via: viaStr,
              to: targetKey,
              hasGuard: Boolean(options?.guard),
              ...(pathOptions?.includeMetadata && isChildOut
                ? { isChildOutput: true }
                : {}),
            },
          ];
          queue.push(targetKey);
        }
      }
    }
  }

  return result;
}
