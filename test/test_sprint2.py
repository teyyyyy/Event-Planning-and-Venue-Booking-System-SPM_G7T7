"""Sprint 2 API boundaries. Database invariants are tested in sprint2_sql.mjs."""
from types import SimpleNamespace
from datetime import datetime, timedelta
import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
import main
import auth
import attendee_registration as ar
import notifications as notifications
import database
from fake_supabase import FakeClient
from tc import tc

client = TestClient(main.app)

@pytest.fixture
def world(monkeypatch):
    future = (datetime.now(ar.SGT) + timedelta(days=2)).date().isoformat()
    event = {"id": 1, "event_name": "Gather", "status": "Confirmed", "event_date": future,
             "start_time": "12:00:00", "end_time": "13:00:00", "event_capacity": 1,
             "description": "Latest details", "organiser_id": "o1", "coordinator_id": "c1"}
    fake = FakeClient({"Event Details": [event], "event_registrations": [],
        "Venue Booking Requests": [{"request_id": 1, "event_id": 1, "venue_id": 2, "status": "Approved", "venue_staff_id": "v1"},
                                    {"request_id": 2, "event_id": 1, "venue_id": 3, "status": "Pending"}],
        "Venues": [{"venue_id": 2, "name": "Hall", "location": "Campus"}],
        "notifications": [{"id": 1, "recipient_id": "a1", "record_type": "event", "record_id": "1", "is_read": False, "created_at": "2026-01-01"},
                          {"id": 2, "recipient_id": "a2", "record_type": "event", "record_id": "1", "is_read": False, "created_at": "2026-01-01"}]})
    monkeypatch.setattr(ar, "db", lambda: fake)
    monkeypatch.setattr(notifications, "db", lambda: fake)
    monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda: {"id": "a1", "role": "Attendee"})
    return fake

@tc("BE-SP2-001", "Attendee events", "Upcoming confirmed events exist.", "Only upcoming confirmed events and approved venue details are returned.", steps="1. Add draft and past events. 2. GET attendee events.")
def test_available_events(world):
    world.tables['Event Details'] += [dict(world.tables['Event Details'][0], id=2, status='Draft'), dict(world.tables['Event Details'][0], id=3, event_date='2000-01-01')]
    rows = client.get('/api/attendee/events').json()
    assert len(rows) == 1 and rows[0]['venues'][0]['name'] == 'Hall'
    assert 'organiser_id' not in rows[0] and rows[0]['registered'] is False

@tc("BE-SP2-002", "My registrations", "Other attendees have registrations and this attendee registered for a cancelled event.", "Only this attendee's registration is shown, with current details and cancelled status.", steps="1. GET registrations as a1.")
def test_own_cancelled_registrations(world):
    world.tables['event_registrations'] = [{'event_id': 1, 'attendee_id': 'a1', 'registered_at': '2026-01-01'}, {'event_id': 7, 'attendee_id': 'a2', 'registered_at': '2026-01-02'}]
    world.tables['Event Details'][0]['status'] = 'Cancelled'
    rows = client.get('/api/attendee/registrations').json()
    assert len(rows) == 1 and rows[0]['status'] == 'Cancelled' and rows[0]['description'] == 'Latest details'

@tc("BE-SP2-003", "Registration", "A caller attempts to supply another attendee identity.", "RPC uses the verified caller ID and returns success.", steps="1. POST registration with spoofed attendee_id.", kind="Security")
def test_registration_identity(world, monkeypatch):
    calls = []
    monkeypatch.setattr(world, 'rpc', lambda name, params: (calls.append((name, params)) or SimpleNamespace(execute=lambda: SimpleNamespace(data={'event_id': 1, 'attendee_id': 'a1'}))))
    response = client.post('/api/attendee/events/1/register', json={'attendee_id': 'a2'})
    assert response.status_code == 201
    assert calls == [('register_for_event', {'p_event_id': 1, 'p_attendee_id': 'a1'})]

