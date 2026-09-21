"""Catalogue acceptance checks against isolated storage; never writes to Supabase."""
import copy
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import venue_catalogue as catalogue
from auth import current_user


def record(id):
    return dict(venue_id=id, name=f'Hall {id}', location='Singapore', capacity=100,
                operating_hours={day: dict(closed=False, opens='09:00', closes='18:00') for day in catalogue.DAYS},
                facilities=['Wi-Fi'], accessible=1, accessibility_details='Step-free entrance', layouts=['Theatre'])


class Store:
    def __init__(self):
        self.rows = [record(1), record(2)]
        self.fail = False
        self.writes = 0

    def table(self, name):
        assert name == 'Venues'
        return Query(self)


class Query:
    def __init__(self, store): self.store, self.filters, self.payload = store, {}, None
    def select(self, *_): return self
    def order(self, *_): return self
    def limit(self, *_): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def update(self, payload): self.payload = payload; return self
    def execute(self):
        if self.store.fail:
            raise APIError(dict(code='XX000', message='Simulated outage', details=None, hint=None))
        rows = [row for row in self.store.rows if all(row[k] == v for k, v in self.filters.items())]
        if self.payload is not None:
            for row in rows:
                row.update(copy.deepcopy(self.payload))
                self.store.writes += 1
        return SimpleNamespace(data=copy.deepcopy(rows))


class CatalogueTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(catalogue.router)
        self.client = TestClient(self.app)
        self.role('Venue Staff')
        self.store = Store()
        patcher = patch.object(catalogue, 'db', return_value=self.store)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.payload = {key: copy.deepcopy(self.store.rows[0][key]) for key in catalogue.VenueUpdate.model_fields}

    def role(self, role):
        self.app.dependency_overrides[current_user] = lambda: dict(id='test-user', role=role)

    def test_list_and_selected_details(self):
        self.assertEqual(self.client.get('/api/venue-catalogue').json(), self.store.rows)
        self.assertEqual(self.client.get('/api/venue-catalogue/2').json(), self.store.rows[1])

    def test_empty_catalogue(self):
        self.store.rows = []
        self.assertEqual(self.client.get('/api/venue-catalogue').json(), [])

    def test_save_all_fields_persists_only_selected_record(self):
        other = copy.deepcopy(self.store.rows[1])
        self.payload.update(facilities=[' Projector ', 'projector'], accessible=0, accessibility_details=' Stairs only ', layouts=['Banquet'])
        self.payload['operating_hours']['sunday'] = dict(closed=True, opens=None, closes=None)
        response = self.client.put('/api/venue-catalogue/1', json=self.payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['facilities'], ['Projector'])
        self.assertEqual(response.json()['accessible'], 0)
        self.assertEqual(response.json()['accessibility_details'], 'Stairs only')
        self.assertEqual(response.json()['layouts'], ['Banquet'])
        self.assertTrue(response.json()['operating_hours']['sunday']['closed'])
        self.assertEqual(self.store.rows[1], other)
        self.assertEqual(self.store.writes, 1)
        self.assertEqual(self.client.get('/api/venue-catalogue/1').json(), response.json())
        self.assertEqual(self.client.get('/api/venue-catalogue').json()[0], response.json())

    def test_technical_support_can_view_but_not_save(self):
        self.role('Technical Support Staff')
        self.assertEqual(self.client.get('/api/venue-catalogue').status_code, 200)
        self.assertEqual(self.client.get('/api/venue-catalogue/1').status_code, 200)
        self.assertEqual(self.client.put('/api/venue-catalogue/1', json=self.payload).status_code, 403)
        self.assertEqual(self.store.writes, 0)

    def test_other_roles_forbidden(self):
        for role in ['Event Organiser', 'Event Coordinator', '']:
            with self.subTest(role=role):
                self.role(role)
                self.assertEqual(self.client.get('/api/venue-catalogue').status_code, 403)
                self.assertEqual(self.client.get('/api/venue-catalogue/1').status_code, 403)
                self.assertEqual(self.client.put('/api/venue-catalogue/1', json=self.payload).status_code, 403)

    def test_anonymous_requests_rejected(self):
        self.app.dependency_overrides.clear()
        self.assertEqual(self.client.get('/api/venue-catalogue').status_code, 401)
        self.assertEqual(self.client.get('/api/venue-catalogue/1').status_code, 401)
        self.assertEqual(self.client.put('/api/venue-catalogue/1', json=self.payload).status_code, 401)

    def test_invalid_updates_do_not_write(self):
        before = copy.deepcopy(self.store.rows)
        variants = [dict(facilities=[' ']), dict(layouts=['x' * 101]), dict(accessible=2),
                    dict(venue_id=2), dict(name='Changed'), dict(operating_hours={}),
                    dict(accessibility_details='x' * 1001)]
        for opens, closes in [('18:00', '09:00'), ('09:00', '09:00'), ('25:00', '26:00'), ('', '18:00')]:
            hours = copy.deepcopy(self.payload['operating_hours'])
            hours['monday'] = dict(closed=False, opens=opens, closes=closes)
            variants.append(dict(operating_hours=hours))
        for changes in variants:
            with self.subTest(changes=changes):
                self.assertEqual(self.client.put('/api/venue-catalogue/1', json={**self.payload, **changes}).status_code, 422)
        self.assertEqual(self.store.rows, before)
        self.assertEqual(self.store.writes, 0)

    def test_missing_venue(self):
        self.assertEqual(self.client.get('/api/venue-catalogue/99').status_code, 404)
        self.assertEqual(self.client.put('/api/venue-catalogue/99', json=self.payload).status_code, 404)
        self.assertEqual(self.store.writes, 0)

    def test_failure_does_not_change_data_or_report_success(self):
        self.store.fail = True
        before = copy.deepcopy(self.store.rows)
        self.assertEqual(self.client.get('/api/venue-catalogue').status_code, 503)
        self.assertEqual(self.client.put('/api/venue-catalogue/1', json=self.payload).status_code, 503)
        self.assertEqual(self.store.rows, before)


if __name__ == '__main__':
    unittest.main()
