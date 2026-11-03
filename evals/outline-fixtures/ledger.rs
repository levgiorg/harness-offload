use std::fmt;

pub struct Ledger {
    rows: Vec<i64>,
}

impl Ledger {
    pub fn new() -> Self {
        Ledger { rows: vec![] }
    }

    pub fn post(&mut self, v: i64) {
        self.rows.push(v);
    }
}

fn late_fee(days: i64) -> i64 {
    days * 5
}
