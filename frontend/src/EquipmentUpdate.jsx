import React, {
  useEffect,
  useState
} from 'react';


const API =
  import.meta.env.VITE_API_URL ||
  'http://127.0.0.1:8000/api';


function formatDateTime(value) {

  if (!value) {
    return '—';
  }


  const date =
    new Date(
      value
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return value;
  }


  return date.toLocaleString(
    'en-SG',
    {
      day:
        '2-digit',

      month:
        'short',

      year:
        'numeric',

      hour:
        '2-digit',

      minute:
        '2-digit',
    }
  );
}


function deepCopy(value) {

  return JSON.parse(
    JSON.stringify(
      value
    )
  );
}


function makeEditableRequests(
  requests
) {

  return requests.map(
    (request) => ({

      ...request,

      items:
        request.items.map(
          (item) => ({

            ...item,

            requested_quantity:
              String(
                item.requested_quantity
              ),

            _isNew:
              false,

            _localId:
              `existing-${item.request_item_id}`,
          })
        ),
    })
  );
}


function newEquipmentItem() {

  return {

    request_item_id:
      null,

    equipment_id:
      '',

    requested_quantity:
      '',

    technical_requirements:
      '',

    _isNew:
      true,

    _localId:
      (
        `new-${Date.now()}-`
        + `${Math.random()}`
      ),
  };
}


