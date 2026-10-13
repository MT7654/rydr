'use client';

import { Suspense, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { submitIntake } from './actions';

/**
 * Guided intake.
 *
 * Files a dispute from plain-language fields and ordinary rows, so nobody has to
 * hand-write the internal case JSON. Times are Singapore local and stored with an
 * explicit offset. The raw JSON endpoint still exists for scripted imports.
 */

const SINGAPORE_HINT = 'Singapore local time; stored with an explicit +08:00 offset.';

type GpsRow = {
  id: string;
  at: string;
  lat: string;
  lng: string;
  accuracy: string;
  speed: string;
  status: string;
};
type EventRow = { id: string; at: string; type: string; details: string };
type ContactRow = {
  id: string;
  at: string;
  sender: string;
  direction: string;
  answered: string;
  ring: string;
  content: string;
};
type RouteRow = {
  id: string;
  at: string;
  planned: string;
  actual: string;
  segment: string;
  justification: string;
  note: string;
};
type FareRow = { id: string; component: string; amount: string; direction: string; method: string };

const EMPTY_GPS: GpsRow = {
  id: '',
  at: '',
  lat: '',
  lng: '',
  accuracy: '',
  speed: '',
  status: 'waiting',
};
const EMPTY_EVENT: EventRow = { id: '', at: '', type: '', details: '' };
const EMPTY_CONTACT: ContactRow = {
  id: '',
  at: '',
  sender: 'driver',
  direction: 'outgoing',
  answered: 'no',
  ring: '',
  content: '',
};
const EMPTY_ROUTE: RouteRow = {
  id: '',
  at: '',
  planned: '',
  actual: '',
  segment: '',
  justification: 'unknown',
  note: '',
};
const EMPTY_FARE: FareRow = {
  id: '',
  component: '',
  amount: '',
  direction: 'charge',
  method: 'card',
};

type TripFields = {
  caseId: string;
  tripId: string;
  scheduledAt: string;
  pickupLabel: string;
  pickupLat: string;
  pickupLng: string;
  dropoffLabel: string;
  dropoffLat: string;
  dropoffLng: string;
  disputed: string;
  riderStatement: string;
  driverStatement: string;
};

const EMPTY_TRIP: TripFields = {
  caseId: '',
  tripId: '',
  scheduledAt: '',
  pickupLabel: '',
  pickupLat: '',
  pickupLng: '',
  dropoffLabel: '',
  dropoffLat: '',
  dropoffLng: '',
  disputed: '',
  riderStatement: '',
  driverStatement: '',
};

/** A worked no-show case, so the form can be tried without inventing data. */
const EXAMPLE: { trip: TripFields; gps: GpsRow[]; events: EventRow[]; contacts: ContactRow[]; fares: FareRow[] } = {
  trip: {
    caseId: 'CASE-DEMO-01',
    tripId: 'TRIP-DEMO-01',
    scheduledAt: '2026-09-17T09:00',
    pickupLabel: 'Marina Bay Sands Tower 1',
    pickupLat: '1.283400',
    pickupLng: '103.860700',
    dropoffLabel: 'Tanjong Pagar Centre',
    dropoffLat: '1.276400',
    dropoffLng: '103.845900',
    disputed: '5.00',
    riderStatement:
      'I was at the pickup point from 09:14 and never saw the car. The SGD 5.00 no-show charge should be reversed.',
    driverStatement: 'I arrived at 09:12 and waited at the pickup point until the timer expired.',
  },
  gps: [
    { id: 'DEMO-GPS-01', at: '2026-09-17T09:12', lat: '1.283500', lng: '103.860800', accuracy: '10', speed: '0', status: 'arrived' },
    { id: 'DEMO-GPS-02', at: '2026-09-17T09:14', lat: '1.283500', lng: '103.860800', accuracy: '10', speed: '0', status: 'waiting' },
    { id: 'DEMO-GPS-03', at: '2026-09-17T09:16', lat: '1.283500', lng: '103.860800', accuracy: '10', speed: '0', status: 'waiting' },
    { id: 'DEMO-GPS-04', at: '2026-09-17T09:18', lat: '1.283500', lng: '103.860800', accuracy: '10', speed: '0', status: 'waiting' },
    { id: 'DEMO-GPS-05', at: '2026-09-17T09:20', lat: '1.283500', lng: '103.860800', accuracy: '10', speed: '0', status: 'cancelled' },
  ],
  events: [
    { id: 'DEMO-EVT-01', at: '2026-09-17T09:00', type: 'booking_confirmed', details: 'Booking confirmed.' },
    { id: 'DEMO-EVT-02', at: '2026-09-17T09:12', type: 'driver_arrived', details: 'Driver marked arrival.' },
    { id: 'DEMO-EVT-03', at: '2026-09-17T09:12:30', type: 'wait_timer_started', details: 'Wait timer started.' },
    { id: 'DEMO-EVT-04', at: '2026-09-17T09:22', type: 'cancellation_fee_applied', details: 'No-show fee applied.' },
  ],
  contacts: [
    {
      id: 'DEMO-CALL-01',
      at: '2026-09-17T09:16',
      sender: 'driver',
      direction: 'outgoing',
      answered: 'no',
      ring: '25',
      content: 'Outbound call to rider, not answered.',
    },
  ],
  fares: [
    { id: 'DEMO-PAY-01', component: 'cancellation_fee', amount: '5.00', direction: 'charge', method: 'card' },
  ],
};

export default function IntakePage() {
  return (
    <Suspense fallback={null}>
      <IntakeForm />
    </Suspense>
  );
}

/** The action redirects back here with `?error=` when a field cannot be accepted. */
function IntakeError() {
  const params = useSearchParams();
  const error = params.get('error');
  if (!error) return null;
  return (
    <div className="notice notice--danger" role="alert">
      <strong>The case was not filed.</strong>
      <div>{error}</div>
    </div>
  );
}

function IntakeForm() {
  const [category, setCategory] = useState('no_show_charge');
  const [trip, setTrip] = useState<TripFields>({ ...EMPTY_TRIP });
  const [gps, setGps] = useState<GpsRow[]>([{ ...EMPTY_GPS }]);
  const [events, setEvents] = useState<EventRow[]>([{ ...EMPTY_EVENT }]);
  const [contacts, setContacts] = useState<ContactRow[]>([{ ...EMPTY_CONTACT }]);
  const [routes, setRoutes] = useState<RouteRow[]>([{ ...EMPTY_ROUTE }]);
  const [fares, setFares] = useState<FareRow[]>([{ ...EMPTY_FARE }]);

  const setTripField = (key: keyof TripFields, value: string) =>
    setTrip((current) => ({ ...current, [key]: value }));

  function loadExample() {
    setTrip({ ...EXAMPLE.trip });
    setGps(EXAMPLE.gps.map((row) => ({ ...row })));
    setEvents(EXAMPLE.events.map((row) => ({ ...row })));
    setContacts(EXAMPLE.contacts.map((row) => ({ ...row })));
    setFares(EXAMPLE.fares.map((row) => ({ ...row })));
    setCategory('no_show_charge');
  }

  return (
    <main className="container stack">
      <div className="card">
        <div className="card__title">
          <h1>File a dispute</h1>
          <div className="row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={loadExample}>
              Load a worked example
            </button>
            <Link href="/worklist" className="btn btn--ghost btn--sm">
              Back to queue
            </Link>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Every field is validated against the same case schema the rest of Rydr uses, so a dispute
          filed here is reviewed exactly like a seeded one. Nothing is sent to a payment provider or
          to any party.
        </p>
      </div>

      <IntakeError />

      <form action={submitIntake} className="stack">
        <section className="card">
          <div className="card__title">
            <h2>1. The dispute</h2>
          </div>
          <div className="intake-grid">
            <label className="field">
              <span className="field__label">Case reference</span>
              <input
                name="caseId"
                className="input"
                value={trip.caseId}
                onChange={(event) => setTripField('caseId', event.target.value)}
                placeholder="Leave blank to generate one"
              />
            </label>
            <label className="field">
              <span className="field__label">What is being disputed?</span>
              <select
                name="category"
                className="input"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="no_show_charge">A no-show or cancellation fee</option>
                <option value="route_overcharge">A route deviation or overcharge</option>
                <option value="fare_dispute">A fare or surge-price difference</option>
                <option value="damage">A damage charge (human approval required)</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Disputed amount (SGD)</span>
              <input
                name="disputed"
                className="input"
                inputMode="decimal"
                value={trip.disputed}
                onChange={(event) => setTripField('disputed', event.target.value)}
                placeholder="5.00"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Governing policy</span>
              <select name="policyVersion" className="input" key={category} defaultValue={category === 'fare_dispute' ? 'ryde-hackathon-policy-v2.1' : 'rydr-demo-policy-v1'}>
                <option value="ryde-hackathon-policy-v2.1">Supplied hackathon policy v2.1 · effective January 2026</option>
                <option value="rydr-demo-policy-v1">Rydr demo rules (original examples)</option>
                <option value="ryde-on-demand-no-show-20261002">Ryde public policy · on-demand no-show</option>
                <option value="ryde-advance-no-show-20261002">Ryde public policy · advance no-show</option>
                <option value="ryde-fixed-fare-20261002">Ryde public policy · fixed fare (review required)</option>
                <option value="ryde-cleaning-20261002">Ryde public policy · cleaning claim (review required)</option>
              </select>
              <Link href="/policies" className="small">Check applicability and sources →</Link>
            </label>
            <label className="field"><span className="field__label">Booking type</span><select name="bookingType" className="input"><option value="unknown">Not established</option><option value="on_demand">On-demand</option><option value="advance">Advance booking</option></select></label>
            <label className="field"><span className="field__label">Fare type</span><select name="fareType" className="input"><option value="unknown">Not established</option><option value="fixed">Fixed quoted fare</option><option value="metered">Metered / RydeTAXI</option></select></label>
          </div>
          <label className="field" style={{ marginTop: '0.75rem' }}>
            <span className="field__label">Rider statement</span>
            <textarea
              name="riderStatement"
              className="input"
              rows={2}
              value={trip.riderStatement}
              onChange={(event) => setTripField('riderStatement', event.target.value)}
              placeholder="What happened, in the rider's words. Recorded as a claim, never as evidence."
              required
            />
          </label>
          <label className="field" style={{ marginTop: '0.5rem' }}>
            <span className="field__label">Driver statement (optional)</span>
            <textarea
              name="driverStatement"
              className="input"
              rows={2}
              value={trip.driverStatement}
              onChange={(event) => setTripField('driverStatement', event.target.value)}
            />
          </label>
        </section>

        <section className="card">
          <div className="card__title">
            <h2>2. The trip</h2>
          </div>
          <p className="small muted" style={{ margin: '0 0 0.6rem' }}>
            Pickup coordinates are required: the demo policy measures driver presence against a 50 m
            radius around that point. {SINGAPORE_HINT}
          </p>
          <div className="intake-grid">
            <label className="field">
              <span className="field__label">Trip reference</span>
              <input
                name="tripId"
                className="input"
                value={trip.tripId}
                onChange={(event) => setTripField('tripId', event.target.value)}
                placeholder="Leave blank to derive from the case"
              />
            </label>
            <label className="field">
              <span className="field__label">Scheduled pickup</span>
              <input
                type="datetime-local"
                name="scheduledAt"
                className="input"
                value={trip.scheduledAt}
                onChange={(event) => setTripField('scheduledAt', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Pickup label</span>
              <input
                name="pickupLabel"
                className="input"
                value={trip.pickupLabel}
                onChange={(event) => setTripField('pickupLabel', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Pickup latitude</span>
              <input
                name="pickupLat"
                className="input"
                value={trip.pickupLat}
                onChange={(event) => setTripField('pickupLat', event.target.value)}
                placeholder="1.283400"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Pickup longitude</span>
              <input
                name="pickupLng"
                className="input"
                value={trip.pickupLng}
                onChange={(event) => setTripField('pickupLng', event.target.value)}
                placeholder="103.860700"
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Dropoff label (optional)</span>
              <input
                name="dropoffLabel"
                className="input"
                value={trip.dropoffLabel}
                onChange={(event) => setTripField('dropoffLabel', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Dropoff latitude (optional)</span>
              <input
                name="dropoffLat"
                className="input"
                value={trip.dropoffLat}
                onChange={(event) => setTripField('dropoffLat', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Dropoff longitude (optional)</span>
              <input
                name="dropoffLng"
                className="input"
                value={trip.dropoffLng}
                onChange={(event) => setTripField('dropoffLng', event.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="card">
          <div className="card__title">
            <h2>3. Evidence</h2>
            <span className="small muted">Leave a row blank to skip it</span>
          </div>

          <EvidenceBlock
            title="GPS samples"
            hint="Recorded driver positions. An unknown accuracy radius is stored as unknown, and the pickup zone stays indeterminate."
            rows={gps}
            setRows={setGps}
            empty={EMPTY_GPS}
            render={(row, index, update) => (
              <>
                <input name={`gps${index}_id`} className="input" placeholder="ID" value={row.id} onChange={(e) => update({ id: e.target.value })} />
                <input type="datetime-local" name={`gps${index}_at`} className="input" value={row.at} onChange={(e) => update({ at: e.target.value })} />
                <input name={`gps${index}_lat`} className="input" placeholder="Lat" value={row.lat} onChange={(e) => update({ lat: e.target.value })} />
                <input name={`gps${index}_lng`} className="input" placeholder="Lng" value={row.lng} onChange={(e) => update({ lng: e.target.value })} />
                <input name={`gps${index}_accuracy`} className="input" placeholder="Accuracy m" value={row.accuracy} onChange={(e) => update({ accuracy: e.target.value })} />
                <input name={`gps${index}_speed`} className="input" placeholder="Speed" value={row.speed} onChange={(e) => update({ speed: e.target.value })} />
                <select name={`gps${index}_status`} className="input" value={row.status} onChange={(e) => update({ status: e.target.value })}>
                  <option value="arrived">arrived</option>
                  <option value="waiting">waiting</option>
                  <option value="en_route">en route</option>
                  <option value="cancelled">cancelled</option>
                  <option value="unknown">unknown</option>
                </select>
              </>
            )}
          />

          <EvidenceBlock
            title="Trip events"
            hint="Arrival, timer start and the cancellation fee are what the no-show arithmetic is built from."
            rows={events}
            setRows={setEvents}
            empty={EMPTY_EVENT}
            render={(row, index, update) => (
              <>
                <input name={`event${index}_id`} className="input" placeholder="ID" value={row.id} onChange={(e) => update({ id: e.target.value })} />
                <input type="datetime-local" name={`event${index}_at`} className="input" value={row.at} onChange={(e) => update({ at: e.target.value })} />
                <input name={`event${index}_type`} className="input" placeholder="driver_arrived" value={row.type} onChange={(e) => update({ type: e.target.value })} />
                <input name={`event${index}_details`} className="input" placeholder="Details" value={row.details} onChange={(e) => update({ details: e.target.value })} />
              </>
            )}
          />

          <EvidenceBlock
            title="Contact attempts"
            hint="A sent notification proves attempted notification, not receipt. It never establishes that the rider was absent."
            rows={contacts}
            setRows={setContacts}
            empty={EMPTY_CONTACT}
            render={(row, index, update) => (
              <>
                <input name={`contact${index}_id`} className="input" placeholder="ID" value={row.id} onChange={(e) => update({ id: e.target.value })} />
                <input type="datetime-local" name={`contact${index}_at`} className="input" value={row.at} onChange={(e) => update({ at: e.target.value })} />
                <select name={`contact${index}_sender`} className="input" value={row.sender} onChange={(e) => update({ sender: e.target.value })}>
                  <option value="driver">driver</option>
                  <option value="rider">rider</option>
                  <option value="system">system</option>
                </select>
                <select name={`contact${index}_direction`} className="input" value={row.direction} onChange={(e) => update({ direction: e.target.value })}>
                  <option value="outgoing">outgoing</option>
                  <option value="incoming">incoming</option>
                </select>
                <select name={`contact${index}_answered`} className="input" value={row.answered} onChange={(e) => update({ answered: e.target.value })}>
                  <option value="no">not answered</option>
                  <option value="yes">answered</option>
                  <option value="">unknown</option>
                </select>
                <input name={`contact${index}_ring`} className="input" placeholder="Ring s" value={row.ring} onChange={(e) => update({ ring: e.target.value })} />
                <input name={`contact${index}_content`} className="input" placeholder="What was logged" value={row.content} onChange={(e) => update({ content: e.target.value })} />
              </>
            )}
          />

          {category === 'route_overcharge' ? (
            <EvidenceBlock
              title="Route comparison"
              hint="Supplied road-path distances in metres. Only enter these when you actually have them; a missing value stays missing rather than being estimated."
              rows={routes}
              setRows={setRoutes}
              empty={EMPTY_ROUTE}
              render={(row, index, update) => (
                <>
                  <input name={`route${index}_id`} className="input" placeholder="ID" value={row.id} onChange={(e) => update({ id: e.target.value })} />
                  <input name={`route${index}_planned`} className="input" placeholder="Planned m" value={row.planned} onChange={(e) => update({ planned: e.target.value })} />
                  <input name={`route${index}_actual`} className="input" placeholder="Actual m" value={row.actual} onChange={(e) => update({ actual: e.target.value })} />
                  <input name={`route${index}_segment`} className="input" placeholder="GPS sum m" value={row.segment} onChange={(e) => update({ segment: e.target.value })} />
                  <select name={`route${index}_justification`} className="input" value={row.justification} onChange={(e) => update({ justification: e.target.value })}>
                    <option value="unknown">unknown</option>
                    <option value="verified_justification">verified justification</option>
                    <option value="verified_no_justification">verified no justification</option>
                  </select>
                  <input name={`route${index}_note`} className="input" placeholder="Justification note" value={row.note} onChange={(e) => update({ note: e.target.value })} />
                </>
              )}
            />
          ) : null}

          {category === 'fare_dispute' ? <fieldset className="stack"><legend>Quote and surge comparison</legend><p className="small">Enter source-record values. The quote and final-fare ledger lines are created from these amounts; do not add those two lines again below.</p><div className="intake-grid">{[['surge_quote','Upfront quote (SGD)'],['surge_actual','Final charge (SGD)'],['surge_subtotal','Surgeable subtotal (SGD)'],['surge_fixed','Fixed surge-exempt fees (SGD)'],['surge_quote_multiplier','Multiplier at quote'],['surge_start_multiplier','Multiplier at pickup']].map(([name,label])=><label className="field" key={name}><span className="field__label">{label}</span><input className="input" name={name} type="number" min="0" step="0.01" required/></label>)}</div><div className="intake-grid">{[['surge_notified','Notified before pickup?'],['surge_complete_notice','Notice included fare, multiplier and free cancellation?'],['surge_unchanged','Non-surge components unchanged?']].map(([name,label])=><label className="field" key={name}><span className="field__label">{label}</span><select className="input" name={name} defaultValue="unknown"><option value="unknown">Unknown</option><option value="yes">Yes, supported by source record</option><option value="no">No, supported by source record</option></select></label>)}</div></fieldset> : null}
          <EvidenceBlock
            title="Fare components"
            hint="The fare ledger the charge is built from. A charge with no reconciling components cannot be upheld."
            rows={fares}
            setRows={setFares}
            empty={EMPTY_FARE}
            render={(row, index, update) => (
              <>
                <input name={`fare${index}_id`} className="input" placeholder="ID" value={row.id} onChange={(e) => update({ id: e.target.value })} />
                <input name={`fare${index}_component`} className="input" placeholder="Component" value={row.component} onChange={(e) => update({ component: e.target.value })} />
                <input name={`fare${index}_amount`} className="input" inputMode="decimal" placeholder="SGD" value={row.amount} onChange={(e) => update({ amount: e.target.value })} />
                <select name={`fare${index}_direction`} className="input" value={row.direction} onChange={(e) => update({ direction: e.target.value })}>
                  <option value="charge">charge</option>
                  <option value="refund">refund</option>
                </select>
                <input name={`fare${index}_method`} className="input" placeholder="Method" value={row.method} onChange={(e) => update({ method: e.target.value })} />
              </>
            )}
          />
        </section>

        <div className="row">
          <button type="submit" className="btn btn--primary">
            File this dispute
          </button>
          <span className="small muted">
            Filing records the case only. A review is started from the case page, so no model call is
            made until you ask for one.
          </span>
        </div>
      </form>

      <section className="card">
        <div className="card__title">
          <h2>Scripted imports</h2>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          A raw payload endpoint still exists at <span className="mono">POST /api/cases/intake</span>{' '}
          for automated imports. It validates against the same schema and also assigns the version
          number itself.
        </p>
      </section>

      <p className="small muted">
        <Link href="/">← Back to overview</Link>
      </p>
    </main>
  );
}

/** A titled, addable and removable block of evidence rows. */
function EvidenceBlock<T>({
  title,
  hint,
  rows,
  setRows,
  empty,
  render,
}: {
  title: string;
  hint: string;
  rows: T[];
  setRows: Dispatch<SetStateAction<T[]>>;
  empty: T;
  render: (row: T, index: number, update: (patch: Partial<T>) => void) => ReactNode;
}) {
  const update = (index: number, patch: Partial<T>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="intake-block">
      <div className="card__title">
        <h3>{title}</h3>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setRows((current) => [...current, { ...empty }])}
        >
          Add row
        </button>
      </div>
      <p className="small muted" style={{ margin: '0 0 0.5rem' }}>
        {hint}
      </p>
      {rows.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          No rows. Add one if you have this evidence.
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div className="intake-row" key={index}>
          {render(row, index, (patch) => update(index, patch))}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

