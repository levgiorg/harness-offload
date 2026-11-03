Three SQL queries run, all in `orders.py`, in two functions.

- `orders.py:L4` in `order_totals()`: `orders.py:L4` `db.query("SELECT * FROM orders WHERE customer_id = %s", cid)`
- `orders.py:L6` in `order_totals()`, inside the loop over each customer's orders: `orders.py:L6` `db.query("SELECT price, qty FROM order_lines WHERE order_id = %s", o.id)`
- `orders.py:L11` in `recent()`: `orders.py:L11` `return db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50")`

Notes:
- `orders.py` is the only non-git file in the working directory, so this covers the whole tree.
- The line 6 query runs once per order, so `order_totals()` issues one query per customer plus one per order.
- The search matched on SQL keywords and common DB call names (`.query(`, `.execute(`, `cursor.execute`, and similar). A query built some other way would not have matched.

rc=0
