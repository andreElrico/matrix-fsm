/**
 * @matrix-fsm/angular/effect - First-Class Effect-TS Sandwich Machine Feature (`createEffectMachineFeature`)
 *
 * Dedicated Effect-TS entrypoint that shares 100% of the core SignalStore & tree runtime
 * while keeping `@matrix-fsm/angular` completely free of `effect` types and bundle weight.
 */

import type { DeepSignalOf, WritableStateSource } from '@ngrx/signals';
import type {
  DebugLogger,
  EmptyObject,
  InspectCallback,
  OutcomeNode,
  ResolveContext,
  TransitionRow,
  ValidateTransitionRows,
} from '@matrix-fsm/core';
import { Cause, Effect, Exit, Fiber } from 'effect';
import {
  buildMachineFeatureRuntime,
  type CustomTaskAdapter,
  type FeatureEvents,
  type FeatureInputs,
  type FeatureMethods,
  type FeatureOutputs,
  type FeatureStates,
  type HasDeclaredVoidOutput,
  type MachineFeatureContract,
  type MachineFeatureDefinition,
  type SyncContextMap,
} from '../lib/with-state-machine.js';

type EffectTaggedErrorOutcome<E> = E extends {
  readonly _tag: infer Tag extends string;
}
  ? OutcomeNode<Tag, E>
  : never;

type EffectErrorOutcome<E> = [E] extends [never]
  ? never
  : OutcomeNode<'ERROR', E> | EffectTaggedErrorOutcome<E>;

export type NormalizeEffectMethodReturn<R> =
  R extends Effect.Effect<infer A, infer E, any>
    ? Promise<A | EffectErrorOutcome<E>>
    : R;

export type NormalizeEffectMethods<TMethods> = {
  readonly [K in keyof TMethods]: TMethods[K] extends (
    ...args: infer Args
  ) => infer R
    ? (...args: Args) => NormalizeEffectMethodReturn<R>
    : TMethods[K];
};

const effectExecutorAdapter: CustomTaskAdapter = {
  canHandle(result: unknown): boolean {
    return Effect.isEffect(result);
  },
  execute(
    result: unknown,
    callbacks: {
      onSuccess: (output: unknown) => void;
      onFailure: (err: unknown) => void;
      isCancelled: () => boolean;
    },
  ): () => void {
    let fiber: Fiber.Fiber<any, any> | null = Effect.runFork(
      result as Effect.Effect<unknown, any, never>,
    );

    fiber.addObserver((exit) => {
      if (callbacks.isCancelled()) {
        return;
      }
      if (Exit.isSuccess(exit)) {
        callbacks.onSuccess(exit.value);
      } else {
        if (Cause.hasInterruptsOnly(exit.cause)) {
          return;
        }
        const squashedError = Cause.squash(exit.cause);
        callbacks.onFailure(squashedError);
      }
    });

    return () => {
      if (fiber) {
        const fiberToInterrupt = fiber;
        fiber = null;
        Effect.runFork(Fiber.interrupt(fiberToInterrupt));
      }
    };
  },
};

export type EffectMachineFeatureConfig<
  TId extends string,
  TInitial extends TDeclaredStates,
  TInputs extends object,
  TState extends object,
  TEvents extends Record<string, any>,
  TOutputs extends Record<string, any>,
  TDeclaredStates extends string,
  TMethods extends Record<string, any>,
  TTransitions extends readonly TransitionRow<
    TInputs & TState,
    Extract<keyof TEvents, string>,
    TDeclaredStates,
    any,
    TOutputs,
    HasDeclaredVoidOutput<TOutputs> extends false ? TInputs & TState : any
  >[],
> = {
  readonly id: TId;
  readonly initial: TInitial;
  readonly transitions: TTransitions &
    ValidateTransitionRows<
      TTransitions,
      NoInfer<TInputs & TState>,
      Extract<keyof TEvents, string>,
      NormalizeEffectMethods<NoInfer<TMethods>>,
      TOutputs,
      TEvents
    >;
  readonly state?: TState;
  readonly syncContext?:
    | (() => SyncContextMap<NoInfer<TInputs & TState>>)
    | SyncContextMap<NoInfer<TInputs & TState>>;
  readonly methods?:
    | ((
        store: WritableStateSource<NoInfer<TInputs & TState>> &
          DeepSignalOf<NoInfer<TInputs & TState>> &
          Record<string, any>,
      ) => TMethods)
    | TMethods;
  readonly debug?: DebugLogger;
  readonly inspect?: InspectCallback<any>;
  readonly onEnter?:
    | (() => Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >)
    | Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >;
  readonly onExit?:
    | (() => Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >)
    | Partial<
        Record<
          TDeclaredStates,
          (ctx: Readonly<NoInfer<TInputs & TState>>) => void
        >
      >;
};

/**
 * Effect-TS Sub-Machine Actor Creator ("Sandwich-Pattern" for Effect-TS):
 * Executes `Effect.Effect<A, E, never>` returned from `{ call: (m) => m._method }` on `awaiting()`
 * via `Effect.runFork`, automatically interrupts the fiber on state exit, and infers `A` for `'DONE'`
 * and `E` for `'ERROR'` / TaggedError `_tag` transitions.
 */
export function createEffectMachineFeature<
  TContract extends MachineFeatureContract = EmptyObject,
>(): <
  const TId extends string,
  const TInitial extends FeatureStates<TContract>,
  const TTransitions extends readonly TransitionRow<
    FeatureInputs<TContract> & TState,
    Extract<keyof FeatureEvents<TContract>, string>,
    FeatureStates<TContract>,
    NormalizeEffectMethods<FeatureMethods<TContract>>,
    FeatureOutputs<TContract>,
    HasDeclaredVoidOutput<FeatureOutputs<TContract>> extends false
      ? FeatureInputs<TContract> & TState
      : any
  >[],
  TState extends object = EmptyObject,
  TMethods extends Record<string, any> = FeatureMethods<TContract>,
>(
  config: EffectMachineFeatureConfig<
    TId,
    TInitial,
    FeatureInputs<TContract>,
    TState,
    FeatureEvents<TContract>,
    FeatureOutputs<TContract>,
    FeatureStates<TContract>,
    TMethods,
    TTransitions
  >,
) => MachineFeatureDefinition<
  TId,
  TInitial,
  ResolveContext<FeatureInputs<TContract> & TState, TTransitions>,
  FeatureEvents<TContract>,
  TTransitions,
  NormalizeEffectMethods<TMethods>,
  FeatureInputs<TContract>,
  FeatureOutputs<TContract>
> {
  return (config: any) =>
    buildMachineFeatureRuntime(config, effectExecutorAdapter);
}

/**
 * Bridges an `Effect.Effect<A, E, never>` into an `AbortSignal`-aware Promise
 * that automatically interrupts the underlying Effect Fiber when `signal` aborts.
 */
export function runEffect<A, E = unknown>(
  effect: Effect.Effect<A, E, never>,
  signal?: AbortSignal,
): Promise<A> {
  return new Promise<A>((resolve, reject) => {
    if (signal?.aborted) {
      return;
    }
    let settled = false;
    const fiber = Effect.runFork(effect);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        Effect.runFork(Fiber.interrupt(fiber));
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    fiber.addObserver((exit) => {
      signal?.removeEventListener('abort', onAbort);
      if (settled) {
        return;
      }
      settled = true;
      if (Exit.isSuccess(exit)) {
        resolve(exit.value);
      } else if (!Cause.hasInterruptsOnly(exit.cause)) {
        reject(Cause.squash(exit.cause));
      }
    });
  });
}
