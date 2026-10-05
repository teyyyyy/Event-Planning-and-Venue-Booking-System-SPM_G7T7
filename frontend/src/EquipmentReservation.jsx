import React, { useEffect, useMemo, useState } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000/api';

function formatTime(value) {
  if (!value) return '—';
  const [hour, minute] = value.split(':');
  const date = new Date();
  date.setHours(Number(hour), Number(minute));
  return date.toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(value) {
  if (!value) return '—';

  const date = new Date(`${value}T00:00:00`);

  return date.toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function statusClass(value) {
  const status = normalizeStatus(value);

  if (status === 'needs recheck') return 'needs-recheck';
  if (status === 'reserved') return 'reserved';
  if (status === 'modified') return 'modified';
  if (status === 'completed') return 'completed';
  if (status === 'cancelled') return 'cancelled';

  return '';
}

export default function EquipmentReservation({
  user,
  eventId,
  onOpenEvent,
  onBack
}) {
  if (!eventId) {
    return (
      <ReservationList
        user={user}
        onOpenEvent={onOpenEvent}
        onCheckAvailability={onBack}
      />
    );
  }

  return (
    <ReservationDetails
      user={user}
      eventId={eventId}
      onBack={onBack}
    />
  );
}

function ReservationList({ user, onOpenEvent, onCheckAvailability }) {
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadReservations() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${API}/equipment-reservation/${user.id}/reservations`
      );

      const result = await response.json();

      if (!response.ok)
        throw new Error(result.detail || 'Unable to load equipment reservations.');

      setReservations(result || []);
    } catch (loadError) {
      setReservations([]);
      setError(loadError.message || 'Unable to load equipment reservations.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReservations();
  }, [user.id]);

  return (
    <section className="equipment-page">
      <header className="equipment-page-header">
        <div>
          <p className="kicker">GATHER / EQUIPMENT RESERVATION</p>
          <h1>Equipment reservation</h1>
        </div>
        <span className="live">● Supabase connected</span>
      </header>

      <div className="reservation-list-heading">
        <div>
          <h2>Existing reservations</h2>
          <p>
            View, review, modify or cancel equipment already reserved for events.
            New reservations should be made after checking equipment availability.
          </p>
        </div>

        <button
          type="button"
          className="primary"
          onClick={onCheckAvailability}
        >
          Check Equipment Availability
        </button>
      </div>

      {error && <div className="page-error">{error}</div>}

      {loading ? (
        <div className="reservation-empty-card">
          <p>Loading equipment reservations…</p>
        </div>
      ) : reservations.length === 0 ? (
        <div className="reservation-empty-card">
          <h2>No equipment reservations yet</h2>
          <p>
            Once equipment has been reserved for an event, the reservation will
            appear here.
          </p>

          <button
            type="button"
            className="primary"
            onClick={onCheckAvailability}
          >
            Check Equipment Availability
          </button>
        </div>
      ) : (
        <div className="request-form reservation-list-card">
          <div className="request-table-wrapper">
            <table className="reservation-list-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Request</th>
                  <th>Reserved Equipment</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {reservations.map((reservation) => {
                  const needsRecheck =
                    normalizeStatus(reservation.status) === 'needs recheck';

                  return (
                    <tr key={reservation.reservation_id}>
                      <td>
                        <strong>{reservation.event_name}</strong>
                        <span className="availability-equipment-id">
                          Reservation #{reservation.reservation_id}
                        </span>
                      </td>

                      <td>{formatDate(reservation.event_date)}</td>

                      <td>
                        {formatTime(reservation.start_time)}
                        {' – '}
                        {formatTime(reservation.end_time)}
                      </td>

                      <td>#{reservation.request_id}</td>

                      <td>
                        <strong>
                          {reservation.equipment_count}{' '}
                          {reservation.equipment_count === 1
                            ? 'equipment type'
                            : 'equipment types'}
                        </strong>

                        {reservation.equipment_description && (
                          <span className="reservation-equipment-description">
                            {reservation.equipment_description}
                          </span>
                        )}
                      </td>

                      <td>
                        <span
                          className={`reservation-status ${statusClass(
                            reservation.status
                          )}`}
                        >
                          {reservation.status}
                        </span>
                      </td>

                      <td>
                        <button
                          type="button"
                          className={
                            needsRecheck
                              ? 'primary reservation-list-action'
                              : 'secondary reservation-list-action'
                          }
                          onClick={() => onOpenEvent?.(reservation.event_id)}
                        >
                          {needsRecheck ? 'Review' : 'View'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function ReservationDetails({ user, eventId, onBack }) {
  const [reservation, setReservation] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadReservation() {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(
        `${API}/equipment-reservation/${user.id}/events/${eventId}`
      );

      const result = await response.json();

      if (!response.ok)
        throw new Error(result.detail || 'Unable to load reservation.');

      setReservation(result);

      setItems(
        (result.items || []).map((item) => ({
          ...item,
          reserved_quantity: String(
            item.reserved_quantity ?? item.requested_quantity ?? 0
          )
        }))
      );
    } catch (loadError) {
      setReservation(null);
      setItems([]);
      setError(loadError.message || 'Unable to load reservation.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadReservation();
  }, [eventId, user.id]);

  const existing = reservation?.mode === 'existing';

  const needsRecheck =
    existing &&
    normalizeStatus(reservation?.status) === 'needs recheck';

  const hasRequestDifferences = useMemo(() => {
    if (!needsRecheck) return false;

    return items.some(
      (item) =>
        Number(item.reserved_quantity || 0) !==
        Number(item.requested_quantity || 0)
    );
  }, [items, needsRecheck]);

  function updateQuantity(index, value) {
    if (!existing) return;

    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? { ...item, reserved_quantity: value }
          : item
      )
    );
  }

  function useRequestedQuantity(index) {
    if (!existing) return;

    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              reserved_quantity: String(item.requested_quantity ?? 0)
            }
          : item
      )
    );
  }

  function useAllRequestedQuantities() {
    if (!existing) return;

    setItems((current) =>
      current.map((item) => ({
        ...item,
        reserved_quantity: String(item.requested_quantity ?? 0)
      }))
    );
  }

  function validate() {
    if (!items.length)
      return 'There is no equipment to reserve.';

    for (const item of items) {
      const quantity = Number(item.reserved_quantity);
      const requestedQuantity = Number(item.requested_quantity || 0);

      if (!Number.isInteger(quantity) || quantity < 0)
        return `${item.equipment_name} must have a whole-number quantity of 0 or more.`;

      if (!existing && quantity !== requestedQuantity)
        return `${item.equipment_name} must initially reserve the full requested quantity of ${requestedQuantity}.`;

      if (quantity > requestedQuantity)
        return `${item.equipment_name} cannot exceed the requested quantity of ${requestedQuantity}.`;

      if (
        !existing &&
        item.available_quantity != null &&
        quantity > Number(item.available_quantity)
      ) {
        return `${item.equipment_name} only has ${item.available_quantity} available.`;
      }
    }

    if (
      existing &&
      !items.some((item) => Number(item.reserved_quantity) > 0)
    ) {
      return 'At least one equipment item must remain reserved. Cancel the reservation instead.';
    }

    return '';
  }

  async function saveReservation() {
    const validationError = validate();

    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError('');
    setMessage('');

    const payloadItems = items.map((item) => ({
      equipment_id: item.equipment_id,
      reserved_quantity: Number(item.reserved_quantity)
    }));

    try {
      const isExisting = reservation.mode === 'existing';

      const url = isExisting
        ? `${API}/equipment-reservation/${user.id}/${reservation.reservation_id}`
        : `${API}/equipment-reservation/${user.id}`;

      const body = isExisting
        ? { items: payloadItems }
        : {
            event_id: reservation.event_id,
            request_id: reservation.request_id,
            items: payloadItems
          };

      const response = await fetch(url, {
        method: isExisting ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (!response.ok)
        throw new Error(
          result.detail || 'Reservation could not be saved.'
        );

      setMessage(
        result.message ||
          'Equipment reservation saved successfully.'
      );

      await loadReservation();
    } catch (saveError) {
      setError(
        saveError.message || 'Reservation could not be saved.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function cancelReservation() {
    if (!reservation?.reservation_id) return;

    const confirmed = window.confirm(
      'Cancel this equipment reservation? The reserved equipment will become available to overlapping events.'
    );

    if (!confirmed) return;

    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch(
        `${API}/equipment-reservation/${user.id}/${reservation.reservation_id}`,
        { method: 'DELETE' }
      );

      const result = await response.json();

      if (!response.ok)
        throw new Error(
          result.detail || 'Reservation could not be cancelled.'
        );

      if (onBack) {
        onBack();
        return;
      }

      setMessage(
        result.message ||
          'Equipment reservation cancelled successfully.'
      );

      await loadReservation();
    } catch (cancelError) {
      setError(
        cancelError.message ||
          'Reservation could not be cancelled.'
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="equipment-page">
        <p>Loading equipment reservation…</p>
      </section>
    );
  }

  if (!reservation) {
    return (
      <section className="equipment-page">
        {error && <div className="page-error">{error}</div>}

        {onBack && (
          <button
            type="button"
            className="secondary"
            onClick={onBack}
          >
            ← Back
          </button>
        )}
      </section>
    );
  }

  const event = reservation.event;

  return (
    <section className="equipment-page">
      <header className="equipment-page-header">
        <div>
          <p className="kicker">
            GATHER / EQUIPMENT RESERVATION
          </p>

          <h1>
            {!existing
              ? 'Reserve equipment'
              : needsRecheck
                ? 'Review equipment reservation'
                : 'Manage equipment reservation'}
          </h1>
        </div>

        <span className="live">
          ● Supabase connected
        </span>
      </header>

      <div className="technical-detail-toolbar">
        {onBack && (
          <button
            type="button"
            className="secondary"
            onClick={onBack}
          >
            ← Back to Reservations
          </button>
        )}

        {existing && (
          <span
            className={`reservation-status ${statusClass(
              reservation.status
            )}`}
          >
            Reservation #{reservation.reservation_id} ·{' '}
            {reservation.status}
          </span>
        )}
      </div>

      {message && (
        <div className="reservation-success">
          {message}
        </div>
      )}

      {error && (
        <div className="page-error">
          {error}
        </div>
      )}

      {needsRecheck && (
        <div className="reservation-recheck-warning">
          <div>
            <strong>
              Equipment request changed — reservation needs review
            </strong>

            <p>
              The equipment request was updated after this reservation
              was made. Compare the currently reserved quantities with
              the latest requested quantities, then confirm the
              reservation again.
            </p>
          </div>

          {hasRequestDifferences && (
            <button
              type="button"
              className="secondary"
              disabled={saving}
              onClick={useAllRequestedQuantities}
            >
              Use Current Requested Quantities
            </button>
          )}
        </div>
      )}

      <div className="reservation-event-card">
        <div>
          <span className="availability-overview-label">
            EVENT
          </span>

          <h2>{event.event_name}</h2>
        </div>

        <div className="reservation-event-details">
          <div>
            <span>Date</span>
            <strong>{formatDate(event.event_date)}</strong>
          </div>

          <div>
            <span>Time</span>
            <strong>
              {formatTime(event.start_time)}
              {' – '}
              {formatTime(event.end_time)}
            </strong>
          </div>

          <div>
            <span>Equipment Request</span>
            <strong>
              Request #{reservation.request_id}
            </strong>
          </div>
        </div>
      </div>

      <div className="request-form reservation-card">
        <div className="form-heading">
          <div>
            <h2>
              {existing
                ? 'Reserved equipment'
                : 'Equipment to reserve'}
            </h2>

            <p>
              {!existing
                ? 'The full requested quantities are taken from the event request and cannot be changed during the initial reservation.'
                : needsRecheck
                  ? 'Review the latest requested quantities against what is currently reserved. You may adjust the reservation before confirming.'
                  : 'Change the reserved quantities or set a quantity to 0 to release that equipment.'}
            </p>
          </div>
        </div>

        <div className="reservation-notice">
          Availability is checked again when you confirm.
          This prevents overlapping events from reserving
          more equipment than is available.
        </div>

        <div className="request-table-wrapper">
          <table className="reservation-table">
            <thead>
              <tr>
                <th>Equipment</th>

                {!existing && <th>Requested</th>}
                {!existing && <th>Available</th>}

                {existing && needsRecheck && (
                  <th>Current Request</th>
                )}

                <th>
                  {existing
                    ? 'Reserved Quantity'
                    : 'Reserve Quantity'}
                </th>

                {!existing && (
                  <th>Technical Requirements</th>
                )}

                {existing && needsRecheck && (
                  <th>Action</th>
                )}
              </tr>
            </thead>

            <tbody>
              {items.map((item, index) => {
                const reservedQuantity =
                  Number(item.reserved_quantity || 0);

                const requestedQuantity =
                  Number(item.requested_quantity || 0);

                const quantityChanged =
                  needsRecheck &&
                  reservedQuantity !== requestedQuantity;

                return (
                  <tr
                    key={item.equipment_id}
                    className={
                      quantityChanged
                        ? 'reservation-changed-row'
                        : ''
                    }
                  >
                    <td>
                      <strong>
                        {item.equipment_name}
                      </strong>

                      <span className="availability-equipment-id">
                        {item.equipment_id}
                      </span>

                      {needsRecheck &&
                        item.currently_reserved &&
                        !item.currently_requested && (
                          <small className="reservation-request-changed">
                            Removed from current request
                          </small>
                        )}

                      {needsRecheck &&
                        !item.currently_reserved &&
                        item.currently_requested && (
                          <small className="reservation-request-changed">
                            Newly added to request
                          </small>
                        )}
                    </td>

                    {!existing && (
                      <td>
                        {item.requested_quantity}
                      </td>
                    )}

                    {!existing && (
                      <td>
                        <strong>
                          {item.available_quantity}
                        </strong>
                      </td>
                    )}

                    {existing && needsRecheck && (
                      <td>
                        <strong>
                          {item.requested_quantity}
                        </strong>

                        {quantityChanged && (
                          <small className="reservation-request-changed">
                            Request changed
                          </small>
                        )}
                      </td>
                    )}

                    <td>
                      {!existing ? (
                        <>
                          <strong className="reservation-fixed-quantity">
                            {item.requested_quantity}
                          </strong>

                          <small className="reservation-quantity-help">
                            Matches the equipment request.
                          </small>
                        </>
                      ) : (
                        <>
                          <input
                            className="reservation-quantity-input"
                            type="number"
                            min="0"
                            step="1"
                            value={item.reserved_quantity}
                            onChange={(event) =>
                              updateQuantity(
                                index,
                                event.target.value
                              )
                            }
                          />

                          <small className="reservation-quantity-help">
                            Set to 0 to release this equipment.
                          </small>
                        </>
                      )}
                    </td>

                    {!existing && (
                      <td>
                        {item.technical_requirements || '—'}
                      </td>
                    )}

                    {existing && needsRecheck && (
                      <td>
                        {quantityChanged ? (
                          <button
                            type="button"
                            className="secondary reservation-use-requested"
                            disabled={saving}
                            onClick={() =>
                              useRequestedQuantity(index)
                            }
                          >
                            Use Requested
                          </button>
                        ) : (
                          <span className="reservation-match">
                            ✓ Matches
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="reservation-actions">
          {existing && (
            <button
              type="button"
              className="reservation-cancel"
              disabled={saving}
              onClick={cancelReservation}
            >
              Cancel Reservation
            </button>
          )}

          <button
            type="button"
            className="primary"
            disabled={saving}
            onClick={saveReservation}
          >
            {saving
              ? 'Checking availability…'
              : !existing
                ? 'Confirm Reservation'
                : needsRecheck
                  ? 'Confirm Reviewed Reservation'
                  : 'Confirm Reservation Changes'}
          </button>
        </div>
      </div>
    </section>
  );
}