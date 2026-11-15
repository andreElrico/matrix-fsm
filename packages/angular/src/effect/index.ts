/**
 * @matrix-fsm/angular/effect - First-Class Effect-TS Sandwich Machine Feature (`createEffectMachineFeature`)
 *
 * Dedicated Effect-TS entrypoint that shares 100% of the core SignalStore & tree runtime
 * while keeping `@matrix-fsm/angular` completely free of `effect` types and bundle weight.
 */

import type {
  EmptyObject,
  InitialStateTarget,
  OutcomeNode,
  ResolveContext,
  ResolveInitialStateKey,
  TransitionRow,
  ValidateContractKeys,
} from '@matrix-fsm/core';
import { Cause, Effect, Exit, Fiber, Option } from 'effect';
import {
  buildMachineFeatureRuntime,
  type CustomTaskAdapter,
  type FeatureEvents,
  type FeatureInputs,
  type FeatureMethods,
  type FeatureOutputs,
  type FeatureStates,
  type MachineFeatureConfig,
  type MachineFeatureContract,
  type MachineFeatureDefinition,
  type ResolveValidatedMethods,
} from '../lib/with-state-machine.js';

type EffectTaggedErrorOutcome<E> = E extends {
  readonly _tag: infer Tag extends string;
}
  ? OutcomeNode<Tag, E>
  : never;

type EffectErrorOutcome<E> = [E] extends [never]
  ? never
  : OutcomeNode<'ERROR', E> | EffectTaggedErrorOutcome<E>;

/**
 * Normalizes an Effect-returning method signature `(...args) => Effect<A, E, R>` into its
 * runtime `Promise<A | EffectErrorOutcome<E>>` equivalent so the transition matrix infers
 * `'DONE'` payload `A` and `Data.TaggedError` `_tag` events from `E`.
 *
 * @group Effect-TS
 */
export type NormalizeEffectMethodReturn<R> =
  R extends Effect.Effect<infer A, infer E, any>
    ? Promise<A | EffectErrorOutcome<E>>
    : R;

/**
 * Maps a `methods` dictionary containing Effect-returning async methods into normalized signatures
 * for compile-time transition row inference.
 *
 * @group Effect-TS
 */
export type NormalizeEffectMethods<TMethods> =
  [0] extends [1 & TMethods]
    ? any
    : {
        readonly [K in keyof TMethods]: TMethods[K] extends (
          ...args: infer Args
        ) => infer R
          ? (...args: Args) => NormalizeEffectMethodReturn<R>
          : TMethods[K];
      };

type MissingEffectEnvInMethods<TMethods, TRuntimeEnv> =
  [0] extends [1 & TMethods]
    ? never
    : TMethods extends object
      ? {
          [K in keyof TMethods]: TMethods[K] extends (...args: any[]) => infer Ret
            ? Ret extends Effect.Effect<any, any, infer Req>
              ? [0] extends [1 & Req]
                ? never
                : [Req] extends [TRuntimeEnv]
                  ? never
                  : Exclude<Req, TRuntimeEnv>
              : never
            : never;
        }[keyof TMethods]
      : never;

/**
 * Compile-time validator ensuring every `Effect.Effect<A, E, R>` returned by `methods` only
 * requires Effect services `R` satisfied by `TRuntimeEnv` (provided via `runtime`).
 *
 * @group Effect-TS
 */
export type ValidateEffectMethodsEnv<TMethods, TRuntimeEnv> = [
  MissingEffectEnvInMethods<TMethods, TRuntimeEnv>,
] extends [never]
  ? unknown
  : {
      readonly __effectEnvError: 'Effect method requires environment services not provided by feature runtime';
      readonly missingServices: MissingEffectEnvInMethods<TMethods, TRuntimeEnv>;
    };

/**
 * Minimal runtime interface (satisfied by Effect's `ManagedRuntime` and `Runtime`) required
 * when `Effect` methods depend on Effect services `R`.
 *
 * @group Effect-TS
 */
export interface EffectRuntimeLike<R = never> {
  /** Forks an Effect inside the provided runtime environment and returns its `Fiber`. */
  readonly runFork: <A, E>(
    effect: Effect.Effect<A, E, R>,
  ) => Fiber.Fiber<A, any>;
}

function unwrapExitFailure(cause: Cause.Cause<unknown>): unknown {
  const failureOpt = Cause.findErrorOption(cause);
  if (Option.isSome(failureOpt)) {
    return failureOpt.value;
  }
  const squashedDefect = Cause.squash(cause);
  if (
    typeof squashedDefect === 'object' &&
    squashedDefect !== null &&
    ('_tag' in squashedDefect ||
      ('name' in squashedDefect &&
        (squashedDefect as { name: unknown }).name !== 'Error'))
  ) {
    return new Error(
      String(
        (squashedDefect as { message?: unknown }).message ?? 'Effect defect',
      ),
      { cause: squashedDefect },
    );
  }
  return squashedDefect;
}