@tc("BE-SP2-006", "Registration errors", "The registration RPC rejects a duplicate, invalid event state, unknown event, forbidden caller or internal failure.", "Expected HTTP status and safe error detail are returned.", steps="1. Simulate each RPC rejection. 2. POST registration. 3. Check response.", kind="Negative")
def test_rpc_errors(world, monkeypatch):
    for code, status in [('23505',409),('P0001',409),('P0002',404),('42501',403),('XX000',503)]:
        def failure(*args): raise APIError({'code': code, 'message': 'Registration blocked', 'details': None, 'hint': None})
        monkeypatch.setattr(world, 'rpc', failure)
        response = client.post('/api/attendee/events/1/register')
        assert response.status_code == status, code
        assert response.json()['detail'] == ('Registration is temporarily unavailable. Please try again.' if status == 503 else 'Registration blocked')

@tc("BE-SP2-004", "Notifications", "Two users have notifications.", "User a1 can list and mark only their own notification read.", steps="1. GET list. 2. PATCH own read status. 3. PATCH another recipient's notification.", kind="Security")
def test_notification_ownership(world):
    assert [n['id'] for n in client.get('/api/notifications').json()] == [1]
    assert client.patch('/api/notifications/1/read').json()['is_read'] is True
    assert client.patch('/api/notifications/2/read').status_code == 404
    assert world.tables['notifications'][1]['is_read'] is False
    assert client.get('/api/notifications/2/record').status_code == 404

@tc("BE-SP2-005", "Notification link", "Recipient no longer has a registration for the event.", "Record access is denied; restoring registration grants event access.", steps="1. Open record. 2. Add own registration. 3. Reopen record.", kind="Security")
def test_link_rechecks_access(world):
    assert client.get('/api/notifications/1/record').status_code == 403
    world.tables['event_registrations'] = [{'event_id': 1, 'attendee_id': 'a1'}]
    assert client.get('/api/notifications/1/record').json()['event']['event_name'] == 'Gather'

@tc("BE-SP2-007", "Sprint 2 authentication", "Caller has no session.", "All attendee and notification endpoints reject the request before database access.", steps="1. GET browse, registrations, inbox and linked record. 2. POST registration. 3. PATCH read status.", kind="Security")
def test_auth_required():
    for method, path in [('GET','/api/attendee/events'),('GET','/api/attendee/registrations'),('GET','/api/notifications'),('GET','/api/notifications/1/record'),('POST','/api/attendee/events/1/register'),('PATCH','/api/notifications/1/read')]:
        assert client.request(method,path).status_code == 401, path

@tc("BE-SP2-008", "Attendee role", "A coordinator attempts attendee registration.", "HTTP 403.", steps="1. Authenticate as coordinator. 2. POST registration.", kind="Security")
def test_staff_cannot_register(world, monkeypatch):
    monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda: {'id': 'c1','role': 'Event Coordinator'})
    assert client.post('/api/attendee/events/1/register').status_code == 403

@tc("BE-SP2-009", "Notification actor", "A verified identity is forwarded into database writes.", "Actor header matches verified user and is absent outside the request context.", steps="1. Verify user. 2. Create DB client in request context. 3. Reset context and create another client.", kind="Security")
def test_actor_is_verified_and_forwarded(monkeypatch):
    fake = FakeClient({'users': [{'id':'a1','role':'Attendee'}]}, auth_user=SimpleNamespace(id='a1'))
    monkeypatch.setattr(auth, 'db', lambda: fake)
    monkeypatch.setattr(auth, 'MFA_REQUIRED', False)
    captured = []
    monkeypatch.setattr(database, 'supabase_client', lambda url,key,options: captured.append(options.headers))
    token = database.request_actor.set({})
    try:
        auth.current_user('Bearer verified-token')
        database.create_client('url','key')
        assert captured[-1]['x-actor-id'] == 'a1'
    finally:
        database.request_actor.reset(token)
    database.create_client('url','key')
    assert 'x-actor-id' not in captured[-1]


