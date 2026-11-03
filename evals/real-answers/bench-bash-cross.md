`reserve`, `available`, and `commit` are exercised by the tests. `release`, `restock`, `needsReorder`, and `expireStale` have no tests. When stock is short, `reserve` throws `OutOfStockError`.

- Covered:
  - `reserve`: the 15-minute hold, the `RangeError` for non-positive quantities, and `OutOfStockError` ({{DIR}}/fx/warehouse/inventory.test.ts:L18-L31).
  - `available`: called directly in assertions ({{DIR}}/fx/warehouse/inventory.test.ts:L22 `expect(await service.available('MUG-01')).toBe(6);`). It is also called inside `reserve` ({{DIR}}/fx/warehouse/inventory.ts:L41 `const free = await this.available(sku);`).
  - `commit`: the stock-removal path and the expired-reservation path ({{DIR}}/fx/warehouse/inventory.test.ts:L34-L46).
- Not covered (no test references them):
  - `release` ({{DIR}}/fx/warehouse/inventory.ts:L51).
  - `restock` ({{DIR}}/fx/warehouse/inventory.ts:L69).
  - `needsReorder` ({{DIR}}/fx/warehouse/inventory.ts:L77).
  - `expireStale` ({{DIR}}/fx/warehouse/inventory.ts:L82).
- Short-stock error:
  - `reserve` throws `OutOfStockError` when `free < quantity` ({{DIR}}/fx/warehouse/inventory.ts:L42-L44 `if (free < quantity) {` / `throw new OutOfStockError(sku, quantity, free);`).
  - Message: `Not enough stock for ${sku}: requested ${requested}, available ${available}`. This is set in the class constructor ({{DIR}}/fx/warehouse/inventory.ts:L22).
  - The test asserts `rejects.toBeInstanceOf(OutOfStockError)` for a request of 11 against 10 on hand ({{DIR}}/fx/warehouse/inventory.test.ts:L30).

