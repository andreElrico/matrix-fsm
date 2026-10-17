import { Component, computed, inject } from '@angular/core';
import { toMermaid } from '@matrix-fsm/core';
import {
  AuthApiService,
  GlobalAuthStore,
  UserRole,
  type ApiSimulationMode,
} from './core';
import { calculateSubscriptionPrice } from './domain/pricing.domain';
import { authFSM } from './features/auth/auth.machine';
import { AuthFeatureStore } from './features/auth/auth.store';

@Component({
  selector: 'app-root',
  standalone: true,
  providers: [AuthFeatureStore],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly store = inject(AuthFeatureStore);
  readonly globalAuth = inject(GlobalAuthStore);
  readonly authApi = inject(AuthApiService);

  readonly UserRole = UserRole;
  readonly mermaidDiagram = toMermaid(authFSM);

  readonly monthlyPrice = computed(() =>
    calculateSubscriptionPrice(99, this.store.fsmContext().policy),
  );

  updateEmail(email: string): void {
    this.store.send('UPDATE_CREDENTIALS', { email });
  }

  updatePassword(password: string): void {
    this.store.send('UPDATE_CREDENTIALS', { password });
  }

  setRole(role: UserRole): void {
    this.globalAuth.setRole(role);
  }

  setApiMode(mode: ApiSimulationMode): void {
    this.authApi.setSimulationMode(mode);
  }
}
