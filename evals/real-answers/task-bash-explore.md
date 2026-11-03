**Answer:** Three SQL queries run, all in `orders.py`.

- `orders.py:4` in `order_totals()`: `db.query("SELECT * FROM orders WHERE customer_id = %s", cid)`. The `db.query` call runs once per customer ID.
- `orders.py:6` in `order_totals()`: `db.query("SELECT price, qty FROM order_lines WHERE order_id = %s", o.id)`. This runs once per order, nested inside the loop above.
- `orders.py:11` in `recent()`: `db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50")`.

**Notes:**
- Lines 4 and 6 are an N+1 pattern: one query per customer, then one per order.
- The grep matched on `.query(`, `.execute(`, `.raw(`, `.prepare(`, and raw SQL keywords. No other matches came back.

**Uncertain:**
- ripgrep skips hidden and gitignored files by default, so SQL in those files would not appear in the results. I did not re-run the search with those included.
- Matches only cover the SQL patterns listed above. ORM-style calls (for example, `.filter()` or `.objects`) would not match, and none were searched for.

rc=0