@tc("BE-SP2-010", "Missing Sprint 2 migration", "Registration or notification table is missing.", "HTTP 503 explains the setup step and retains CORS headers.", steps="1. Fail each table query as missing. 2. Request its endpoint with browser Origin.", kind="Regression")
def test_missing_migration_returns_readable_cors_error(world):
    for path, table in [("/api/attendee/events", "event_registrations"),("/api/notifications", "notifications")]:
        world.fail_tables = {table}
        world.fail_error = APIError({"code": "PGRST205", "message": f"Could not find the table public.{table} in the schema cache", "details": None, "hint": None})
        response = client.get(path, headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 503
        assert "sprint2_registration_notifications.sql" in response.json()["detail"]
        assert response.headers["access-control-allow-origin"] == "http://localhost:5173"

@tc("BE-SP2-011", "Database error privacy", "A database operation fails with internal details.", "HTTP 503 does not expose those details.", steps="1. Fail inbox query. 2. Check public error response.", kind="Security")
def test_database_errors_do_not_expose_internals(world):
    world.fail_tables.add("notifications")
    world.fail_error = APIError({"code": "XX000", "message": "Private database details", "details": None, "hint": None})
    response = client.get("/api/notifications")
    assert response.status_code == 503
    assert "Private database details" not in response.text

@tc("BE-SP2-012", "Attendee browse flags", "Only another attendee is registered; then the caller registers.", "The registered flag is scoped to the caller and updates on a fresh read.", steps="1. Add another attendee registration. 2. Browse. 3. Add own registration. 4. Browse again.", kind="Security")
def test_browse_registration_flags(world):
    world.tables['event_registrations'] = [{'event_id': 1, 'attendee_id': 'a2'}]
    assert client.get('/api/attendee/events').json()[0]['registered'] is False
    world.tables['event_registrations'].append({'event_id': 1, 'attendee_id': 'a1'})
    assert client.get('/api/attendee/events').json()[0]['registered'] is True

@tc("BE-SP2-013", "Registration empty state", "Attendee has no registrations.", "Empty array is returned without querying other attendees' event details.", steps="1. GET own registrations against an empty registration table.", kind="Edge")
def test_empty_registrations(world):
    assert client.get('/api/attendee/registrations').json() == []
    assert not any(table == 'Event Details' for table, _, _ in world.log)

@tc("BE-SP2-014", "Event schedule eligibility", "An event starts exactly now or has incomplete date/time.", "Started and invalid schedules are excluded; a future Singapore start is eligible.", steps="1. Freeze Singapore time. 2. Check exact start, future start and invalid schedules.", kind="Edge")
def test_start_boundary(monkeypatch):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None): return cls(2030, 1, 1, 12, 0, tzinfo=ar.SGT)
    monkeypatch.setattr(ar, 'datetime', FrozenDateTime)
    assert ar.has_started({'event_date':'2030-01-01','start_time':'12:00:00'})
    assert not ar.has_started({'event_date':'2030-01-01','start_time':'12:00:01'})
    for event in [{}, {'event_date':'bad','start_time':'12:00'}, {'event_date':'2030-01-01','start_time':None}]:
        assert ar.has_started(event)

@tc("BE-SP2-015", "Latest registered details", "Event details change after registration.", "A new read returns the updated details and approved venues only.", steps="1. Register fake attendee. 2. Read details. 3. Change name and venue status. 4. Read again.")
def test_latest_registered_details(world):
    world.tables['event_registrations'] = [{'event_id':1,'attendee_id':'a1','registered_at':'2026-01-01'}]
    assert client.get('/api/attendee/registrations').json()[0]['venues'][0]['name'] == 'Hall'
    world.tables['Event Details'][0]['event_name'] = 'Updated Gather'
    world.tables['Venue Booking Requests'][0]['status'] = 'Rejected'
    event = client.get('/api/attendee/registrations').json()[0]
    assert event['event_name'] == 'Updated Gather' and event['venues'] == []

@tc("BE-SP2-016", "Read status persistence", "User marks the same notification read twice.", "Both calls succeed, a fresh list reports read, and another user's notification remains unread.", steps="1. PATCH own notification twice. 2. Reload inbox.")
def test_read_idempotence(world):
    for _ in range(2): assert client.patch('/api/notifications/1/read').status_code == 200
    assert client.get('/api/notifications').json()[0]['is_read'] is True
    assert world.tables['notifications'][1]['is_read'] is False

