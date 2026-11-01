import { Clock, systemClock } from './clock';
import { StockStore } from './store';

export type Sku = string;

export interface StockLevel {
  sku: Sku;
  onHand: number;
  reserved: number;
  reorderPoint: number;
}

export interface Reservation {
  id: string;
  sku: Sku;
  quantity: number;
  expiresAt: Date;
}

export class OutOfStockError extends Error {
  constructor(public readonly sku: Sku, public readonly requested: number, public readonly available: number) {
    super(`Not enough stock for ${sku}: requested ${requested}, available ${available}`);
  }
}

export class InventoryService {
  private readonly holdMinutes = 15;

  constructor(private readonly store: StockStore, private readonly clock: Clock = systemClock) {}

  async available(sku: Sku): Promise<number> {
    const level = await this.store.level(sku);
    if (!level) return 0;
    return Math.max(0, level.onHand - level.reserved);
  }

  async reserve(sku: Sku, quantity: number): Promise<Reservation> {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new RangeError('quantity must be a positive integer');
    }
    const free = await this.available(sku);
    if (free < quantity) {
      throw new OutOfStockError(sku, quantity, free);
    }
    const expiresAt = new Date(this.clock.now().getTime() + this.holdMinutes * 60_000);
    const reservation = await this.store.addReservation({ sku, quantity, expiresAt });
    await this.store.adjustReserved(sku, quantity);
    return reservation;
  }

  async release(reservationId: string): Promise<void> {
    const reservation = await this.store.reservation(reservationId);
    if (!reservation) return;
    await this.store.adjustReserved(reservation.sku, -reservation.quantity);
    await this.store.removeReservation(reservationId);
  }

  async commit(reservationId: string): Promise<void> {
    const reservation = await this.store.reservation(reservationId);
    if (!reservation) throw new Error(`Unknown reservation ${reservationId}`);
    if (reservation.expiresAt.getTime() < this.clock.now().getTime()) {
      throw new Error(`Reservation ${reservationId} expired`);
    }
    await this.store.adjustOnHand(reservation.sku, -reservation.quantity);
    await this.store.adjustReserved(reservation.sku, -reservation.quantity);
    await this.store.removeReservation(reservationId);
  }

  async restock(sku: Sku, quantity: number): Promise<StockLevel> {
    if (quantity <= 0) throw new RangeError('restock quantity must be positive');
    await this.store.adjustOnHand(sku, quantity);
    const level = await this.store.level(sku);
    if (!level) throw new Error(`Unknown SKU ${sku}`);
    return level;
  }

  async needsReorder(): Promise<Sku[]> {
    const levels = await this.store.allLevels();
    return levels.filter((l) => l.onHand - l.reserved <= l.reorderPoint).map((l) => l.sku);
  }

  async expireStale(): Promise<number> {
    const now = this.clock.now().getTime();
    const stale = (await this.store.allReservations()).filter((r) => r.expiresAt.getTime() < now);
    for (const r of stale) {
      await this.release(r.id);
    }
    return stale.length;
  }
}
