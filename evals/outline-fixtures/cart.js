const TAX = 0.19;

function total(items) {
  return items.reduce((a, b) => a + b, 0);
}

class Cart {
  add(item) {
    this.items.push(item);
  }
}

module.exports = { total, Cart };
