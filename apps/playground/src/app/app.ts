import { Component, signal } from '@angular/core';
import { AuthExampleComponent } from './features/auth/auth-example.component';
import { CoffeeShopExampleComponent } from './features/coffee-shop/coffee-shop-example.component';

export type ExampleBranchId = 'auth' | 'coffee-shop';

export interface DecisionTreeBranch {
  readonly id: ExampleBranchId;
  readonly title: string;
  readonly category: string;
  readonly badge: string;
  readonly icon: string;
  readonly patterns: readonly string[];
  readonly description: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AuthExampleComponent, CoffeeShopExampleComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly activeBranch = signal<ExampleBranchId>('coffee-shop');

  readonly branches: readonly DecisionTreeBranch[] = [
    {
      id: 'auth',
      title: 'Authentication & Entitlements',
      category: 'Layer 1-3 Architecture',
      badge: 'Core Pattern',
      icon: '🔐',
      patterns: [
        'Reactive Policy Mirroring (syncContext)',
        'Effect-TS Exponential Retry',
        'TaggedError (_tag) Direct Routing',
        'Fiber Interruption on CANCEL',
      ],
      description:
        'Demonstrates clean separation: GlobalAuthStore policies, pure authFSM matrix, and SignalStore integration.',
    },
    {
      id: 'coffee-shop',
      title: 'Coffee Shop & Loyalty Program',
      category: 'Multi-Role & Business Workflow',
      badge: 'Best Practices',
      icon: '☕',
      patterns: [
        'Multi-Role Workflow (👤 Customer • 🧑‍💼 Cashier • ☕ Barista)',
        '10th Drink FREE Loyalty API check',
        'First-Match Guard Branching (Free vs Pay)',
        'Barista Brewing Task with Fiber Cancellation',
      ],
      description:
        'Customer orders coffee, Cashier checks loyalty card via API (10th free vs pay), Barista brews beverage, and Customer drinks it.',
    },
  ];

  selectBranch(id: ExampleBranchId): void {
    this.activeBranch.set(id);
  }
}
