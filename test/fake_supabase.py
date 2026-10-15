"""Minimal in-memory stand-in for the supabase-py client used by the backend."""

from types import SimpleNamespace

PKS = {
    "Event Details": "id", "users": "id", "Equipment": "equipment_id",
    "Equipment Request": "request_id", "Venue Booking Requests": "request_id",
    "event_change_requests": "id", "notifications": "id",
    "Equipment Reservation": "reservation_id", "Equipment Reservation Item": "reservation_item_id",
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
    def neq(self, key, value): self.filters.append(lambda r: r.get(key) != value); return self
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

    def rpc(self, name, params):
        from copy import deepcopy
        from postgrest.exceptions import APIError
        def execute():
            if name == "submit_event_change_request":
                snapshot = deepcopy(self.tables)
                try:
                    event_id = params["p_event_id"]
                    organiser_id = params["p_organiser_id"]
                    request_text = params["p_request_text"]
                    proposal = {
                        "proposed_event_name": params["p_event_name"],
                        "proposed_event_type": params["p_event_type"],
                        "proposed_event_date": params["p_event_date"],
                        "proposed_event_end_date": params["p_event_end_date"],
                        "proposed_event_capacity": params["p_event_capacity"],
                        "proposed_description": params["p_description"],
                        "proposed_start_time": params["p_start_time"],
                        "proposed_end_time": params["p_end_time"],
                    }
                    event = next(
                        (row for row in self.tables.get("Event Details", []) if str(row.get("id")) == str(event_id)),
                        None,
                    )
                    if not event:
                        raise APIError({"message": "Event request not found.", "code": "P0002", "details": None, "hint": None})
                    if str(event.get("organiser_id")) != str(organiser_id):
                        raise APIError({"message": "You can only request changes to your own event.", "code": "42501", "details": None, "hint": None})
                    if str(event.get("status", "")).strip().lower() in {"", "draft", "completed", "cancelled", "rejected"}:
                        raise APIError({"message": "Change requests are not available for this event status.", "code": "22023", "details": None, "hint": None})
                    if not event.get("coordinator_id"):
                        raise APIError({"message": "An event coordinator must be assigned before requesting changes.", "code": "22023", "details": None, "hint": None})
                    if not request_text.strip() or len(request_text.strip()) > 5000:
                        raise APIError({"message": "Change requests must contain 1 to 5,000 characters.", "code": "22023", "details": None, "hint": None})
                    if any(
                        str(row.get("event_id")) == str(event_id) and row.get("review_status") == "Pending"
                        for row in self.tables.get("event_change_requests", [])
                    ):
                        raise APIError({"message": "This event already has a pending change request.", "code": "22023", "details": None, "hint": None})
                    created = self.table("event_change_requests").insert({
                        "event_id": event_id,
                        "organiser_id": organiser_id,
                        "coordinator_id": event["coordinator_id"],
                        "request_text": request_text.strip(),
                        **proposal,
                        "review_status": "Pending",
                        "reviewed_by": None,
                        "reviewed_at": None,
                        "review_comments": None,
                    }).execute().data
                    if created:
                        self.table("notifications").insert({
                            "recipient_id": event["coordinator_id"],
                            "description": f'Change request for "{event.get("event_name", "Event")}": {request_text.strip()}',
                            "record_type": "event",
                            "record_id": str(event_id),
                            "is_read": False,
                        }).execute()
                    return Result(data=created[0] if created else None)
                except Exception:
                    self.tables = snapshot
                    raise
            if name == "review_event_change_request":
                request = next(
                    (
                        row for row in self.tables.get("event_change_requests", [])
                        if str(row.get("id")) == str(params["p_request_id"])
                    ),
                    None,
                )
                if not request:
                    raise APIError({"message": "Event change request not found.", "code": "P0002", "details": None, "hint": None})
                if str(request.get("coordinator_id")) != str(params["p_coordinator_id"]):
                    raise APIError({"message": "You can only review change requests assigned to you.", "code": "42501", "details": None, "hint": None})
                if request.get("review_status") != "Pending":
                    raise APIError({"message": "This event change request has already been reviewed.", "code": "55000", "details": None, "hint": None})
                decision = params["p_decision"]
                comments = params.get("p_review_comments")
                if decision not in {"Approved", "Rejected"}:
                    raise APIError({"message": "Decision must be Approved or Rejected.", "code": "22023", "details": None, "hint": None})
                if decision == "Rejected" and not str(comments or "").strip():
                    raise APIError({"message": "A reason is required when rejecting a change request.", "code": "22023", "details": None, "hint": None})
                event = next(
                    (
                        row for row in self.tables.get("Event Details", [])
                        if str(row.get("id")) == str(request.get("event_id"))
                    ),
                    None,
                )
                if not event:
                    raise APIError({"message": "Event request not found.", "code": "P0002", "details": None, "hint": None})
                event_name = event.get("event_name") or "Event"
                snapshot = deepcopy(self.tables)
                try:
                    if decision == "Approved":
                        event.update({
                            "event_name": request.get("proposed_event_name"),
                            "event_type": request.get("proposed_event_type"),
                            "event_date": request.get("proposed_event_date"),
                            "event_end_date": request.get("proposed_event_end_date"),
                            "event_capacity": request.get("proposed_event_capacity"),
                            "description": request.get("proposed_description"),
                            "start_time": request.get("proposed_start_time"),
                            "end_time": request.get("proposed_end_time"),
                        })
                    request.update({
                        "review_status": decision,
                        "reviewed_by": params["p_coordinator_id"],
                        "reviewed_at": "2026-10-04T00:00:00+00:00",
                        "review_comments": str(comments).strip() if comments else None,
                    })
                    reason = f": {comments.strip()}" if decision == "Rejected" else ""
                    self.table("notifications").insert({
                        "recipient_id": request["organiser_id"],
                        "description": f'Change request for "{event_name}" was {decision.lower()}{reason}',
                        "record_type": "event",
                        "record_id": str(event["id"]),
                        "is_read": False,
                    }).execute()
                    return Result(data=dict(request))
                except Exception:
                    self.tables = snapshot
                    raise
            if name != "submit_equipment_request":
                raise NotImplementedError(name)
            snapshot = deepcopy(self.tables)
            try:
                header = self.table("Equipment Request").insert({
                    "event_id": params["p_event_id"], "created_by": params["p_coordinator_id"],
                    "status": "Submitted",
                }).execute().data
                if not header:
                    self.tables = snapshot
                    return Result(data=None)
                rid = header[0]["request_id"]
                items = self.table("Equipment Request Item").insert([
                    {**item, "request_id": rid} for item in params["p_items"]
                ]).execute().data
                return Result(data={"request_id": rid, "event_id": params["p_event_id"], "items": items})
            except Exception as error:
                self.tables = snapshot
                raise APIError({"message": str(error), "code": "P0001", "details": None, "hint": None}) from error
        return SimpleNamespace(execute=execute)

    def writes(self, table, op):
        return [p for t, o, p in self.log if t == table and o == op]
