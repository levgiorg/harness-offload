**Two problems in `orders.py`: an N+1 query pattern in `order_totals`, and unbounded queries there. `recent()` is fine.**

**N+1 queries**
- `orders.py:L4` `orders = db.query("SELECT * FROM orders WHERE customer_id = %s", cid)` runs one query per customer, inside the loop started at `orders.py:L3` `for cid in customer_ids:`.
- `orders.py:L6` `lines = db.query("SELECT price, qty FROM order_lines WHERE order_id = %s", o.id)` runs one query per order. Total round trips are 1 + N customers + M orders.
- Fix: fetch all orders for the customer IDs in one query (`WHERE customer_id IN (...)`), fetch all their lines in one query, or compute the totals with a single `JOIN` and `GROUP BY customer_id`.

**Missing LIMIT**
- `orders.py:L4` `SELECT * FROM orders WHERE customer_id = %s` has no LIMIT. A customer with many orders returns all of them.
- `orders.py:L6` `SELECT price, qty FROM order_lines WHERE order_id = %s` has no LIMIT. This is less risky, since the rows are bounded by one order, but it is still unbounded. Summing totals in SQL would avoid loading the rows at all.

**Not a problem**
- `orders.py:L11` `return db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50")` has a LIMIT and no loop.

**Uncertain:**
- The size of `customer_ids` is not in the material, so I can't tell how severe the N+1 cost is.
- NOT FOUND: the implementation of `db.query`. If it applies a default row limit or pagination, the missing-LIMIT findings would change.

rc=0