@tc("BE-SP2-017", "Notification missing targets", "A notification points to a deleted event or unsupported record type.", "HTTP 404 instead of exposing unrelated data.", steps="1. Open a missing event link. 2. Open an unsupported target link.", kind="Negative")
def test_missing_targets(world):
    world.tables['notifications'][0]['record_id'] = '999'
    assert client.get('/api/notifications/1/record').status_code == 404
    world.tables['notifications'][0]['record_type'] = 'unknown'
    assert client.get('/api/notifications/1/record').status_code == 404

@tc("BE-SP2-018", "Event link authorization", "Recipients with different roles open an event notification.", "Only the organiser, assigned coordinator, registered attendee and responsible staff can read the event.", steps="1. Test related and unrelated identities for all five roles. 2. Check HTTP 200 or 403.", kind="Security")
def test_event_link_role_relationships(world, monkeypatch):
    world.tables['event_registrations'] = [{'event_id':1,'attendee_id':'a1'}]
    world.tables['Equipment Request'] = [{'request_id':1,'event_id':1}]
    for role, uid, expected in [('Event Organiser','o1',200),('Event Organiser','o2',403),('Event Coordinator','c1',200),('Event Coordinator','c2',403),('Attendee','a1',200),('Attendee','a3',403),('Venue Staff','v1',200),('Technical Support Staff','t1',200)]:
        world.tables['notifications'][0]['recipient_id'] = uid
        monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda role=role,uid=uid: {'role':role,'id':uid})
        assert client.get('/api/notifications/1/record').status_code == expected, (role,uid)
    world.tables['Equipment Request'] = []
    assert client.get('/api/notifications/1/record').status_code == 403

@tc("BE-SP2-019", "Booking notification links", "Venue and equipment notifications are opened by related and unrelated recipients.", "Only authorized recipients see the exact request with venue or item details.", steps="1. Open venue link as assigned staff, requester and unrelated users. 2. Repeat for equipment request.", kind="Security")
def test_booking_links(world, monkeypatch):
    world.tables['Venue Booking Requests'][0]['coordinator_id'] = 'c1'
    world.tables['Equipment Request'] = [{'request_id':1,'event_id':1,'created_by':'c1','status':'Submitted'}]
    world.tables['Equipment Request Item'] = [{'request_id':1,'equipment_id':'MIC','requested_quantity':2}]
    scenarios = [('venue_booking','Venue Staff','v1',200),('venue_booking','Venue Staff','v2',403),('venue_booking','Event Coordinator','c1',200),('venue_booking','Attendee','a1',403),('equipment_request','Technical Support Staff','t1',200),('equipment_request','Event Coordinator','c1',200),('equipment_request','Event Coordinator','c2',403),('equipment_request','Attendee','a1',403)]
    for kind,role,uid,expected in scenarios:
        world.tables['notifications'][0].update(recipient_id=uid,record_type=kind)
        monkeypatch.setitem(main.app.dependency_overrides, auth.current_user, lambda role=role,uid=uid: {'role':role,'id':uid})
        response = client.get('/api/notifications/1/record')
        assert response.status_code == expected, (kind,role,uid)
        if expected == 200:
            assert response.json()['record']['request_id'] == 1
            if kind == 'equipment_request': assert response.json()['items'][0]['equipment_id'] == 'MIC'
            else: assert response.json()['venue']['name'] == 'Hall'

@tc("BE-SP2-020", "Failed read save", "Database refuses a mark-as-read update.", "HTTP 503 and unread state is preserved.", steps="1. Fail notification updates. 2. PATCH read status. 3. Check stored state.", kind="Negative")
def test_failed_read_save(world):
    world.fail_tables.add(('notifications','update'))
    world.fail_error = APIError({'code':'XX000','message':'Write failed','details':None,'hint':None})
    assert client.patch('/api/notifications/1/read').status_code == 503
    assert world.tables['notifications'][0]['is_read'] is False
