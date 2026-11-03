import decimal


class Ledger:
    def __init__(self):
        self.rows = []

    def post(self, entry):
        self.rows.append(entry)
        return entry


def late_fee(days):
    return days * 5


async def sync():
    pass