export default function EquipmentUpdate({
  user
}) {

  const [
    screen,
    setScreen
  ] = useState(
    'summary'
  );


  const [
    summaries,
    setSummaries
  ] = useState([]);


  const [
    selectedEvent,
    setSelectedEvent
  ] = useState(null);


  const [
    requests,
    setRequests
  ] = useState([]);


  const [
    originalRequests,
    setOriginalRequests
  ] = useState([]);


  const [
    equipmentCatalogue,
    setEquipmentCatalogue
  ] = useState([]);


  const [
    loading,
    setLoading
  ] = useState(true);


  const [
    saving,
    setSaving
  ] = useState(false);


  const [
    error,
    setError
  ] = useState('');


  const [
    notice,
    setNotice
  ] = useState(null);


  // ============================================================
  // Load event summary
  // ============================================================

  async function loadSummary() {

    setLoading(
      true
    );

    setError('');


    try {

      const response =
        await fetch(
          (
            `${API}/equipment-update/`
            + `${user.id}/requests/summary`
          )
        );


      const result =
        await response.json();


      if (!response.ok) {

        throw new Error(
          result.detail ||
          'Unable to load equipment requests.'
        );
      }


      setSummaries(
        Array.isArray(
          result
        )
          ? result
          : []
      );


    } catch (loadError) {

      setError(
        loadError.message ||
        'Unable to load equipment requests.'
      );


    } finally {

      setLoading(
        false
      );
    }
  }


  useEffect(
    () => {

      loadSummary();

    },
    [
      user.id
    ]
  );


  // ============================================================
  // Open event
  // ============================================================

  async function openEvent(
    eventId
  ) {

    setLoading(
      true
    );

    setError('');


    try {

      const response =
        await fetch(
          (
            `${API}/equipment-update/`
            + `${user.id}/events/`
            + `${eventId}/requests`
          )
        );


      const result =
        await response.json();


      if (!response.ok) {

        throw new Error(
          result.detail ||
          'Unable to load request details.'
        );
      }


      setSelectedEvent(
        result.event
      );


      setEquipmentCatalogue(
        result.equipment_catalogue
        || []
      );


      const editableRequests =
        makeEditableRequests(
          result.requests
          || []
        );


      setRequests(
        editableRequests
      );


      /*
       * Browser-only baseline.
       *
       * This is used to calculate changes.
       * It is not stored in Supabase.
       */
      setOriginalRequests(
        deepCopy(
          editableRequests
        )
      );


      setScreen(
        'details'
      );


    } catch (loadError) {

      setError(
        loadError.message ||
        'Unable to load request details.'
      );


    } finally {

      setLoading(
        false
      );
    }
  }


  // ============================================================
  // Find original request
  // ============================================================

  function findOriginalRequest(
    requestId
  ) {

    return originalRequests.find(
      (request) =>
        request.request_id
        === requestId
    );
  }


  // ============================================================
  // Find original item
  // ============================================================

  function findOriginalItem(
    requestId,
    requestItemId
  ) {

    const originalRequest =
      findOriginalRequest(
        requestId
      );


    return originalRequest
      ?.items
      ?.find(
        (item) =>
          item.request_item_id
          === requestItemId
      );
  }


  // ============================================================
  // Equipment name helper
  // ============================================================

  function equipmentName(
    equipmentId
  ) {

    return (
      equipmentCatalogue.find(
        (equipment) =>
          equipment.equipment_id
          === equipmentId
      )
      ?.equipment_name
      || equipmentId
      || 'Equipment'
    );
  }


  // ============================================================
  // Live changes for one item
  // ============================================================

  function buildItemChanges(
    requestId,
    item
  ) {

    // ------------------------------------------------------------
    // Newly added equipment
    // ------------------------------------------------------------

    if (
      item._isNew
    ) {

      if (
        !item.equipment_id
      ) {

        return [
          'New equipment item added'
        ];
      }


      return [
        (
          `Added ${equipmentName(item.equipment_id)}`
          + (
              item.requested_quantity !== ''
                ? ` × ${item.requested_quantity}`
                : ''
            )
        )
      ];
    }


    // ------------------------------------------------------------
    // Existing item
    // ------------------------------------------------------------

    const original =
      findOriginalItem(
        requestId,
        item.request_item_id
      );


    if (!original) {
      return [];
    }


    const changes = [];


    if (
      original.equipment_id
      !== item.equipment_id
    ) {

      changes.push(
        (
          `Equipment: `
          + `${equipmentName(original.equipment_id)}`
          + ` → `
          + `${equipmentName(item.equipment_id)}`
        )
      );
    }


    const oldQuantity =
      Number(
        original.requested_quantity
      );


    const newQuantity =
      Number(
        item.requested_quantity
      );


    if (
      oldQuantity
      !== newQuantity
    ) {

      if (
        newQuantity === 0
      ) {

        changes.push(
          (
            `Quantity: `
            + `${oldQuantity} → 0 `
            + `(cancelled)`
          )
        );

      } else {

        changes.push(
          (
            `Quantity: `
            + `${oldQuantity} → ${newQuantity}`
          )
        );
      }
    }


    const oldRequirements =
      (
        original
          .technical_requirements
        || ''
      ).trim();


    const newRequirements =
      (
        item
          .technical_requirements
        || ''
      ).trim();


    if (
      oldRequirements
      !== newRequirements
    ) {

      changes.push(
        (
          `Technical requirements: `
          + `"${oldRequirements || 'None'}"`
          + ` → `
          + `"${newRequirements || 'None'}"`
        )
      );
    }


    return changes;
  }


  // ============================================================
  // Does request contain changes?
  // ============================================================

  function requestHasChanges(
    request
  ) {

    return request.items.some(
      (item) =>
        buildItemChanges(
          request.request_id,
          item
        ).length > 0
    );
  }


  // ============================================================
  // Total changes across event
  // ============================================================

  function changedRequestCount() {

    return requests.filter(
      (request) =>
        requestHasChanges(
          request
        )
    ).length;
  }


  // ============================================================
  // Edit item
  // ============================================================

  function changeItem(
    requestId,
    localId,
    field,
    value
  ) {

    setRequests(
      (currentRequests) =>
        currentRequests.map(
          (request) => {

            if (
              request.request_id
              !== requestId
            ) {
              return request;
            }


            return {

              ...request,

              items:
                request.items.map(
                  (item) => {

                    if (
                      item._localId
                      !== localId
                    ) {
                      return item;
                    }


                    return {

                      ...item,

                      [field]:
                        value,
                    };
                  }
                ),
            };
          }
        )
    );
  }


  // ============================================================
  // Add new equipment to one request
  // ============================================================

  function addEquipment(
    requestId
  ) {

    setRequests(
      (currentRequests) =>
        currentRequests.map(
          (request) => {

            if (
              request.request_id
              !== requestId
            ) {
              return request;
            }


            return {

              ...request,

              items: [
                ...request.items,
                newEquipmentItem()
              ],
            };
          }
        )
    );
  }


  // ============================================================
  // Remove a NEW equipment row before confirmation
  // ============================================================

  function removeNewEquipment(
    requestId,
    localId
  ) {

    setRequests(
      (currentRequests) =>
        currentRequests.map(
          (request) => {

            if (
              request.request_id
              !== requestId
            ) {
              return request;
            }


            return {

              ...request,

              items:
                request.items.filter(
                  (item) =>
                    item._localId
                    !== localId
                ),
            };
          }
        )
    );
  }


  // ============================================================
  // Validate all changed requests
  // ============================================================

  function validateChanges() {

    const changedRequests =
      requests.filter(
        (request) =>
          requestHasChanges(
            request
          )
      );


    if (
      changedRequests.length === 0
    ) {

      return {
        valid:
          false,

        message:
          'There are no changes to confirm.',
      };
    }


    for (
      const request
      of changedRequests
    ) {

      const activeEquipment = [];


      for (
        const item
        of request.items
      ) {

        if (
          !item.equipment_id
        ) {

          return {
            valid:
              false,

            message:
              (
                `Request #${request.request_id} `
                + `contains an equipment row `
                + `without an equipment type.`
              ),
          };
        }


        if (
          item.requested_quantity === ''
        ) {

          return {
            valid:
              false,

            message:
              (
                `Please enter a quantity for every `
                + `equipment item in request `
                + `#${request.request_id}.`
              ),
          };
        }


        const quantity =
          Number(
            item.requested_quantity
          );


        if (
          !Number.isInteger(
            quantity
          )
          ||
          quantity < 0
        ) {

          return {
            valid:
              false,

            message:
              (
                'Quantity must be a whole '
                + 'number of 0 or more.'
              ),
          };
        }


        if (
          item._isNew
          &&
          quantity === 0
        ) {

          return {
            valid:
              false,

            message:
              (
                'New equipment must have a '
                + 'quantity greater than 0.'
              ),
          };
        }


        if (
          quantity > 0
        ) {

          if (
            activeEquipment.includes(
              item.equipment_id
            )
          ) {

            return {
              valid:
                false,

              message:
                (
                  `Request #${request.request_id} `
                  + `contains the same equipment `
                  + `type more than once.`
                ),
            };
          }


          activeEquipment.push(
            item.equipment_id
          );
        }
      }
    }


    return {
      valid:
        true,

      changedRequests,
    };
  }


  // ============================================================
  // Confirm ALL changes for event
  // ============================================================

  async function confirmAllUpdates() {

    const validation =
      validateChanges();


    if (
      !validation.valid
    ) {

      setNotice({

        type:
          'error',

        text:
          validation.message,
      });

      return;
    }


    setSaving(
      true
    );


    try {

      const payload = {

        requests:
          validation
            .changedRequests
            .map(
              (request) => ({

                request_id:
                  request.request_id,

                items:
                  request.items.map(
                    (item) => ({

                      request_item_id:
                        item._isNew
                          ? null
                          : item.request_item_id,

                      equipment_id:
                        item.equipment_id,

                      requested_quantity:
                        Number(
                          item.requested_quantity
                        ),

                      technical_requirements:
                        (
                          item
                            .technical_requirements
                          || ''
                        ).trim(),
                    })
                  ),
              })
            ),
      };


      const response =
        await fetch(
          (
            `${API}/equipment-update/`
            + `${user.id}/events/`
            + `${selectedEvent.id}/requests`
          ),
          {
            method:
              'PUT',

            headers: {

              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(
                payload
              ),
          }
        );


      const result =
        await response.json();


      if (!response.ok) {

        throw new Error(
          result.detail ||
          'Unable to update equipment requests.'
        );
      }


      setNotice({

        type:
          'success',

        text:
          (
            `${result.updated_requests.length} `
            + `equipment request`
            + (
                result.updated_requests.length === 1
                  ? ''
                  : 's'
              )
            + ` updated successfully.`
          ),
      });


      /*
       * Reload current event.
       * Newly saved equipment now receives real request_item_id
       * values from Supabase.
       */
      await openEvent(
        selectedEvent.id
      );


    } catch (saveError) {

      setNotice({

        type:
          'error',

        text:
          saveError.message ||
          'Unable to update equipment requests.',
      });


    } finally {

      setSaving(
        false
      );
    }
  }


  // ============================================================
  // Loading summary
  // ============================================================

  if (
    loading
    &&
    screen === 'summary'
  ) {

    return (

      <section className="equipment-page">

        <p>
          Loading equipment requests…
        </p>

      </section>
    );
  }


  // ============================================================
  // SUMMARY
  // ============================================================

  if (
    screen === 'summary'
  ) {

    return (

      <section className="equipment-page">

        <header className="equipment-page-header">

          <div>

            <p className="kicker">
              Gather / Equipment update
            </p>

            <h1>
              Equipment requests
            </h1>

          </div>


          <span className="live">
            ● Supabase connected
          </span>

        </header>


        {
          error && (

            <div className="page-error">
              {error}
            </div>

          )
        }


        <div className="request-form">

          <div className="form-heading">

            <div>

              <h2>
                Requests by event
              </h2>

              <p>
                Review all equipment requests
                grouped by event.
              </p>

            </div>

          </div>


          {
            summaries.length === 0
              ? (

                  <p className="empty-state">
                    There are currently no equipment requests.
                  </p>

                )
              : (

                  <div className="request-table-wrapper">

                    <table className="request-table">

                      <thead>

                        <tr>

                          <th>
                            Event
                          </th>

                          <th>
                            Event Date
                          </th>

                          <th>
                            Requests
                          </th>

                          <th>
                            Combined Equipment
                          </th>

                          <th>
                            Status
                          </th>

                          <th>
                            Action
                          </th>

                        </tr>

                      </thead>


                      <tbody>

                        {
                          summaries.map(
                            (summary) => (

                              <tr
                                key={
                                  summary.event_id
                                }
                              >

                                <td>

                                  <strong>
                                    {summary.event_name}
                                  </strong>

                                </td>


                                <td>
                                  {summary.event_date}
                                </td>


                                <td>
                                  {summary.request_count}
                                </td>


                                <td>
                                  {summary.equipment_description}
                                </td>


                                <td>

                                  <span
                                    className={
                                      (
                                        `request-status `
                                        + `request-status-${summary.status
                                          .toLowerCase()
                                          .replaceAll(' ', '-')}`
                                      )
                                    }
                                  >

                                    {summary.status}

                                  </span>

                                </td>


                                <td>

                                  <button
                                    type="button"
                                    className="assign"

                                    onClick={
                                      () =>
                                        openEvent(
                                          summary.event_id
                                        )
                                    }
                                  >

                                    View full details

                                  </button>

                                </td>

                              </tr>

                            )
                          )
                        }

                      </tbody>

                    </table>

                  </div>

                )
          }

        </div>

      </section>
    );
  }


  // ============================================================
  // DETAILS
  // ============================================================

  return (

    <section className="equipment-page">

      <header className="equipment-page-header">

        <div>

          <p className="kicker">
            Gather / Equipment update
          </p>

          <h1>
            {selectedEvent?.event_name}
          </h1>

        </div>


        <span className="live">
          ● Supabase connected
        </span>

      </header>


      <div className="technical-detail-toolbar">

        <button
          type="button"
          className="secondary"

          onClick={
            async () => {

              setScreen(
                'summary'
              );

              await loadSummary();
            }
          }
        >

          ← Back to all events

        </button>


        <div className="technical-event-date">

          Event date:{' '}

          <strong>
            {selectedEvent?.event_date}
          </strong>

        </div>

      </div>


      {
        error && (

          <div className="page-error">
            {error}
          </div>

        )
      }


      {
        requests.length === 0 && (

          <p className="empty-state">
            No equipment requests exist for this event.
          </p>

        )
      }


      {
        requests.map(
          (request) => (

            <div
              className="technical-request-card"
              key={
                request.request_id
              }
            >

              <div className="technical-request-header">

                <div>

                  <h2>
                    Request #{request.request_id}
                  </h2>


                  <p>

                    Submitted by{' '}

                    <strong>

                      {
                        request.created_by_name
                        || request.created_by
                      }

                    </strong>

                    {' · '}

                    {
                      formatDateTime(
                        request.created_at
                      )
                    }

                  </p>

                </div>


                <span
                  className={
                    (
                      `request-status `
                      + `request-status-${request.status
                        .toLowerCase()
                        .replaceAll(' ', '-')}`
                    )
                  }
                >

                  {request.status}

                </span>

              </div>


              {
                request.items.map(
                  (
                    item,
                    index
                  ) => {

                    const changes =
                      buildItemChanges(
                        request.request_id,
                        item
                      );


                    return (

                      <div
                        className="technical-edit-item"
                        key={
                          item._localId
                        }
                      >

                        <div className="equipment-update-item-heading">

                          <h3>

                            Equipment {
                              index + 1
                            }

                            {
                              item._isNew && (

                                <span className="new-equipment-badge">
                                  New
                                </span>

                              )
                            }

                          </h3>


                          {
                            item._isNew && (

                              <button
                                type="button"
                                className="remove-equipment"

                                onClick={
                                  () =>
                                    removeNewEquipment(
                                      request.request_id,
                                      item._localId
                                    )
                                }
                              >

                                Remove

                              </button>

                            )
                          }

                        </div>


                        <div className="form-grid">

                          <label>

                            Equipment

                            <select
                              value={
                                item.equipment_id
                              }

                              onChange={
                                (event) =>
                                  changeItem(
                                    request.request_id,
                                    item._localId,
                                    'equipment_id',
                                    event.target.value
                                  )
                              }
                            >

                              <option value="">
                                Select equipment
                              </option>


                              {
                                equipmentCatalogue.map(
                                  (equipment) => (

                                    <option
                                      key={
                                        equipment.equipment_id
                                      }

                                      value={
                                        equipment.equipment_id
                                      }
                                    >

                                      {
                                        equipment.equipment_name
                                      }

                                    </option>

                                  )
                                )
                              }

                            </select>

                          </label>


                          <label>

                            Final quantity

                            <input
                              type="number"
                              min={
                                item._isNew
                                  ? '1'
                                  : '0'
                              }
                              step="1"
                              inputMode="numeric"

                              value={
                                item.requested_quantity
                              }

                              onChange={
                                (event) =>
                                  changeItem(
                                    request.request_id,
                                    item._localId,
                                    'requested_quantity',
                                    event.target.value
                                  )
                              }
                            />


                            <span className="availability-hint">

                              {
                                item._isNew
                                  ? (
                                      'Enter the quantity required.'
                                    )
                                  : (
                                      'Set quantity to 0 to cancel this equipment.'
                                    )
                              }

                            </span>

                          </label>


                          <label className="wide">

                            Technical requirements

                            <textarea
                              rows="4"

                              value={
                                item.technical_requirements
                              }

                              onChange={
                                (event) =>
                                  changeItem(
                                    request.request_id,
                                    item._localId,
                                    'technical_requirements',
                                    event.target.value
                                  )
                              }
                            />

                          </label>

                        </div>


                        <div className="technical-change-summary">

                          <strong>
                            Changes before confirmation
                          </strong>


                          {
                            changes.length === 0
                              ? (

                                  <p>
                                    No changes to this equipment item.
                                  </p>

                                )
                              : (

                                  <ul>

                                    {
                                      changes.map(
                                        (
                                          change,
                                          changeIndex
                                        ) => (

                                          <li
                                            key={
                                              changeIndex
                                            }
                                          >

                                            {change}

                                          </li>

                                        )
                                      )
                                    }

                                  </ul>

                                )
                          }

                        </div>

                      </div>
                    );
                  }
                )
              }


              {/* =================================================
                  ADD NEW EQUIPMENT TO THIS REQUEST
              ================================================= */}

              <div className="equipment-update-add-row">

                <button
                  type="button"
                  className="secondary"

                  onClick={
                    () =>
                      addEquipment(
                        request.request_id
                      )
                  }
                >

                  + Add equipment

                </button>

              </div>


              {
                request.updated_by && (

                  <div className="equipment-update-last-updated">

                    Last updated by{' '}

                    <strong>

                      {
                        request.updated_by_name
                        || request.updated_by
                      }

                    </strong>

                    {' · '}

                    {
                      formatDateTime(
                        request.updated_at
                      )
                    }

                  </div>

                )
              }

            </div>
          )
        )
      }


      {/* =========================================================
          ONE CONFIRM BUTTON FOR THE ENTIRE EVENT
      ========================================================= */}

      {
        requests.length > 0 && (

          <div className="equipment-update-final-actions">

            <div>

              <strong>
                Final event changes
              </strong>

              <p>

                {
                  changedRequestCount() === 0
                    ? (
                        'No equipment requests have been changed.'
                      )
                    : (
                        `${changedRequestCount()} request${
                          changedRequestCount() === 1
                            ? ''
                            : 's'
                        } contain changes.`
                      )
                }

              </p>

            </div>


            <button
              type="button"
              className="primary"

              disabled={
                saving
                || changedRequestCount() === 0
              }

              onClick={
                confirmAllUpdates
              }
            >

              {
                saving
                  ? 'Updating…'
                  : 'Confirm All Updates'
              }

            </button>

          </div>

        )
      }


      {/* =========================================================
          NOTICE
      ========================================================= */}

      {
        notice && (
          <>

            <div className="notice-backdrop" />


            <div
              className={
                `notice ${notice.type}`
              }
              role="alertdialog"
              aria-modal="true"
            >

              <div className="notice-icon">

                {
                  notice.type === 'success'
                    ? '✓'
                    : '!'
                }

              </div>


              <div>

                <h2>

                  {
                    notice.type === 'success'
                      ? 'Update successful'
                      : 'Something went wrong'
                  }

                </h2>


                <p>
                  {notice.text}
                </p>


                <button
                  type="button"
                  className="primary"

                  onClick={
                    () =>
                      setNotice(
                        null
                      )
                  }
                >

                  Close

                </button>

              </div>

            </div>

          </>
        )
      }

    </section>
  );
}