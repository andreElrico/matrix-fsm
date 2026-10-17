/**
 * @matrix-fsm/core - Static Mermaid stateDiagram-v2 Exporter
 */

import {
  isAwaitingNode,
  isEachNode,
  isFinalNode,
  isStayNode,
  isSubMachineRef,
} from './primitives.js';
import type { AnyFSMDefinition, TransitionOptions } from './types.js';

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

  // 3. Render composite subMachine blocks
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
      TransitionOptions<any, any> | undefined,
    ];

    const fromRaw = isSubMachineRef(from)
      ? from.id
      : isEachNode(from)
        ? from.id
        : String(from);
    const fromId = sanitizeMermaidId(fromRaw);
    const viaLabel = String(via);

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
      lines.push(
        `${indent}${fromId} --> [*] : ${viaLabel}${guardName} (${to.outcome})`,
      );
      continue;
    }

    const toRaw = isAwaitingNode(to)
      ? to.state
      : isSubMachineRef(to)
        ? to.id
        : isEachNode(to)
          ? to.id
          : String(to);
    const toId = sanitizeMermaidId(toRaw);

    lines.push(`${indent}${fromId} --> ${toId} : ${viaLabel}${guardName}`);
  }

  return lines;
}

/**
 * Generates a static Mermaid `stateDiagram-v2` diagram from a pure FSM definition.
 * Renders `awaiting()` nodes with `⚡` badges and `subMachine()` as composite blocks.
 */
export function toMermaid(fsm: AnyFSMDefinition): string {
  const lines: string[] = [
    'stateDiagram-v2',
    `  [*] --> ${sanitizeMermaidId(fsm.initial)}`,
    ...renderMachineBody(fsm, '  '),
  ];
  return lines.join('\n');
}