/**
 * Creates a {@link CustomTaskAdapter} that executes `Effect.Effect<A, E, R>` values returned from
 * `awaiting()` methods using `Effect.runFork` (or an optional `ManagedRuntime` / {@link EffectRuntimeLike}).
 *
 * @group Effect-TS
 * @param runtimeOption - Optional Effect runtime or lazy factory supplying service environment `R`.
 * @returns A {@link CustomTaskAdapter} handling Effect values and interrupting fibers on cancellation.
 *
 * @example
 * ```ts
 * import { createMachineInstance } from '@matrix-fsm/core';
 * import { createEffectExecutorAdapter } from '@matrix-fsm/angular/effect';
 *
 * const instance = createMachineInstance(myFSM, {
 *   taskAdapter: createEffectExecutorAdapter(),
 *   methods: { ... },
 * });
 * ```
 */
export function createEffectExecutorAdapter<R = never>(
  runtimeOption?: EffectRuntimeLike<R> | (() => EffectRuntimeLike<R>),
): CustomTaskAdapter {
  return {
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
      const rt =
        typeof runtimeOption === 'function' ? runtimeOption() : runtimeOption;
      const spawnedFiber: Fiber.Fiber<any, any> = rt
        ? rt.runFork(result as Effect.Effect<unknown, any, R>)
        : Effect.runFork(result as Effect.Effect<unknown, any, never>);
      let fiber: Fiber.Fiber<any, any> | null = spawnedFiber;

      spawnedFiber.addObserver((exit) => {
        if (callbacks.isCancelled()) {
          return;
        }
        if (Exit.isSuccess(exit)) {
          callbacks.onSuccess(exit.value);
        } else {
          callbacks.onFailure(unwrapExitFailure(exit.cause));
        }
      });

      return () => {
        if (fiber) {
          const fiberToInterrupt = fiber;
          fiber = null;
          if (rt) {
            rt.runFork(
              Fiber.interrupt(fiberToInterrupt) as Effect.Effect<
                unknown,
                never,
                R
              >,
            );
          } else {
            Effect.runFork(Fiber.interrupt(fiberToInterrupt));
          }
        }
      };
    },
  };
}

/**
 * Alias for {@link createEffectExecutorAdapter}.
 *
 * @group Effect-TS
 */
export const createEffectTaskAdapter = createEffectExecutorAdapter;

type RuntimeConfigField<TRuntimeEnv> = [TRuntimeEnv] extends [never]
  ? {
      readonly runtime?:
        | EffectRuntimeLike<TRuntimeEnv>
        | (() => EffectRuntimeLike<TRuntimeEnv>);
    }
  : {
      readonly runtime:
        | EffectRuntimeLike<TRuntimeEnv>
        | (() => EffectRuntimeLike<TRuntimeEnv>);
    };

/**
 * Configuration object accepted by {@link createEffectMachineFeature}, extending
 * `MachineFeatureConfig` with Effect runtime validation.
 *
 * @group Effect-TS
 */
export type EffectMachineFeatureConfig<
  TId extends string,
  TInitial extends InitialStateTarget<TDeclaredStates>,
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
    TInputs & TState
  >[],
  TRuntimeEnv = never,
> = MachineFeatureConfig<
  TId,
  TInitial,
  TInputs,
  TState,
  TEvents,
  TOutputs,
  TDeclaredStates,
  TMethods,
  TTransitions,
  NormalizeEffectMethods<ResolveValidatedMethods<NoInfer<TMethods>>>
> &
  RuntimeConfigField<TRuntimeEnv> &
  ValidateEffectMethodsEnv<NoInfer<TMethods>, TRuntimeEnv>;

