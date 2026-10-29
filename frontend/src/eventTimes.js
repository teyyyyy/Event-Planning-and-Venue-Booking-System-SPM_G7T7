// Event Details keeps an event's date and time apart (event_date + start_time, event_end_date +
// end_time) as Singapore wall-clock values. This is the one place the frontend combines them.

// "09:00:00" -> "09:00"
export const clockTime = (time) => String(time ?? '').slice(0, 5);

// The event's start and end as Dates holding the SGT wall-clock time, so comparisons, getHours()
// and calendar rows show Singapore times in any browser time zone. A blank event_end_date means a
// single-day event. Null when the date or either time is missing or invalid.
export function eventWindow(event) {
  if (!event?.event_date || !event.start_time || !event.end_time) return null;
  const start = new Date(`${event.event_date}T${clockTime(event.start_time)}`);
  const end = new Date(`${event.event_end_date || event.event_date}T${clockTime(event.end_time)}`);
  return Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) ? null : { start, end };
}
