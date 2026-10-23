import { Component, computed, inject } from '@angular/core';
import { toMermaid } from '@matrix-fsm/core';
import {
  CoffeeShopApiService,
  type LoyaltySimulationMode,
} from './coffee-shop-api.service';
import {
  COFFEE_MENU,
  type CoffeeDrink,
  isTenthDrinkEligible,
} from './coffee-shop.domain';
import { coffeeShopFSM } from './coffee-shop.machine';
import { CoffeeShopStore } from './coffee-shop.store';

@Component({
  selector: 'app-coffee-shop-example',
  standalone: true,
  providers: [CoffeeShopStore], // Zero BaristaStore / provideStateMachine boilerplate!
  templateUrl: './coffee-shop-example.component.html',
  styleUrl: './coffee-shop-example.component.css',
})
export class CoffeeShopExampleComponent {
  readonly store = inject(CoffeeShopStore);
  readonly api = inject(CoffeeShopApiService);

  readonly menu = COFFEE_MENU;
  readonly mermaidDiagram = toMermaid(coffeeShopFSM);

  readonly stampSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  readonly isNextDrinkFreePreview = computed(() =>
    isTenthDrinkEligible(this.store.fsmContext().customerCard.currentStamps),
  );

  selectDrink(drink: CoffeeDrink): void {
    this.store.send('SELECT_DRINK', { drink });
  }

  setStampCount(stamps: number): void {
    this.store.send('SET_STAMPS', { stamps });
  }

  setApiMode(mode: LoyaltySimulationMode): void {
    this.api.setSimulationMode(mode);
    if (mode === 'tenth_free') {
      this.store.send('SET_STAMPS', { stamps: 9 });
    }
  }

  placeOrder(): void {
    this.store.send('PLACE_ORDER');
  }

  pay(): void {
    this.store.send('PAY');
  }

  startBrewing(): void {
    this.store.send('START_BREWING');
  }

  takeCoffee(): void {
    this.store.send('TAKE_COFFEE');
  }

  finishCoffee(): void {
    this.store.send('FINISH_COFFEE');
  }

  cancel(): void {
    this.store.send('CANCEL');
  }

  retry(): void {
    this.store.send('RETRY');
  }

  bypassCard(): void {
    this.store.send('BYPASS_CARD');
  }
}
