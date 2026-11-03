Covered: `reserve`, `available`, and `commit`. Not covered: `release`, `restock`, `needsReorder`, and `expireStale`. When stock is short, `reserve` throws `OutOfStockError`.

- Covered by `inventory.test.ts`:
  - `reserve`: `{{DIR}}/fx/warehouse/inventory.test.ts:L19` `const r = await service.reserve('MUG-01', 4);`
  - `available`: `{{DIR}}/fx/warehouse/inventory.test.ts:L22` `expect(await service.available('MUG-01')).toBe(6);`
  - `commit`: `{{DIR}}/fx/warehouse/inventory.test.ts:L37` `await service.commit(r.id);`
- Not covered (no reference in the test file):
  - `release`: `{{DIR}}/fx/warehouse/inventory.ts:L51` `async release(reservationId: string): Promise<void> {`
  - `restock`: `{{DIR}}/fx/warehouse/inventory.ts:L69` `async restock(sku: Sku, quantity: number): Promise<StockLevel> {`
  - `needsReorder`: `{{DIR}}/fx/warehouse/inventory.ts:L77` `async needsReorder(): Promise<Sku[]> {`
  - `expireStale`: `{{DIR}}/fx/warehouse/inventory.ts:L82` `async expireStale(): Promise<number> {`
- Short-stock error:
  - Thrown at `{{DIR}}/fx/warehouse/inventory.ts:L42-L43` `if (free < quantity) {` / `throw new OutOfStockError(sku, quantity, free);`
  - `OutOfStockError` is defined at `{{DIR}}/fx/warehouse/inventory.ts:L20` `export class OutOfStockError extends Error {`
  - The test at `{{DIR}}/fx/warehouse/inventory.test.ts:L30` `await expect(service.reserve('MUG-01', 11)).rejects.toBeInstanceOf(OutOfStockError);` checks this.
- Other `reserve` error (not asked): a non-positive or non-integer quantity throws `RangeError` at `{{DIR}}/fx/warehouse/inventory.ts:L39` `throw new RangeError('quantity must be a positive integer');`

Uncertain: other test files outside the two provided may cover the uncovered methods. The answer covers only the two files given.

