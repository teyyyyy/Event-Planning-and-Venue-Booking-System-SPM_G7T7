import React, {
  useEffect,
  useMemo,
  useState
} from 'react';


const API =
  import.meta.env.VITE_API_URL ||
  'http://127.0.0.1:8000/api';


function newEquipmentRow() {
  return {
    equipment_id: '',
    requested_quantity: '',
    technical_requirements: '',
  };
}


export default function EquipmentRequest({
  user
}) {

  console.log(
    '[DEBUG] EquipmentRequest user:',
    user
  );

  console.log(
    '[DEBUG] user.id being used:',
    user?.id
  );

  console.log(
    '[DEBUG] API base URL:',
    API
  );


  const [
    activeTab,
    setActiveTab
  ] = useState('submission');


  const [
    events,
    setEvents
  ] = useState([]);


  const [
    equipment,
    setEquipment
  ] = useState([]);


  const [
    eventId,
    setEventId
  ] = useState('');


  const [
    items,
    setItems
  ] = useState([
    newEquipmentRow()
  ]);


  const [
    availability,
    setAvailability
  ] = useState({});


  const [
    requests,
    setRequests
  ] = useState([]);


  const [
    loading,
    setLoading
  ] = useState(true);


  const [
    loadingRequests,
    setLoadingRequests
  ] = useState(false);


  const [
    checkingAvailability,
    setCheckingAvailability
  ] = useState(false);


  const [
    submitting,
    setSubmitting
  ] = useState(false);


  const [
    pageError,
    setPageError
  ] = useState('');


  const [
    notice,
    setNotice
  ] = useState(null);


  // ============================================================
  // Load initial data
  // ============================================================

  useEffect(() => {

    async function loadInitialData() {

      setLoading(true);

      setPageError('');


      try {

        const eventsUrl =
          `${API}/event-coordinators/${user.id}/events`;

        const equipmentUrl =
          `${API}/equipment`;


        console.log(
          '[DEBUG] Events URL:',
          eventsUrl
        );

        console.log(
          '[DEBUG] Equipment URL:',
          equipmentUrl
        );


        const [
          eventResponse,
          equipmentResponse
        ] = await Promise.all([

          fetch(eventsUrl),

          fetch(equipmentUrl),

        ]);


        console.log(
          '[DEBUG] Events response status:',
          eventResponse.status
        );

        console.log(
          '[DEBUG] Equipment response status:',
          equipmentResponse.status
        );


        const eventResult =
          await eventResponse.json();


        const equipmentResult =
          await equipmentResponse.json();


        console.log(
          '[DEBUG] Events API response:',
          eventResult
        );


        console.log(
          '[DEBUG] Is events response an array?',
          Array.isArray(
            eventResult
          )
        );


        console.log(
          '[DEBUG] Number of events:',
          Array.isArray(eventResult)
            ? eventResult.length
            : 'not an array'
        );


        console.log(
          '[DEBUG] Equipment API response:',
          equipmentResult
        );


        console.log(
          '[DEBUG] Is equipment response an array?',
          Array.isArray(
            equipmentResult
          )
        );


        console.log(
          '[DEBUG] Number of equipment rows:',
          Array.isArray(equipmentResult)
            ? equipmentResult.length
            : 'not an array'
        );


        if (!eventResponse.ok) {

          throw new Error(
            eventResult.detail ||
            'Unable to load your assigned events.'
          );

        }


        if (!equipmentResponse.ok) {

          throw new Error(
            equipmentResult.detail ||
            'Unable to load the equipment catalogue.'
          );

        }


        setEvents(
          Array.isArray(eventResult)
            ? eventResult
            : []
        );


        setEquipment(
          Array.isArray(equipmentResult)
            ? equipmentResult
            : []
        );


      } catch (error) {

        console.error(
          '[DEBUG] Initial load error:',
          error
        );


        setPageError(
          error.message ||
          'Unable to load equipment request information.'
        );


      } finally {

        setLoading(false);

      }

    }


    loadInitialData();


  }, [
    user.id
  ]);


  // ============================================================
  // Log state whenever it changes
  // ============================================================

  useEffect(() => {

    console.log(
      '[DEBUG] events state updated:',
      events
    );

  }, [
    events
  ]);


  useEffect(() => {

    console.log(
      '[DEBUG] equipment state updated:',
      equipment
    );

  }, [
    equipment
  ]);


  // ============================================================
  // Availability
  // ============================================================

  useEffect(() => {

    if (!eventId) {

      setAvailability({});

      return;

    }


    async function loadAvailability() {

      setCheckingAvailability(
        true
      );


      try {

        const availabilityUrl =
          `${API}/event-coordinators/${user.id}` +
          `/events/${eventId}` +
          `/equipment-availability`;


        console.log(
          '[DEBUG] Availability URL:',
          availabilityUrl
        );


        const response =
          await fetch(
            availabilityUrl
          );


        console.log(
          '[DEBUG] Availability response status:',
          response.status
        );


        const result =
          await response.json();


        console.log(
          '[DEBUG] Availability response:',
          result
        );


        if (!response.ok) {

          throw new Error(
            result.detail ||
            'Unable to check equipment availability.'
          );

        }


        const availabilityMap = {};


        result.forEach(
          (item) => {

            availabilityMap[
              item.equipment_id
            ] = item;

          }
        );


        console.log(
          '[DEBUG] Availability map:',
          availabilityMap
        );


        setAvailability(
          availabilityMap
        );


      } catch (error) {

        console.error(
          '[DEBUG] Availability error:',
          error
        );


        setAvailability({});


        setNotice({

          type: 'error',

          text:
            error.message ||
            'Unable to check equipment availability.',

        });


      } finally {

        setCheckingAvailability(
          false
        );

      }

    }


    loadAvailability();


  }, [
    eventId,
    user.id
  ]);


  // ============================================================
  // Load previous requests
  // ============================================================

  async function loadRequests() {

    setLoadingRequests(
      true
    );


    try {

      const requestsUrl =
        `${API}/event-coordinators/${user.id}` +
        `/equipment-requests`;


      console.log(
        '[DEBUG] Requests URL:',
        requestsUrl
      );


      const response =
        await fetch(
          requestsUrl
        );


      console.log(
        '[DEBUG] Requests response status:',
        response.status
      );


      const result =
        await response.json();


      console.log(
        '[DEBUG] Requests response:',
        result
      );


      if (!response.ok) {

        throw new Error(
          result.detail ||
          'Unable to load equipment requests.'
        );

      }


      setRequests(
        Array.isArray(result)
          ? result
          : []
      );


    } catch (error) {

      console.error(
        '[DEBUG] Requests error:',
        error
      );


      setNotice({

        type: 'error',

        text:
          error.message ||
          'Unable to load equipment requests.',

      });


    } finally {

      setLoadingRequests(
        false
      );

    }

  }


  function openRequestView() {

    setActiveTab(
      'view'
    );


    loadRequests();

  }


  // ============================================================
  // Selected equipment
  // ============================================================

  const selectedEquipmentIds =
    useMemo(

      () =>
        items
          .map(
            (item) =>
              item.equipment_id
          )
          .filter(Boolean),

      [items]

    );


  // ============================================================
  // Change item
  // ============================================================

  function changeItem(
    index,
    field,
    value
  ) {

    console.log(
      '[DEBUG] changeItem:',
      {
        index,
        field,
        value
      }
    );


    setItems(

      (currentItems) =>

        currentItems.map(
          (
            item,
            itemIndex
          ) => {

            if (
              itemIndex !== index
            ) {

              return item;

            }


            return {

              ...item,

              [field]: value,

            };

          }
        )

    );

  }


  function addEquipmentRow() {

    setItems(
      (currentItems) => [
        ...currentItems,
        newEquipmentRow()
      ]
    );

  }


  function removeEquipmentRow(
    index
  ) {

    if (
      items.length === 1
    ) {

      return;

    }


    setItems(

      (currentItems) =>

        currentItems.filter(
          (
            _,
            itemIndex
          ) =>
            itemIndex !== index
        )

    );

  }


  // ============================================================
  // Validation
  // ============================================================

  function quantityError(
    item
  ) {

    if (
      item.requested_quantity === ''
    ) {

      return '';

    }


    const quantity =
      Number(
        item.requested_quantity
      );


    if (
      !Number.isInteger(
        quantity
      ) ||
      quantity <= 0
    ) {

      return (
        'Quantity must be a positive whole number.'
      );

    }


    if (!item.equipment_id) {

      return '';

    }


    const equipmentAvailability =
      availability[
        item.equipment_id
      ];


    if (
      !equipmentAvailability
    ) {

      return '';

    }


    const maximum =
      Number(
        equipmentAvailability
          .available_quantity
      );


    if (
      quantity > maximum
    ) {

      return (
        `Maximum currently available: ${maximum}.`
      );

    }


    return '';

  }


  function formIsValid() {

    if (!eventId) {

      return false;

    }


    for (
      const item of items
    ) {

      if (!item.equipment_id) {

        return false;

      }


      if (
        item.requested_quantity === ''
      ) {

        return false;

      }


      if (
        quantityError(item)
      ) {

        return false;

      }

    }


    return true;

  }


  // ============================================================
  // Submit
  // ============================================================

  async function submitRequest(
    event
  ) {

    event.preventDefault();


    const payload = {

      event_id:
        Number(eventId),

      items:
        items.map(
          (item) => ({

            equipment_id:
              item.equipment_id,

            requested_quantity:
              Number(
                item.requested_quantity
              ),

            technical_requirements:
              item
                .technical_requirements
                .trim(),

          })
        ),

    };


    console.log(
      '[DEBUG] Submit payload:',
      payload
    );


    if (!eventId) {

      setNotice({

        type: 'error',

        text:
          'Please select an event.',

      });

      return;

    }


    for (
      const item of items
    ) {

      if (!item.equipment_id) {

        setNotice({

          type: 'error',

          text:
            'Please select an equipment type for every row.',

        });

        return;

      }


      if (
        item.requested_quantity === ''
      ) {

        setNotice({

          type: 'error',

          text:
            'Please enter a quantity for every equipment item.',

        });

        return;

      }


      const error =
        quantityError(
          item
        );


      if (error) {

        setNotice({

          type: 'error',

          text: error,

        });

        return;

      }

    }


    setSubmitting(
      true
    );


    try {

      const submitUrl =
        `${API}/event-coordinators/${user.id}` +
        `/equipment-requests`;


      console.log(
        '[DEBUG] Submit URL:',
        submitUrl
      );


      const response =
        await fetch(
          submitUrl,
          {

            method: 'POST',

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


      console.log(
        '[DEBUG] Submit response status:',
        response.status
      );


      const result =
        await response.json();


      console.log(
        '[DEBUG] Submit response:',
        result
      );


      if (!response.ok) {

        throw new Error(
          result.detail ||
          'Equipment request could not be submitted.'
        );

      }


      setNotice({

        type: 'success',

        text:
          `Equipment request #${result.request_id} was submitted successfully.`,

      });


      setEventId('');


      setItems([
        newEquipmentRow()
      ]);


      setAvailability({});


    } catch (error) {

      console.error(
        '[DEBUG] Submit error:',
        error
      );


      setNotice({

        type: 'error',

        text:
          error.message ||
          'Equipment request could not be submitted.',

      });


    } finally {

      setSubmitting(
        false
      );

    }

  }


  // ============================================================
  // Loading
  // ============================================================

  if (loading) {

    return (

      <section className="equipment-page">

        <p>
          Loading equipment request page…
        </p>

      </section>

    );

  }


  // ============================================================
  // Main page
  // ============================================================

  return (

    <section className="equipment-page">


      <header className="equipment-page-header">

        <div>

          <p className="kicker">
            Gather / Equipment planning
          </p>


          <h1>
            Equipment request
          </h1>

        </div>


        <span className="live">
          ● Supabase connected
        </span>

      </header>


      <div className="equipment-sub-tabs">

        <button

          type="button"

          className={
            activeTab === 'submission'
              ? 'active'
              : ''
          }

          onClick={
            () =>
              setActiveTab(
                'submission'
              )
          }

        >

          Equipment Request Submission

        </button>


        <button

          type="button"

          className={
            activeTab === 'view'
              ? 'active'
              : ''
          }

          onClick={
            openRequestView
          }

        >

          Equipment Request View

        </button>

      </div>


      {
        pageError && (

          <div className="page-error">
            {pageError}
          </div>

        )
      }


      {
        activeTab === 'submission' && (

          <form
            className="request-form"
            onSubmit={
              submitRequest
            }
          >

            <div className="form-heading">

              <div>

                <h2>
                  Submit equipment request
                </h2>


                <p>
                  Select one of your assigned events
                  and specify the equipment required.
                </p>

              </div>


              <div className="form-actions">

                <button

                  className="primary"

                  type="submit"

                  disabled={
                    submitting ||
                    checkingAvailability ||
                    !formIsValid()
                  }

                >

                  {
                    submitting
                      ? 'Submitting…'
                      : 'Submit request'
                  }

                </button>

              </div>

            </div>


            <div className="form-grid">

              <label className="wide">

                Event

                <select

                  value={
                    eventId
                  }

                  onChange={
                    (event) => {

                      console.log(
                        '[DEBUG] Selected event:',
                        event.target.value
                      );

                      setEventId(
                        event.target.value
                      );

                    }
                  }

                  required

                >

                  <option value="">
                    Select assigned event
                  </option>


                  {
                    events.map(
                      (event) => (

                        <option

                          key={
                            event.id
                          }

                          value={
                            event.id
                          }

                        >

                          {
                            event.event_name
                          }

                          {' — '}

                          {
                            event.event_date
                          }

                        </option>

                      )
                    )
                  }

                </select>

              </label>

            </div>


            {
              events.length === 0 && (

                <p className="field-warning">

                  No assigned events were returned by the backend.

                </p>

              )
            }


            <div className="equipment-request-items">

              <div className="equipment-items-heading">

                <div>

                  <h3>
                    Equipment required
                  </h3>


                  <p>
                    Add each type of equipment
                    required for this event.
                  </p>

                </div>


                <button

                  type="button"

                  className="secondary"

                  onClick={
                    addEquipmentRow
                  }

                >

                  + Add equipment

                </button>

              </div>


              {
                items.map(
                  (
                    item,
                    index
                  ) => {

                    const currentAvailability =
                      item.equipment_id
                        ? availability[
                            item.equipment_id
                          ]
                        : null;


                    const error =
                      quantityError(
                        item
                      );


                    return (

                      <div
                        className="equipment-item-card"
                        key={
                          index
                        }
                      >

                        <h4>
                          Equipment {index + 1}
                        </h4>


                        <div className="form-grid">


                          <label>

                            Equipment type

                            <select

                              value={
                                item.equipment_id
                              }

                              onChange={
                                (event) =>

                                  changeItem(

                                    index,

                                    'equipment_id',

                                    event.target.value

                                  )
                              }

                              required

                            >

                              <option value="">

                                Select equipment

                              </option>


                              {
                                equipment.map(
                                  (
                                    equipmentItem
                                  ) => {

                                    const alreadySelected =
                                      selectedEquipmentIds
                                        .includes(
                                          equipmentItem
                                            .equipment_id
                                        )
                                      &&
                                      item.equipment_id !==
                                      equipmentItem
                                        .equipment_id;


                                    return (

                                      <option

                                        key={
                                          equipmentItem
                                            .equipment_id
                                        }

                                        value={
                                          equipmentItem
                                            .equipment_id
                                        }

                                        disabled={
                                          alreadySelected
                                        }

                                      >

                                        {
                                          equipmentItem
                                            .equipment_name
                                        }

                                      </option>

                                    );

                                  }
                                )
                              }

                            </select>


                            {
                              equipment.length === 0 && (

                                <span className="field-warning">

                                  No equipment was returned by the backend.

                                </span>

                              )
                            }

                          </label>


                          <label>

                            Requested quantity

                            <input

                              type="number"

                              min="1"

                              step="1"

                              value={
                                item.requested_quantity
                              }

                              onChange={
                                (event) =>

                                  changeItem(

                                    index,

                                    'requested_quantity',

                                    event.target.value

                                  )
                              }

                              placeholder="Enter quantity"

                              required

                            />


                            {
                              currentAvailability && (

                                <span className="availability-hint">

                                  Available for this event:{' '}

                                  {
                                    currentAvailability
                                      .available_quantity
                                  }

                                </span>

                              )
                            }


                            {
                              error && (

                                <span className="field-error">

                                  {error}

                                </span>

                              )
                            }

                          </label>


                          <label className="wide">

                            Technical requirements

                            <span className="optional-label">

                              {' '}
                              (Optional)

                            </span>


                            <textarea

                              rows="4"

                              value={
                                item
                                  .technical_requirements
                              }

                              onChange={
                                (event) =>

                                  changeItem(

                                    index,

                                    'technical_requirements',

                                    event.target.value

                                  )
                              }

                              placeholder={
                                'Example: Wireless microphones, HDMI connection, floor-standing speakers.'
                              }

                            />

                          </label>

                        </div>


                        {
                          items.length > 1 && (

                            <button

                              type="button"

                              className="remove-equipment"

                              onClick={
                                () =>
                                  removeEquipmentRow(
                                    index
                                  )
                              }

                            >

                              Remove equipment

                            </button>

                          )
                        }

                      </div>

                    );

                  }
                )
              }

            </div>

          </form>

        )
      }


      {
        activeTab === 'view' && (

          <div className="request-form">

            <div className="form-heading">

              <div>

                <h2>
                  Equipment request submissions
                </h2>


                <p>
                  View equipment requests that
                  you have previously submitted.
                </p>

              </div>

            </div>


            {
              loadingRequests
                ? (

                    <p>
                      Loading requests…
                    </p>

                  )
                : requests.length === 0
                  ? (

                      <p className="empty-state">

                        No equipment requests
                        have been submitted yet.

                      </p>

                    )
                  : (

                      <div className="request-table-wrapper">

                        <table className="request-table">

                          <thead>

                            <tr>

                              <th>
                                Request ID
                              </th>

                              <th>
                                Event
                              </th>

                              <th>
                                Event Date
                              </th>

                              <th>
                                Equipment
                              </th>

                              <th>
                                Status
                              </th>

                            </tr>

                          </thead>


                          <tbody>

                            {
                              requests.map(
                                (request) => (

                                  <tr
                                    key={
                                      request.request_id
                                    }
                                  >

                                    <td>
                                      #{request.request_id}
                                    </td>

                                    <td>
                                      {request.event_name}
                                    </td>

                                    <td>
                                      {request.event_date}
                                    </td>

                                    <td>

                                      {
                                        request.items
                                          ?.map(
                                            (item) =>
                                              `${item.equipment_name} × ${item.requested_quantity}`
                                          )
                                          .join(', ')
                                      }

                                    </td>

                                    <td>
                                      {request.status}
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

        )
      }


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
                      ? 'Submission successful'
                      : 'Something went wrong'
                  }

                </h2>


                <p>
                  {notice.text}
                </p>


                <button
                  className="primary"
                  type="button"
                  onClick={
                    () =>
                      setNotice(null)
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