// Story 10.2: which event fields make a change significant. Mirrors event_change_impact() in
// backend/sql/significant_event_changes.sql, which is what actually classifies saved changes.
export const CHANGE_FIELD_LABELS = {
  event_name: 'Event name',
  event_type: 'Event type',
  description: 'Description',
  equipment_placement: 'Equipment placement',
  crowd_movement: 'Crowd movement',
  equipment_required: 'Equipment required',
  event_date: 'Start date',
  event_end_date: 'End date',
  start_time: 'Start time',
  end_time: 'End time',
  event_capacity: 'Capacity',
  venue_id: 'Venue',
  layout_required: 'Layout',
  facilities_required: 'Facilities',
  accessibility_required: 'Accessibility',
};

const VENUE_FIELDS = ['event_date', 'event_end_date', 'start_time', 'end_time', 'event_capacity', 'venue_id', 'layout_required', 'facilities_required', 'accessibility_required'];
const EQUIPMENT_FIELDS = ['event_date', 'event_end_date', 'start_time', 'end_time', 'equipment_required'];
const ARRAY_FIELDS = ['equipment_required', 'facilities_required'];

export const fieldLabels = (fields) => (fields || []).map((field) => CHANGE_FIELD_LABELS[field] || field).join(', ');

function selections(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .sort();
  }

  if (value == null || value === '') return [];

  if (typeof value === 'string') {
    const serialized = value.trim();

    if (!serialized) return [];

    const content =
      (serialized.startsWith('{') && serialized.endsWith('}'))
      || (serialized.startsWith('[') && serialized.endsWith(']'))
        ? serialized.slice(1, -1)
        : serialized;

    return content
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
      .sort();
  }

  return [String(value).trim()].filter(Boolean);
}

function comparable(record, field) {
  // A blank end date means a single-day event.
  const value = field === 'event_end_date'
    ? record.event_end_date || record.event_date
    : record[field];

  if (ARRAY_FIELDS.includes(field)) {
    return selections(value).join('|');
  }

  if (value == null || value === '') return '';

  if (field === 'accessibility_required') {
    return Number(value) === 1 ? '1' : '0';
  }

  return field.endsWith('_time')
    ? String(value).slice(0, 5)
    : String(value);
}

export function classifyChange(current, proposed) {
  const changed = Object.keys(CHANGE_FIELD_LABELS).filter(
    (field) =>
      field in proposed
      && comparable(current, field) !== comparable(proposed, field)
  );

  const significantFields = changed.filter(
    (field) => VENUE_FIELDS.includes(field) || EQUIPMENT_FIELDS.includes(field)
  );

  return {
    significant: significantFields.length > 0,
    significantFields,
    affectsVenue: changed.some((field) => VENUE_FIELDS.includes(field)),
    affectsEquipment: changed.some((field) => EQUIPMENT_FIELDS.includes(field)),
  };
}

// The arrangements a significant change sends back for review,
// e.g. "venue booking and equipment requests".
export function arrangementLabel(affectsVenue, affectsEquipment) {
  return [
    affectsVenue && 'venue booking',
    affectsEquipment && 'equipment requests',
  ].filter(Boolean).join(' and ');
}
