def order_totals(db, customer_ids):
    totals = {}
    for cid in customer_ids:
        orders = db.query("SELECT * FROM orders WHERE customer_id = %s", cid)
        for o in orders:
            lines = db.query("SELECT price, qty FROM order_lines WHERE order_id = %s", o.id)
            totals[cid] = totals.get(cid, 0) + sum(l.price * l.qty for l in lines)
    return totals

def recent(db):
    return db.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 50")
