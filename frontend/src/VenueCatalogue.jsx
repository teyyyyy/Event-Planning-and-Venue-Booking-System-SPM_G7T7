import React, { useEffect, useState } from 'react';
import { request } from './api';
import './venue_catalogue.css';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const title = (day) => day[0].toUpperCase() + day.slice(1);
const items = (value) => value.split('\n').map((item) => item.trim()).filter(Boolean);
const showList = (value) => value?.length ? value.join(', ') : 'Not specified';

function draftFor(venue) {
  return {
    operating_hours: Object.fromEntries(DAYS.map((day) => [day, {
      ...(venue.operating_hours?.[day] || { closed: false, opens: '', closes: '' }),
    }])),
    facilities: (venue.facilities || []).join('\n'),
    layouts: (venue.layouts || []).join('\n'),
    accessible: Number(venue.accessible) === 1 ? 1 : 0,
    accessibility_details: venue.accessibility_details || '',
  };
}

export default function VenueCatalogue({ canEdit = false }) {
  const [venues, setVenues] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [venue, setVenue] = useState(null);
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setVenue(null);
    request(selectedId === null ? '/venue-catalogue' : `/venue-catalogue/${selectedId}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        if (selectedId === null) setVenues(data);
        else setVenue(data);
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err.message || 'Unable to load venues.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectedId, retry]);

  function select(id) {
    setLoading(true);
    setVenue(null);
    setError('');
    setSuccess('');
    setSelectedId(id);
  }

  function changeHours(day, changes) {
    setDraft((value) => ({ ...value, operating_hours: {
      ...value.operating_hours, [day]: { ...value.operating_hours[day], ...changes },
    } }));
  }

  async function save(event) {
    event.preventDefault();
    if (!canEdit || saving) return;
    setError('');
    setSuccess('');
    for (const day of DAYS) {
      const hours = draft.operating_hours[day];
      if (!hours.closed && (!hours.opens || !hours.closes || hours.closes <= hours.opens)) {
        setError(`${title(day)}: closing time must be later than opening time on the same day.`);
        return;
      }
    }
    const payload = { ...draft, facilities: items(draft.facilities), layouts: items(draft.layouts) };
    if ([payload.facilities, payload.layouts].some((list) => list.length > 30 || list.some((item) => item.length > 100))) {
      setError('Enter up to 30 items per list, with no more than 100 characters per item.');
      return;
    }
    setSaving(true);
    try {
      const updated = await request(`/venue-catalogue/${venue.venue_id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setVenue(updated);
      setVenues((current) => current.map((item) => item.venue_id === updated.venue_id ? updated : item));
      setDraft(null);
      setSuccess(`${updated.name} updated successfully.`);
    } catch (err) {
      setError(err.message || 'Unable to save. Please try again.');
    } finally { setSaving(false); }
  }

  return <main className="equipment-page venue-catalogue">
    <header className="equipment-page-header"><div><p className="kicker">Gather / Venues</p><h1>Venue catalogue</h1></div></header>
    <p className="catalogue-intro">{canEdit ? 'View venues and keep their planning information up to date.' : 'Browse venue information for technical planning.'}</p>
    {selectedId !== null && <button className="secondary" disabled={!!draft || saving} onClick={() => select(null)}>← Back to catalogue</button>}
    {success && <p className="catalogue-success" role="status">{success}</p>}
    {error && <div className="catalogue-error" role="alert"><p>{error}</p>{!draft && <button className="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</button>}</div>}
    {loading && <p role="status">Loading venue information…</p>}

    {!loading && !error && selectedId === null && (venues.length ? <div className="catalogue-grid">
      {venues.map((item) => <article className="catalogue-card" key={item.venue_id}>
        <h2>{item.name}</h2><p>{item.location}</p><p>Capacity: {item.capacity ?? 'Not specified'}</p>
        <p className="catalogue-muted">{showList(item.layouts)}</p>
        <button className="primary" aria-label={`View ${item.name}`} onClick={() => select(item.venue_id)}>View details</button>
      </article>)}
    </div> : <p className="catalogue-empty">No venues available.</p>)}

    {!loading && venue && !draft && <article className="catalogue-panel">
      <div className="catalogue-heading"><div><h2>{venue.name}</h2><p>{venue.location} · Capacity: {venue.capacity ?? 'Not specified'}</p></div>
        {canEdit && <button className="primary" onClick={() => { setDraft(draftFor(venue)); setError(''); setSuccess(''); }}>Edit venue</button>}
      </div>
      <div className="catalogue-details"><section><h3>Operating hours</h3><dl className="catalogue-hours">{DAYS.map((day) => {
        const hours = venue.operating_hours?.[day];
        return <div key={day}><dt>{title(day)}</dt><dd>{!hours ? 'Not specified' : hours.closed ? 'Closed' : `${hours.opens} – ${hours.closes}`}</dd></div>;
      })}</dl></section><section>
        <h3>Facilities</h3><p>{showList(venue.facilities)}</p>
        <h3>Accessibility</h3><p>{venue.accessible == null ? 'Not specified' : Number(venue.accessible) === 1 ? 'Accessible' : 'Not accessible'}</p><p>{venue.accessibility_details || 'No additional accessibility information.'}</p>
        <h3>Supported characteristics / layouts</h3><p>{showList(venue.layouts)}</p>
      </section></div>
    </article>}

    {!loading && venue && draft && canEdit && <form className="catalogue-panel" onSubmit={save} aria-busy={saving}>
      <h2>Edit {venue.name}</h2><p className="catalogue-muted">{venue.location} · Capacity: {venue.capacity ?? 'Not specified'}</p>
      <fieldset disabled={saving}><legend>Operating hours</legend><p className="catalogue-muted">Use local venue time. Closing must be later on the same day. Set each day’s times or mark it closed.</p>
        {DAYS.map((day) => {
          const hours = draft.operating_hours[day];
          return <div className="catalogue-hours-row" key={day}><strong>{title(day)}</strong>
            <label className="catalogue-checkbox"><input type="checkbox" checked={hours.closed} onChange={(event) => changeHours(day, event.target.checked ? { closed: true, opens: null, closes: null } : { closed: false, opens: '', closes: '' })} />Closed</label>
            <label>Opens<input type="time" aria-label={`${title(day)} opening time`} disabled={hours.closed} required={!hours.closed} value={hours.opens || ''} onChange={(event) => changeHours(day, { opens: event.target.value })} /></label>
            <label>Closes<input type="time" aria-label={`${title(day)} closing time`} disabled={hours.closed} required={!hours.closed} value={hours.closes || ''} onChange={(event) => changeHours(day, { closes: event.target.value })} /></label>
          </div>;
        })}
      </fieldset>
      <fieldset disabled={saving} className="catalogue-fields"><legend>Planning information</legend>
        <p className="catalogue-muted" id="catalogue-list-help">Facilities and layouts: one item per line, up to 30 items of 100 characters each. Leave blank if not specified.</p>
        <label>Facilities<textarea rows={3} aria-describedby="catalogue-list-help" value={draft.facilities} placeholder={'Wi-Fi\nProjector'} onChange={(event) => setDraft({ ...draft, facilities: event.target.value })} /></label>
        <label>Accessibility<select value={draft.accessible} onChange={(event) => setDraft({ ...draft, accessible: Number(event.target.value) })}><option value={1}>Accessible</option><option value={0}>Not accessible</option></select></label>
        <label>Accessibility notes<textarea rows={3} maxLength={1000} value={draft.accessibility_details} placeholder="For example, step-free entrance and accessible toilets" onChange={(event) => setDraft({ ...draft, accessibility_details: event.target.value })} /></label>
        <label>Supported characteristics / layouts<textarea rows={3} aria-describedby="catalogue-list-help" value={draft.layouts} placeholder={'Theatre\nBanquet\nClassroom'} onChange={(event) => setDraft({ ...draft, layouts: event.target.value })} /></label>
      </fieldset>
      <div className="catalogue-actions"><button type="button" className="secondary" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>Cancel</button><button className="primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    </form>}
  </main>;
}
