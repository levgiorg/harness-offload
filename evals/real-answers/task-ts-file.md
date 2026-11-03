**Two N+1 patterns and one unbounded query in `order_totals`. `recent()` is fine.**

**Problems**

1. **N+1, outer level (one query per customer):** `orders.py:L3-L4` `for cid in customer_ids:` / `db.query("SELECT * FROM orders WHERE customer_id = %s", cid)`. The loop issues one query per customer ID.

2. **N+1, inner level (one query per order):** `orders.py:L5-L6` `for o in orders:` / `db.query("SELECT price, qty FROM order_lines WHERE order_id = %s", o.id)`. Every order triggers its own query, so total round trips grow with customers × orders.

3. **Missing LIMIT on the per-customer orders query:** `orders.py:L4` `db.query("SELECT * FROM orders WHERE customer_id = %s", cid)`. No LIMIT, and no pagination. A customer with many orders returns all of them in one result set.

4. **Missing LIMIT on the per-order lines query (lower severity):** `orders.py:L6` `db.query("SELECT price, qty FROM order_lines WHERE order_id = %s", o.id)`. Line count per order is usually small, so this is less serious than item 3, but it has no bound either.

**Suggested fix for `order_totals`:** replace both loops with one aggregate query, e.g. a JOIN of `orders` and `order_lines` with `WHERE customer_id IN (...)` and `GROUP BY customer_id`, computing `SUM(price * qty)`. This removes both N+1 patterns in one round trip. Batch the `IN` list if `customer_ids` can be large.

**Compliant:**
- `orders.py:L11` `return db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50")`. This query has a LIMIT.

**Uncertain:**
- Whether `customer_ids` is bounded by its callers. NOT FOUND: any caller or size limit for `customer_ids` in the provided material.
- Whether `db.query` applies a default row limit. NOT FOUND: the `db` implementation.

rc=0
