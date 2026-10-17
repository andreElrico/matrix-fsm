/**
 * Layer 1 (Core): Auth API Service & Effect-TS Tagged Errors
 */

import { Data, Effect } from 'effect';

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

export class NetworkTimeoutError extends Data.TaggedError('NetworkTimeoutError')<{
  readonly message: string;
}> {}

export type ApiSimulationMode = 'success' | 'timeout' | 'invalid_credentials' | 'slow_success';

export class AuthApiService {
  private mode: ApiSimulationMode = 'success';
  public callCount = 0;

  setSimulationMode(mode: ApiSimulationMode): void {
    this.mode = mode;
  }

  loginEffect(
    credentials: Credentials,
  ): Effect.Effect<User, NetworkTimeoutError | Error> {
    return Effect.suspend(() => {
      this.callCount++;

      if (this.mode === 'timeout') {
        return Effect.fail(
          new NetworkTimeoutError({
            message: 'Connection to auth cluster timed out (504)',
          }),
        );
      }

      if (this.mode === 'invalid_credentials') {
        return Effect.fail(new Error('Invalid email or password'));
      }

      const user: User = {
        id: 'usr_matrix_01',
        email: credentials.email,
        name: credentials.email.split('@')[0] ?? 'User',
      };

      if (this.mode === 'slow_success') {
        return Effect.sleep('200 millis').pipe(Effect.map(() => user));
      }

      return Effect.succeed(user);
    });
  }
}
