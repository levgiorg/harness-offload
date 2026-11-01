"""Price calculation for warehouse orders."""
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

VAT_RATES = {"GR": Decimal("0.24"), "DE": Decimal("0.19"), "FR": Decimal("0.20")}
BULK_TIERS = [(100, Decimal("0.10")), (50, Decimal("0.05")), (10, Decimal("0.02"))]


@dataclass(frozen=True)
class Line:
    sku: str
    unit_price: Decimal
    quantity: int


@dataclass(frozen=True)
class Quote:
    subtotal: Decimal
    discount: Decimal
    vat: Decimal
    total: Decimal


def bulk_discount_rate(quantity: int) -> Decimal:
    for threshold, rate in BULK_TIERS:
        if quantity >= threshold:
            return rate
    return Decimal("0")


def money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def quote(lines: list[Line], country: str) -> Quote:
    if country not in VAT_RATES:
        raise ValueError(f"unsupported country: {country}")
    subtotal = sum((l.unit_price * l.quantity for l in lines), Decimal("0"))
    units = sum(l.quantity for l in lines)
    discount = money(subtotal * bulk_discount_rate(units))
    taxable = subtotal - discount
    vat = money(taxable * VAT_RATES[country])
    return Quote(money(subtotal), discount, vat, money(taxable + vat))
