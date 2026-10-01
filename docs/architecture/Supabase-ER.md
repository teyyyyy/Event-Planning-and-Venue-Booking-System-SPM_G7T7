# Gather — live Supabase ER diagram

Read-only schema snapshot: 1 October 2026. Source: the configured project's
Supabase Data API / PostgREST OpenAPI schema, accessed with backend credentials.
No user records, passwords or keys are included in this document or snapshot.

## Scope and notation

- Covers the **11 application tables exposed by the Data API**. Supabase-managed
  schemas such as `auth` and `storage`, unexposed schemas, SQL functions, triggers,
  indexes and policies are outside this API schema export.
- `PK` means primary-key column; `FK` means a declared foreign key reported by
  PostgREST. Two `PK` columns in `EQUIPMENT_REQUEST_ITEM` form one composite key.
- `NOT NULL` / `nullable` comes from the schema's required-column list.
- Parent-side `||` means a required reference; `|o` means an optional reference.
- Child-side `o{` shows a potentially-many collection. The export does not report
  every unique constraint, so narrower upper bounds cannot be independently
  verified here. For example, the app currently blocks a second equipment request
  per event, while that restriction is not expressed in this API schema export.
- Dashed lines use Mermaid's non-identifying relationship notation; they do not
  mean the foreign keys are unverified. Solid lines identify relationships whose
  FK participates in the child primary key. All edges come from reported FKs.
- Table names are normalized to uppercase/underscores for diagram readability;
  exact database names are mapped below. `text_array` represents PostgreSQL `text[]`.

## Overview — keys and relationships

```mermaid
erDiagram
    direction LR
    EVENT_DETAILS ||..o{ EVENT_REGISTRATIONS : "event_id"
    USERS ||..o{ EVENT_REGISTRATIONS : "attendee_id"
    USERS ||..o{ NOTIFICATIONS : "recipient_id"
    VENUES ||..o{ VENUE_BOOKING_REQUESTS : "venue_id"
    EVENT_DETAILS ||..o{ VENUE_BOOKING_REQUESTS : "event_id"
    USERS ||..o{ VENUE_BOOKING_REQUESTS : "coordinator_id"
    USERS |o..o{ VENUE_BOOKING_REQUESTS : "venue_staff_id"
    EVENT_DETAILS ||..o{ EQUIPMENT_REQUEST : "event_id"
    USERS |o..o{ EQUIPMENT_REQUEST : "created_by"
    USERS |o..o{ EQUIPMENT_REQUEST : "updated_by"
    EQUIPMENT_REQUEST ||--o{ EQUIPMENT_REQUEST_ITEM : "request_id"
    EQUIPMENT ||--o{ EQUIPMENT_REQUEST_ITEM : "equipment_id"
    USERS |o..o{ EQUIPMENT_REQUEST_ITEM : "updated_by"
    EVENT_DETAILS ||..o{ EQUIPMENT_RESERVATION : "event_id"
    EQUIPMENT_REQUEST ||..o{ EQUIPMENT_RESERVATION : "request_id"
    USERS ||..o{ EQUIPMENT_RESERVATION : "reserved_by"
    EQUIPMENT_RESERVATION ||..o{ EQUIPMENT_RESERVATION_ITEM : "reservation_id"
    EQUIPMENT ||..o{ EQUIPMENT_RESERVATION_ITEM : "equipment_id"

    USERS {
        uuid id PK "NOT NULL"
    }
    EVENT_DETAILS {
        bigint id PK "NOT NULL"
    }
    EVENT_REGISTRATIONS {
        bigint id PK "NOT NULL"
        bigint event_id FK "NOT NULL"
        uuid attendee_id FK "NOT NULL"
    }
    NOTIFICATIONS {
        bigint id PK "NOT NULL"
        uuid recipient_id FK "NOT NULL"
    }
    VENUES {
        bigint venue_id PK "NOT NULL"
    }
    VENUE_BOOKING_REQUESTS {
        bigint request_id PK "NOT NULL"
        bigint venue_id FK "NOT NULL"
        bigint event_id FK "NOT NULL"
        uuid coordinator_id FK "NOT NULL"
        uuid venue_staff_id FK "nullable"
    }
    EQUIPMENT {
        text equipment_id PK "NOT NULL"
    }
    EQUIPMENT_REQUEST {
        bigint request_id PK "NOT NULL"
        bigint event_id FK "NOT NULL"
        uuid created_by FK "nullable"
        uuid updated_by FK "nullable"
    }
    EQUIPMENT_REQUEST_ITEM {
        bigint request_id PK,FK "NOT NULL"
        text equipment_id PK,FK "NOT NULL"
        uuid updated_by FK "nullable"
    }
    EQUIPMENT_RESERVATION {
        bigint reservation_id PK "NOT NULL"
        bigint event_id FK "NOT NULL"
        bigint request_id FK "NOT NULL"
        uuid reserved_by FK "NOT NULL"
    }
    EQUIPMENT_RESERVATION_ITEM {
        bigint reservation_item_id PK "NOT NULL"
        bigint reservation_id FK "NOT NULL"
        text equipment_id FK "NOT NULL"
    }
```

