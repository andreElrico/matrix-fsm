/**
 * @matrix-fsm/core - Static Mermaid stateDiagram-v2 Exporter
 */

import {
  isAfterNode,
  isAnyStateNode,
  isAwaitingNode,
  isCombinatorNode,
  isEachNode,
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

function renderMachineBody(fsm: AnyFSMDefinition, indent = '  '): string[] {
  const lines: string[] = [];

  // 1. Render awaiting state badges (⚡)
  for (const awaitingState of fsm.awaitingStates) {
    const safeId = sanitizeMermaidId(awaitingState);
    lines.push(`${indent}state "⚡ ${awaitingState}" as ${safeId}`);
  }

  // 2. Render each() parallel orchestration badges (⇉)
  for (const [, eachNode] of fsm.eachNodes) {
    const safeId = sanitizeMermaidId(eachNode.id);
    lines.push(
      `${indent}state "⇉ each(${eachNode.key}: ${eachNode.machine.id})" as ${safeId}`,
    );
  }

  // 2b. Render combinator badges (all / race / any)
  if (fsm.combinatorNodes) {
    for (const [, combNode] of fsm.combinatorNodes) {
      const safeId = sanitizeMermaidId(combNode.id);
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
  if (hasAnyState) {
    lines.push(`${indent}state "(*)" as anyState`);
  }

  // 3. Render composite sub-machine blocks
  for (const [, subRef] of fsm.subMachines) {
    const safeSubId = sanitizeMermaidId(subRef.id);
    lines.push(`${indent}state ${safeSubId} {`);
    lines.push(
      `${indent}  [*] --> ${sanitizeMermaidId(subRef.machine.initial)}`,
    );
    lines.push(...renderMachineBody(subRef.machine, `${indent}  `));
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

    const fromRaw = isAnyStateNode(from)
      ? 'anyState'
      : isSubMachineRef(from) || isFSMDefinition(from)
        ? from.id
        : isEachNode(from) || isCombinatorNode(from)
          ? from.id
          : String(from);
    const fromId = sanitizeMermaidId(fromRaw);
    const viaLabel = isAfterNode(via) ? `after(${via.ms}ms)` : String(via);

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
    const toId = sanitizeMermaidId(toRaw);

    lines.push(`${indent}${fromId} --> ${toId} : ${viaLabel}${guardName}`);
  }

  return lines;
}

/**
 * Generates a static Mermaid `stateDiagram-v2` diagram from a pure FSM definition.
 * Renders `awaiting()` nodes with `⚡` badges and nested sub-machines as composite blocks.
 */
export function toMermaid(fsm: AnyFSMDefinition): string {
  const lines: string[] = [
    'stateDiagram-v2',
    `  [*] --> ${sanitizeMermaidId(fsm.initial)}`,
    ...renderMachineBody(fsm, '  '),
  ];
  return lines.join('\n');
}
