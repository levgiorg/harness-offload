import { describe, it, expect, beforeEach } from 'vitest';
import { InventoryService, OutOfStockError } from './inventory';
import { MemoryStockStore } from './testing/memory-store';
import { FixedClock } from './testing/fixed-clock';

describe('InventoryService', () => {
  let store: MemoryStockStore;
  let clock: FixedClock;
  let service: InventoryService;

  beforeEach(() => {
    store = new MemoryStockStore([{ sku: 'MUG-01', onHand: 10, reserved: 0, reorderPoint: 3 }]);
    clock = new FixedClock(new Date('2026-01-01T10:00:00Z'));
    service = new InventoryService(store, clock);
  });

  describe('reserve', () => {
    it('holds stock for fifteen minutes', async () => {
      const r = await service.reserve('MUG-01', 4);
      expect(r.quantity).toBe(4);
      expect(r.expiresAt.toISOString()).toBe('2026-01-01T10:15:00.000Z');
      expect(await service.available('MUG-01')).toBe(6);
    });

    it('rejects non-positive quantities', async () => {
      await expect(service.reserve('MUG-01', 0)).rejects.toThrow(RangeError);
    });

    it('throws OutOfStockError when there is not enough free stock', async () => {
      await expect(service.reserve('MUG-01', 11)).rejects.toBeInstanceOf(OutOfStockError);
    });
  });

  describe('commit', () => {
    it('removes the reserved units from stock', async () => {
      const r = await service.reserve('MUG-01', 2);
      await service.commit(r.id);
      expect((await store.level('MUG-01'))?.onHand).toBe(8);
      expect(await service.available('MUG-01')).toBe(8);
    });

    it('refuses an expired reservation', async () => {
      const r = await service.reserve('MUG-01', 2);
      clock.advanceMinutes(16);
      await expect(service.commit(r.id)).rejects.toThrow('expired');
    });
  });
});