## Complete diagram — all exposed columns

```mermaid
erDiagram
    direction LR
    EVENT_DETAILS ||..o{ EVENT_REGISTRATIONS : "event_id"
    USERS ||..o{ EVENT_REGISTRATIONS : "attendee_id"
    USERS ||..o{ NOTIFICATIONS : "recipient_id"
    VENUES ||..o{ VENUE_BOOKING_REQUESTS : "venue_id"
    EVENT_DETAILS ||..o{ VENUE_BOOKING_REQUESTS : "event_id"
    USERS ||..o{ VENUE_BOOKING_REQUESTS : "coordinator_id"
    USERS |o..o{ VENUE_BOOKING_REQUESTS : "venue_staff_id"
    EVENT_DETAILS ||..o{ EQUIPMENT_REQUEST : "event_id"
    USERS |o..o{ EQUIPMENT_REQUEST : "created_by"
    USERS |o..o{ EQUIPMENT_REQUEST : "updated_by"
    EQUIPMENT_REQUEST ||--o{ EQUIPMENT_REQUEST_ITEM : "request_id"
    EQUIPMENT ||--o{ EQUIPMENT_REQUEST_ITEM : "equipment_id"
    USERS |o..o{ EQUIPMENT_REQUEST_ITEM : "updated_by"
    EVENT_DETAILS ||..o{ EQUIPMENT_RESERVATION : "event_id"
    EQUIPMENT_REQUEST ||..o{ EQUIPMENT_RESERVATION : "request_id"
    USERS ||..o{ EQUIPMENT_RESERVATION : "reserved_by"
    EQUIPMENT_RESERVATION ||..o{ EQUIPMENT_RESERVATION_ITEM : "reservation_id"
    EQUIPMENT ||..o{ EQUIPMENT_RESERVATION_ITEM : "equipment_id"

    USERS {
        uuid id PK "NOT NULL"
        text name "NOT NULL"
        text role "NOT NULL"
        text email "nullable"
        bigint active_event_count "nullable"
    }
    EVENT_DETAILS {
        bigint id PK "NOT NULL"
        timestamptz created_at "NOT NULL"
        text event_type "nullable"
        date event_date "nullable"
        bigint event_capacity "nullable"
        uuid organiser_id "nullable"
        text event_name "nullable"
        text description "nullable"
        time start_time "nullable"
        time end_time "nullable"
        text status "nullable"
        timestamptz updated_at "nullable"
        uuid coordinator_id "nullable"
        text coordinator_comments "nullable"
        date event_end_date "nullable"
        text layout_required "nullable"
        text_array facilities_required "nullable"
        bigint accessibility_required "nullable"
        timestamptz start_datetime "nullable"
        timestamptz end_datetime "nullable"
    }
    EVENT_REGISTRATIONS {
        bigint id PK "NOT NULL"
        bigint event_id FK "NOT NULL"
        uuid attendee_id FK "NOT NULL"
        timestamptz registered_at "NOT NULL"
    }
    NOTIFICATIONS {
        bigint id PK "NOT NULL"
        uuid recipient_id FK "NOT NULL"
        text description "NOT NULL"
        text record_type "NOT NULL"
        text record_id "NOT NULL"
        timestamptz created_at "NOT NULL"
        boolean is_read "NOT NULL"
    }
    VENUES {
        bigint venue_id PK "NOT NULL"
        timestamptz created_at "NOT NULL"
        text name "NOT NULL"
        text_array layouts "NOT NULL"
        text_array facilities "NOT NULL"
        bigint capacity "NOT NULL"
        text status "NOT NULL"
        bigint accessible "nullable"
        text location "NOT NULL"
        jsonb operating_hours "nullable"
        text accessibility_details "NOT NULL"
    }
    VENUE_BOOKING_REQUESTS {
        bigint request_id PK "NOT NULL"
        timestamptz created_at "NOT NULL"
        bigint venue_id FK "NOT NULL"
        timestamptz start_datetime "NOT NULL"
        timestamptz end_datetime "NOT NULL"
        bigint accessibility_required "NOT NULL"
        text layout_required "nullable"
        text_array facilities_required "nullable"
        text status "NOT NULL"
        bigint event_id FK "NOT NULL"
        uuid coordinator_id FK "NOT NULL"
        uuid venue_staff_id FK "nullable"
        text rejection_reason "nullable"
        text alternative_venue "nullable"
        timestamptz decided_at "nullable"
    }
    EQUIPMENT {
        text equipment_id PK "NOT NULL"
        text equipment_name "NOT NULL"
        integer total_quantity "nullable"
        integer under_maintenance_count "nullable"
    }
    EQUIPMENT_REQUEST {
        bigint request_id PK "NOT NULL"
        bigint event_id FK "NOT NULL"
        text status "nullable"
        uuid created_by FK "nullable"
        timestamptz created_at "nullable"
        timestamptz updated_at "nullable"
        uuid updated_by FK "nullable"
        text latest_update_summary "nullable"
    }
    EQUIPMENT_REQUEST_ITEM {
        bigint request_id PK,FK "NOT NULL"
        text equipment_id PK,FK "NOT NULL"
        integer requested_quantity "NOT NULL"
        text technical_requirements "nullable"
        timestamptz created_at "NOT NULL"
        timestamptz updated_at "NOT NULL"
        uuid updated_by FK "nullable"
    }
    EQUIPMENT_RESERVATION {
        bigint reservation_id PK "NOT NULL"
        bigint event_id FK "NOT NULL"
        bigint request_id FK "NOT NULL"
        text status "NOT NULL"
        uuid reserved_by FK "NOT NULL"
        timestamptz created_at "NOT NULL"
        timestamptz updated_at "NOT NULL"
    }
    EQUIPMENT_RESERVATION_ITEM {
        bigint reservation_item_id PK "NOT NULL"
        bigint reservation_id FK "NOT NULL"
        text equipment_id FK "NOT NULL"
        integer reserved_quantity "NOT NULL"
        timestamptz start_datetime "NOT NULL"
        timestamptz end_datetime "NOT NULL"
        timestamptz created_at "NOT NULL"
        timestamptz updated_at "NOT NULL"
    }
```

