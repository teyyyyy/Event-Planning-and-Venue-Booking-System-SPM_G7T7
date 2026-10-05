"""Carry the verified actor into database transactions for notification exclusion."""
from contextvars import ContextVar
from supabase import create_client as supabase_client
from supabase.lib.client_options import SyncClientOptions

request_actor = ContextVar("request_actor", default=None)


def create_client(url, key):
    context = request_actor.get()
    actor = context.get("id") if context else None
    options = SyncClientOptions(headers={"x-actor-id": str(actor)} if actor else {})
    return supabase_client(url, key, options=options)
