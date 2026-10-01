# Gather — domain class diagram

This UML domain view represents records used by the current repository. These
are not existing Python entity classes: the implementation uses route functions,
dictionaries and Pydantic request models. Selected attributes are shown; the
associations stand in for most foreign-key fields to reduce clutter.

```mermaid
classDiagram
    direction LR
    class User {
        UUID id
        string name
        string email
        string role
    }
    class Event {
        bigint id
        string event_name
        string description
        date event_date
        time start_time
        time end_time
        int event_capacity
        string status
    }
    class Registration {
        bigint id
        bigint event_id
        UUID attendee_id
        datetime registered_at
    }
    class Notification {
        bigint id
        UUID recipient_id
        string description
        string record_type
        string record_id
        datetime created_at
        bool is_read
    }
    class Venue {
        int venue_id
        string name
        string location
        int capacity
    }
    class VenueBooking {
        int request_id
        bigint event_id
        int venue_id
        string status
        string rejection_reason
    }
    class Equipment {
        string equipment_id
        string equipment_name
        int total_quantity
        int under_maintenance_count
    }
    class EquipmentRequest {
        int request_id
        bigint event_id
        UUID created_by
        string status
    }
    class EquipmentRequestItem {
        int request_id
        string equipment_id
        int requested_quantity
        string technical_requirements
    }
    class EquipmentReservation {
        int reservation_id
        bigint event_id
        string status
    }
    class EquipmentReservationItem {
        int reservation_id
        string equipment_id
        int reserved_quantity
        datetime start_datetime
        datetime end_datetime
    }

    User "1" --> "0..*" Event : organises
    User "0..1" --> "0..*" Event : coordinates
    User "1" --> "0..*" Registration : attendee
    Event "1" --> "0..*" Registration : registrations
    User "1" --> "0..*" Notification : receives
    Event "1" --> "0..*" VenueBooking : venue requests
    Venue "1" --> "0..*" VenueBooking : requested venue
    User "1" --> "0..*" VenueBooking : requests as coordinator
    User "0..1" --> "0..*" VenueBooking : assigned venue staff
    Event "1" --> "0..*" EquipmentRequest : equipment requests
    User "1" --> "0..*" EquipmentRequest : creates
    EquipmentRequest "1" --> "0..*" EquipmentRequestItem : contains
    Equipment "1" --> "0..*" EquipmentRequestItem : requested item
    Event "1" --> "0..*" EquipmentReservation : reservations
    EquipmentReservation "1" --> "0..*" EquipmentReservationItem : contains
    Equipment "1" --> "0..*" EquipmentReservationItem : reserved item
    Notification ..> Event : possible target
    Notification ..> VenueBooking : possible target
    Notification ..> EquipmentRequest : possible target
```

## Reading the diagram

- `1` means exactly one; `0..1` means optional; `0..*` means zero or more.
- Roles are values in `User.role`, not separate subclasses: Event Organiser,
  Event Coordinator, Venue Staff, Technical Support Staff and Attendee.
- `Registration` links an attendee to an event. The event/attendee pair is unique.
- A notification has one recipient. Its `record_type` and `record_id` identify
  exactly one event, venue booking or equipment request; dotted arrows show
  alternative logical targets, not three required foreign keys.
- Approved venue bookings provide an event's published venue information.
- Equipment requests and reservations are separate concepts used by the code;
  availability reads reservations. This diagram does not imply a request-to-
  reservation conversion workflow exists.
- Request creation requires equipment items, but the current technical-support
  update path can remove items, so persisted item multiplicity is `0..*`.
- The equipment-request endpoint currently prevents a second request for the
  same event. The diagram shows the general data relationship because no full
  database schema or event/request uniqueness constraint is supplied by the repo.
- Except for the new registration and notification tables, relationships and
  selected types are inferred from query fields and API models, not a complete
  live-schema export.

## Record mapping

| Diagram class | Database table |
|---|---|
| User | users |
| Event | Event Details |
| Registration | event_registrations |
| Notification | notifications |
| Venue | Venues |
| VenueBooking | Venue Booking Requests |
| Equipment | Equipment |
| EquipmentRequest | Equipment Request |
| EquipmentRequestItem | Equipment Request Item |
| EquipmentReservation | Equipment Reservation |
| EquipmentReservationItem | Equipment Reservation Item |

For C4 Level 4, select the classes and actual functions relevant to one component
rather than presenting this whole-system domain model as one microservice's code.
