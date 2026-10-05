import React, { useEffect, useState } from 'react';
import { request } from './api';
import { CHANGE_FIELD_LABELS } from './eventChanges';

function display(field, value) {
  if (value == null || value === '') return 'Not set';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  if (field === 'accessibility_required') return value ? 'Required' : 'Not required';
  return field.endsWith('_time') ? String(value).slice(0, 5) : String(value);
}

// Story 10.2: the recorded changes to an event, with significant changes marked.
export default function EventChangeHistory({ eventId }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    request(`/events/${eventId}/change-log`)
      .then((data) => { if (active) setEntries(data); })
      .catch((failure) => { if (active) setError(`Unable to load the change history. (${failure.message})`); });
    return () => { active = false; };
  }, [eventId]);

  if (error) return <p className="message" role="alert">{error}</p>;
  if (!entries) return <p className="message">Loading change history…</p>;
  if (!entries.length) return <p className="message">No changes have been recorded since this event was submitted.</p>;

  return <ol className="change-history" aria-label="Event change history">
    {entries.map((entry) => {
      const kind = entry.change_type === 'Significant' ? 'significant' : 'ordinary';
      const significantFields = entry.significant_fields || [];
      const reopened = [
        ...(entry.reset_venue_request_ids || []).map((id) => `venue booking #${id}`),
        ...(entry.reset_equipment_request_ids || []).map((id) => `equipment request #${id}`),
      ];
      return <li key={entry.id} className="change-entry">
        <div className="change-entry-head">
          <span className={`change-badge ${kind}`}>{kind === 'significant' ? 'Significant change' : 'Ordinary edit'}</span>
          <small>
            {String(entry.created_at || '').slice(0, 10)}
            {entry.changed_by_name && ` · by ${entry.changed_by_name}`}
            {entry.change_request_id && ` · change request #${entry.change_request_id}`}
          </small>
        </div>
        <table className="change-diff"><tbody>
          {(entry.changed_fields || []).map((field) => <tr key={field} className={significantFields.includes(field) ? 'significant-field' : undefined}>
            <th scope="row">{CHANGE_FIELD_LABELS[field] || field}</th>
            <td>{display(field, entry.previous_values?.[field])}</td>
            <td aria-hidden="true">→</td>
            <td>{display(field, entry.new_values?.[field])}</td>
          </tr>)}
        </tbody></table>
        {reopened.length > 0 && <p className="change-reopened">Returned to Pending for re-review: {reopened.join(', ')}.</p>}
      </li>;
    })}
  </ol>;
}
