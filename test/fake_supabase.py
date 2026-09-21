"""Minimal in-memory stand-in for the supabase-py client used by the backend."""

from types import SimpleNamespace

PKS = {
    "Event Details": "id", "users": "id", "Equipment": "equipment_id",
    "Equipment Request": "request_id", "Venue Booking Requests": "request_id",
    "Equipment Reservation": "reservation_id",
}


class Result(SimpleNamespace):
    pass


class Query:
    def __init__(self, client, name):
        self.client, self.name = client, name
        self.op, self.payload = "select", None
        self.filters, self.orders, self.single = [], [], False

    def select(self, *_): return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, key, value): self.filters.append(lambda r: r.get(key) == value); return self
    def in_(self, key, values): self.filters.append(lambda r: r.get(key) in values); return self
    def lt(self, key, value): self.filters.append(lambda r: r.get(key) is not None and r[key] < value); return self
    def gt(self, key, value): self.filters.append(lambda r: r.get(key) is not None and r[key] > value); return self
    def limit(self, *_): return self
    def order(self, key, desc=False): self.orders.append((key, desc)); return self
    def maybe_single(self): self.single = True; return self

    def execute(self):
        client = self.client
        client.log.append((self.name, self.op, self.payload))
        if self.name in client.fail_tables or (self.name, self.op) in client.fail_tables:
            raise client.fail_error or RuntimeError(f"simulated failure on {self.name}")
        rows = client.tables.setdefault(self.name, [])
        matched = [r for r in rows if all(f(r) for f in self.filters)]
        if self.op == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            created = []
            for item in payloads:
                row = dict(item)
                pk = PKS.get(self.name)
                if pk and pk not in row:
                    client.counter += 1
                    row[pk] = client.counter
                rows.append(row)
                created.append(dict(row))
            return Result(data=created if not client.empty_inserts else [])
        if self.op == "update":
            for row in matched:
                row.update(self.payload)
            return Result(data=[dict(r) for r in matched] if not client.empty_updates else [])
        if self.op == "delete":
            for row in matched:
                rows.remove(row)
            return Result(data=[dict(r) for r in matched])
        for key, desc in reversed(self.orders):
            matched.sort(key=lambda r: (r.get(key) is None, r.get(key)), reverse=desc)
        matched = [dict(r) for r in matched]
        if self.single:
            return Result(data=matched[0] if matched else None)
        return Result(data=matched)


class FakeClient:
    """tables: {name: [rows]}. Set fail_tables / empty_inserts / empty_updates to simulate faults."""

    def __init__(self, tables=None, auth_user=None, auth_error=None):
        self.tables = {k: [dict(r) for r in v] for k, v in (tables or {}).items()}
        self.log, self.fail_tables, self.counter = [], set(), 1000
        self.fail_error = None  # exception raised for tables in fail_tables (default RuntimeError)
        self.empty_inserts = self.empty_updates = False

        def get_user(token):
            if auth_error:
                raise auth_error
            return SimpleNamespace(user=auth_user)

        self.auth = SimpleNamespace(get_user=get_user)

    def table(self, name): return Query(self, name)

    def writes(self, table, op):
        return [p for t, o, p in self.log if t == table and o == op]