/**
 * Effect-TS Sandwich-Pattern machine builder (`@matrix-fsm/angular/effect`).
 *
 * @group Effect-TS
 * @typeParam TContract - Public `MachineFeatureContract` (`inputs`, `events`, `outputs`, `states`).
 * @typeParam TRuntimeEnv - Effect service environment `R` required by `Effect.Effect<A, E, R>` methods.
 * @returns Curried builder creating a `MachineFeatureDefinition` powered by Effect fibers.
 *
 * @remarks
 * Executes `Effect.Effect<A, E, TRuntimeEnv>` values returned from `{ call: (m) => m._method }`
 * on `awaiting()` states via `Effect.runFork` (or custom `runtime.runFork`). Automatically
 * interrupts the active fiber on state exit or store destruction, enforces `[R] extends [TRuntimeEnv]`
 * at compile time, and routes `Data.TaggedError` failures directly to matching `_tag` columns in `VIA`.
 *
 * @example
 * ```ts
 * import { Data, Effect } from 'effect';
 * import { awaiting, finalState } from '@matrix-fsm/angular';
 * import { createEffectMachineFeature } from '@matrix-fsm/angular/effect';
 *
 * class PaymentDeclinedError extends Data.TaggedError('PaymentDeclinedError')<{
 *   readonly reason: string;
 * }> {}
 *
 * export const paymentEffectFSM = createEffectMachineFeature<{
 *   inputs: { orderId: string; amount: number };
 *   events: { CHARGE: void };
 *   outputs: { PAID: { receiptId: string } };
 *   states: 'ready' | 'charging' | 'declined' | 'failed';
 * }>()({
 *   id: 'paymentEffect',
 *   initial: 'ready',
 *   transitions: [
 *     ['ready',    'CHARGE',               awaiting('charging'), { call: (m) => m._charge }],
 *     ['charging', 'DONE',                 finalState(),         { output: ['PAID', (_c, receiptId) => ({ receiptId })] }],
 *     ['charging', 'PaymentDeclinedError', 'declined'],
 *     ['charging', 'ERROR',                'failed'],
 *   ],
 *   methods: () => ({
 *     _charge: (_p: void, _signal: AbortSignal, ctx) =>
 *       ctx.amount > 0
 *         ? Effect.succeed(`rcpt_${ctx.orderId}`)
 *         : Effect.fail(new PaymentDeclinedError({ reason: 'Invalid amount' })),
 *   }),
 * });
 * ```
 */
export function createEffectMachineFeature<
  TContract extends MachineFeatureContract = EmptyObject,
  TRuntimeEnv = never,
>(): <
  const TId extends string,
  const TInitial extends InitialStateTarget<FeatureStates<TContract>>,
  const TTransitions extends readonly TransitionRow<
    FeatureInputs<TContract> & TState,
    Extract<keyof FeatureEvents<TContract>, string>,
    FeatureStates<TContract>,
    NormalizeEffectMethods<FeatureMethods<TContract>>,
    FeatureOutputs<TContract>,
    FeatureInputs<TContract> & TState
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
    TTransitions,
    TRuntimeEnv
  > &
    ValidateContractKeys<TContract, keyof MachineFeatureContract>,
) => MachineFeatureDefinition<
  TId,
  ResolveInitialStateKey<TInitial>,
  ResolveContext<FeatureInputs<TContract> & TState, TTransitions>,
  FeatureEvents<TContract>,
  TTransitions,
  TMethods,
  FeatureInputs<TContract>,
  FeatureOutputs<TContract>
> {
  return (config: any) =>
    buildMachineFeatureRuntime(
      config,
      createEffectExecutorAdapter(config.runtime),
    );
}

/**
 * Bridges an `Effect.Effect<A, E, R>` into an `AbortSignal`-aware `Promise<A>` that
 * automatically interrupts the underlying Effect fiber if `signal` aborts.
 *
 * @group Effect-TS
 * @param effect - Effect program to execute.
 * @param signal - Optional `AbortSignal` (for example, from an `awaiting()` method signature).
 * @param runtime - Optional Effect runtime when `R` is non-`never`.
 * @returns Promise resolving with `A` or rejecting with the unwrapped failure / `AbortError`.
 *
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runEffect } from '@matrix-fsm/angular/effect';
 *
 * const controller = new AbortController();
 * const value = await runEffect(Effect.succeed(42), controller.signal);
 * ```
 */
export function runEffect<A, E = unknown, R = never>(
  effect: Effect.Effect<A, E, R>,
  signal?: AbortSignal,
  runtime?: EffectRuntimeLike<R>,
): Promise<A> {
  return new Promise<A>((resolve, reject) => {
    const createAbortError = () =>
      signal?.reason !== undefined
        ? signal.reason
        : new DOMException('The operation was aborted.', 'AbortError');

    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    let settled = false;
    const fiber = runtime
      ? runtime.runFork(effect)
      : Effect.runFork(effect as Effect.Effect<A, E, never>);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        if (runtime) {
          runtime.runFork(
            Fiber.interrupt(fiber) as Effect.Effect<unknown, never, R>,
          );
        } else {
          Effect.runFork(Fiber.interrupt(fiber));
        }
        reject(createAbortError());
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
      } else {
        reject(unwrapExitFailure(exit.cause));
      }
    });
  });
}
