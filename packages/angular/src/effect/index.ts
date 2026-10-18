/**
 * @matrix-fsm/angular/effect - Pluggable Effect-TS Fiber & TaggedError Task Adapter
 *
 * Importing this entrypoint automatically registers Effect-TS Fiber support
 * into `@matrix-fsm/angular`, keeping core `@matrix-fsm/angular` 100% free of
 * Effect-TS bundle weight for Promise / RxJS applications.
 */

import { Cause, Effect, Exit, Fiber } from 'effect';
import {
  registerTaskAdapter,
  type CustomTaskAdapter,
} from '../lib/with-state-machine.js';

export const effectTaskAdapter: CustomTaskAdapter = {
  canHandle(result: unknown): boolean {
    return Effect.isEffect(result);
  },
  execute<TContext>(
    result: unknown,
    callbacks: {
      onSuccess: (output: Partial<TContext> | void) => void;
      onFailure: (err: unknown) => void;
      isCancelled: () => boolean;
    },
  ): () => void {
    let fiber: Fiber.Fiber<any, any> | null = Effect.runFork(
      result as Effect.Effect<Partial<TContext> | void, any, never>,
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

// Automatically register Effect-TS task adapter when imported:
registerTaskAdapter(effectTaskAdapter);

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