## Relationships used by the application but not reported as foreign keys

These are deliberately omitted from the physical ER diagrams:

| Column | Application-level target | Evidence / limitation |
|---|---|---|
| Event Details.organiser_id | users.id | Backend reads ownership using this UUID; no FK annotation in live API metadata |
| Event Details.coordinator_id | users.id | Backend uses this UUID for assignment; no FK annotation in live API metadata |
| users.id | Supabase Auth user ID | Login/profile lookup uses the same UUID; auth schema is not exposed and no FK annotation is reported |
| notifications.record_id | Event Details.id, Venue Booking Requests.request_id, or Equipment Request.request_id | Target is selected by record_type; this text column is not a declared FK |

The repo's Sprint 2 migration additionally declares a **composite unique
constraint on event_registrations(event_id, attendee_id)**. That rule is supported
by the migration source, but unique-constraint metadata is not exposed by this
schema endpoint. It is not mislabeled as two individually unique columns.

## Table-name mapping

| Diagram name | Actual Supabase table |
|---|---|
| USERS | users |
| EVENT_DETAILS | Event Details |
| EVENT_REGISTRATIONS | event_registrations |
| NOTIFICATIONS | notifications |
| VENUES | Venues |
| VENUE_BOOKING_REQUESTS | Venue Booking Requests |
| EQUIPMENT | Equipment |
| EQUIPMENT_REQUEST | Equipment Request |
| EQUIPMENT_REQUEST_ITEM | Equipment Request Item |
| EQUIPMENT_RESERVATION | Equipment Reservation |
| EQUIPMENT_RESERVATION_ITEM | Equipment Reservation Item |

## Editable artifacts

- [Full Mermaid source](supabase-er.mmd)
- [Keys-only Mermaid source](supabase-er-keys.mmd)
- [Schema metadata snapshot](supabase-schema-snapshot.json)

This live-schema diagram supersedes assumptions in the earlier repo-derived
domain class diagram. In particular, `Equipment Reservation Item` has its own
`reservation_item_id` primary key, and `Equipment Reservation.request_id`
explicitly references `Equipment Request`.
