import type { CaseRecord, PolicyPack, PolicyThresholds } from '@/domain/contracts';
import type { DeterministicEvaluation } from '@/domain/policy';
import { plotZoneSamples, projectZonePoint } from '@/domain/caseVisual';
import type { ZoneClass } from '@/domain/geo';
import { findTripEvent, hasUnverifiedClaim } from '@/domain/evidence';
import { Cite } from './Cite';

/**
 * Case-specific visuals.
 *
 * These are drawn from the case's own numbers, not from stock art. Where the
 * numbers needed to draw something are absent, the visual says so and falls back
 * to the static schematic rather than inventing geometry. Nothing here is a map:
 * there is no base map, no road network and no interpolated path. Positions are
 * plotted at their measured distance and true bearing from the pickup point, and
 * the caption says exactly that.
 */

const ZONE_TONE: Record<ZoneClass, string> = {
  inside: 'var(--teal)',
  outside: 'var(--amber)',
  indeterminate: 'var(--ink-soft)',
};

const ZONE_LABEL: Record<ZoneClass, string> = {
  inside: 'Inside zone',
  outside: 'Outside zone',
  indeterminate: 'Indeterminate',
};

interface Props {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  pack: PolicyPack;
}

export function CaseVisual({ caseRecord, evaluation, pack }: Props) {
  if (caseRecord.category === 'fare_dispute') {
    const fare = evaluation.fare;
    if (!fare) return <div className="notice">Quote and surge records are missing. No fare comparison is inferred.</div>;
    return <figure className="card" aria-label="Fare and surge comparison"><p className="eyebrow">Same ride · changed price</p><h2>Where did the difference come from?</h2><div className="grid grid--2"><div><p>Upfront quote · {fare.quoteMultiplier}×</p><strong className="amount">S${(fare.quotedCents / 100).toFixed(2)}</strong></div><div><p>Charged fare · {fare.startMultiplier}×</p><strong className="amount">S${(fare.chargedCents / 100).toFixed(2)}</strong></div></div><p><strong>Surge difference: S${((fare.differentialCents ?? 0) / 100).toFixed(2)}</strong> · fixed fee S${(fare.fixedFeeCents / 100).toFixed(2)} stays outside surge.</p><p className="small">Notification: {fare.notified === null ? 'unknown' : fare.notified ? 'sent' : 'not sent in the supplied pricing log'}. Source totals {fare.reconciled ? 'reconcile' : 'need verification'}. This comparison is evidence, not a payment receipt.</p></figure>;
  }
  if (caseRecord.category === 'damage') return <div className="notice">Compare the submitted views below, request a verified before/after record, and refer liability to a reviewer. No route geometry applies to this damage case.</div>;
  const thresholds = pack.source !== 'supplied_sample' ? pack.thresholds : null;

  if (caseRecord.category === 'no_show_charge') {
    return (
      <div className="case-visual">
        <NoShowZone caseRecord={caseRecord} evaluation={evaluation} thresholds={thresholds} />
        <NoShowClock caseRecord={caseRecord} evaluation={evaluation} thresholds={thresholds} />
      </div>
    );
  }

  return (
    <div className="case-visual">
      <RouteComparison caseRecord={caseRecord} evaluation={evaluation} thresholds={thresholds} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  No-show: pickup zone                                               */
/* ------------------------------------------------------------------ */

const ZONE_W = 440;
const ZONE_H = 268;
const ZONE_CX = ZONE_W / 2;
const ZONE_CY = ZONE_H / 2 + 4;
/** Half-extent of the plotted area in px. Everything is scaled to fit inside. */
const ZONE_HALF = 100;

function NoShowZone({
  caseRecord,
  evaluation,
  thresholds,
}: {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  thresholds: PolicyThresholds | null;
}) {
  const radius = thresholds?.pickupRadiusMeters ?? null;
  const pickup = caseRecord.trip.pickup;

  // Only the samples the engine actually classifies: stationary ones.
  const stationary = caseRecord.evidence.filter(
    (item): item is Extract<typeof item, { kind: 'gps' }> =>
      item.kind === 'gps' && ['arrived', 'waiting', 'cancelled'].includes(item.payload.status),
  );

  if (radius === null || stationary.length === 0) {
    return (
      <figure className="case-visual__figure">
        <VisualHead label="Pickup zone" note="Not drawn" />
        <img
          className="sequence-schematic__art"
          src="/diagrams/sequence-no-show.jpg"
          alt="Three stages joined in sequence: arrival, an uncertain wait, then cancellation."
        />
        <p className="case-visual__note">
          {radius === null
            ? 'The governing policy pack does not state a pickup radius, so Rydr does not invent one. Zone presence stays unmeasured.'
            : `No stationary driver GPS samples are recorded, so pickup-zone presence cannot be plotted against the ${radius} m radius. The determination is “indeterminate”.`}
        </p>
      </figure>
    );
  }

  const plot = plotZoneSamples(
    pickup,
    stationary.map((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      status: item.payload.status,
      lat: item.payload.lat,
      lng: item.payload.lng,
      accuracyMeters: item.payload.accuracyMeters,
    })),
    radius,
  );

  // Scale so the radius and the worst sample (plus its accuracy radius) both fit.
  const pxPerMeter = ZONE_HALF / (plot.spanMeters * 1.12);
  const radiusPx = radius * pxPerMeter;

  // The headline determination is the engine's, never re-derived for the picture.
  const zoneSummary = evaluation.noShow?.arrivalZone ?? null;

  // Samples carrying an accuracy claim nobody has verified. The drawing uses the
  // recorded measurement regardless, and says so, so the picture cannot be read
  // as endorsing a claim the policy has not accepted.
  const unverifiedClaims = stationary
    .filter((item) => hasUnverifiedClaim(item, 'gps_accuracy_meters'))
    .map((item) => item.id);

  return (
    <figure className="case-visual__figure">
      <VisualHead label="Pickup zone" note={`${radius} m radius`} />
      <svg
        className="case-visual__svg"
        viewBox={`0 0 ${ZONE_W} ${ZONE_H}`}
        role="img"
        aria-label={`Pickup-zone schematic. The vehicle's stationary samples are plotted against a ${radius} metre radius around the pickup point. Worst sample sits ${Math.round(plot.spanMeters)} metres out; the recorded determination is ${zoneSummary ?? 'unrecorded'}.`}
      >
        <defs>
          <radialGradient id="zone-fill" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--teal-soft)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--teal-soft)" stopOpacity="0.12" />
          </radialGradient>
        </defs>

        {/* Plotted area background */}
        <rect
          x={ZONE_CX - ZONE_HALF - 10}
          y={ZONE_CY - ZONE_HALF - 10}
          width={(ZONE_HALF + 10) * 2}
          height={(ZONE_HALF + 10) * 2}
          rx="6"
          fill="var(--paper)"
          stroke="var(--line)"
        />

        {/* Crosshair through the pickup point */}
        <line
          x1={ZONE_CX - ZONE_HALF}
          y1={ZONE_CY}
          x2={ZONE_CX + ZONE_HALF}
          y2={ZONE_CY}
          stroke="var(--line)"
          strokeDasharray="2 4"
        />
        <line
          x1={ZONE_CX}
          y1={ZONE_CY - ZONE_HALF}
          x2={ZONE_CX}
          y2={ZONE_CY + ZONE_HALF}
          stroke="var(--line)"
          strokeDasharray="2 4"
        />

        {/* The governing radius */}
        <circle cx={ZONE_CX} cy={ZONE_CY} r={radiusPx} fill="url(#zone-fill)" />
        <circle
          cx={ZONE_CX}
          cy={ZONE_CY}
          r={radiusPx}
          fill="none"
          stroke="var(--teal)"
          strokeWidth="1.5"
        />

        {/* Scale reference: half the radius */}
        <line
          x1={ZONE_CX}
          y1={ZONE_CY - radiusPx}
          x2={ZONE_CX + radiusPx}
          y2={ZONE_CY - radiusPx}
          stroke="var(--teal)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        <text
          x={ZONE_CX + radiusPx / 2}
          y={ZONE_CY - radiusPx - 5}
          textAnchor="middle"
          className="case-visual__svg-label"
        >
          {radius} m
        </text>

        {/* Each stationary sample, with its own accuracy radius */}
        {plot.samples.map((point) => {
          const { x, y } = projectZonePoint(point, pxPerMeter, ZONE_CX, ZONE_CY);
          const accuracyPx = (point.accuracy ?? 0) * pxPerMeter;
          const tone = ZONE_TONE[point.zone];
          return (
            <g key={point.id}>
              {accuracyPx > 0.5 ? (
                <circle cx={x} cy={y} r={accuracyPx} fill={tone} fillOpacity="0.14" stroke={tone} strokeOpacity="0.5" strokeWidth="1" />
              ) : null}
              <circle cx={x} cy={y} r="4.5" fill={tone} />
            </g>
          );
        })}

        {/* Pickup pin, drawn last so it sits on top */}
        <g>
          <circle cx={ZONE_CX} cy={ZONE_CY} r="6.5" fill="var(--ink)" />
          <circle cx={ZONE_CX} cy={ZONE_CY} r="2.5" fill="var(--white-warm)" />
        </g>
        <text x={ZONE_CX} y={ZONE_CY + 22} textAnchor="middle" className="case-visual__svg-label case-visual__svg-label--strong">
          Pickup
        </text>

        <text x={12} y={20} className="case-visual__svg-label case-visual__svg-label--north">
          N ↑
        </text>
        <text x={ZONE_W - 12} y={ZONE_H - 10} textAnchor="end" className="case-visual__svg-label">
          {pickup.label}
        </text>
      </svg>

      <ul className="case-visual__legend">
        {plot.samples.map((point) => (
          <li key={point.id} className="case-visual__legend-item">
            <span className="case-visual__swatch" style={{ background: ZONE_TONE[point.zone] }} />
            <Cite kind="evidence" id={point.id} />
            <span className="small muted">
              {point.status} · {Math.round(point.distance)} m
              {point.accuracy !== null ? ` ±${point.accuracy} m` : ' · accuracy not reported'} ·{' '}
              {ZONE_LABEL[point.zone]}
            </span>
          </li>
        ))}
      </ul>

      {unverifiedClaims.length > 0 ? (
        <p className="case-visual__note case-visual__note--warn">
          {unverifiedClaims.length === 1 ? 'One of these samples carries' : `${unverifiedClaims.length} of these samples carry`}{' '}
          a party-supplied accuracy claim that nobody has verified ({unverifiedClaims.join(', ')}).
          The drawing uses the recorded accuracy, not the claim — so the zone above is the one the
          policy can actually justify, not the one the claim would produce.
        </p>
      ) : null}

      <p className="case-visual__note">
        Schematic, not a map. There is no base map or road geometry here — each sample is plotted at
        its measured distance and bearing from the pickup point, with its reported accuracy radius
        drawn around it. A sample is “inside” only when distance + accuracy fits within {radius} m,
        and “outside” only when distance − accuracy exceeds it.
      </p>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/*  No-show: wait clock                                                */
/* ------------------------------------------------------------------ */

const CLOCK_W = 440;
const CLOCK_H = 132;
const CLOCK_PAD = 26;

function NoShowClock({
  caseRecord,
  evaluation,
  thresholds,
}: {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  thresholds: PolicyThresholds | null;
}) {
  const ns = evaluation.noShow;
  if (!ns) return null;

  const arrival = findTripEvent(caseRecord.evidence, 'driver_arrived');
  const timerStart = findTripEvent(caseRecord.evidence, 'wait_timer_started');

  const thresholdAt =
    thresholds && ns.effectiveStartAt
      ? new Date(Date.parse(ns.effectiveStartAt) + thresholds.noShowThresholdSeconds * 1000).toISOString()
      : null;

  const marks = [
    { key: 'scheduled', short: 'Scheduled', label: 'Scheduled pickup', at: caseRecord.trip.scheduledAt, tone: 'var(--ink-soft)' },
    { key: 'arrived', short: 'Arrived', label: 'Driver arrived', at: arrival?.timestamp ?? null, tone: 'var(--teal)' },
    { key: 'timer', short: 'Timer', label: 'Wait timer started', at: timerStart?.timestamp ?? null, tone: 'var(--teal)' },
    { key: 'start', short: 'Start', label: 'Effective wait start', at: ns.effectiveStartAt, tone: 'var(--ink)' },
    { key: 'threshold', short: 'Threshold', label: `No-show threshold (+${thresholds?.noShowThresholdSeconds ?? '?'} s)`, at: thresholdAt, tone: 'var(--amber)' },
    { key: 'cancel', short: 'Cancelled', label: 'Cancellation', at: ns.cancellationAt, tone: 'var(--amber)' },
  ].filter((mark): mark is typeof mark & { at: string } => mark.at !== null);

  if (marks.length < 2) {
    return (
      <figure className="case-visual__figure">
        <VisualHead label="Wait clock" note="Not drawn" />
        <p className="case-visual__note">
          Fewer than two timestamps are recorded for this case, so the wait timeline cannot be
          drawn. Elapsed time is treated as unmeasured, not as zero.
        </p>
      </figure>
    );
  }

  const times = marks.map((mark) => Date.parse(mark.at));
  const min = Math.min(...times);
  const max = Math.max(...times);
  const spread = max - min || 1;
  const inner = CLOCK_W - CLOCK_PAD * 2;
  const x = (t: number) => CLOCK_PAD + ((t - min) / spread) * inner;

  const clears = ns.elapsedSeconds !== null && thresholds
    ? ns.elapsedSeconds >= thresholds.noShowThresholdSeconds
    : null;

  // Two label rows, alternating, so adjacent marks do not overprint.
  const axisY = 62;

  return (
    <figure className="case-visual__figure">
      <VisualHead label="Wait clock" note="Elapsed vs threshold" />
      <svg
        className="case-visual__svg"
        viewBox={`0 0 ${CLOCK_W} ${CLOCK_H}`}
        role="img"
        aria-label={
          clears === null
            ? 'Wait timeline. Elapsed time could not be computed because a start or cancellation timestamp is missing.'
            : `Wait timeline. ${ns.elapsedSeconds} seconds elapsed from the effective wait start to cancellation, ${clears ? 'at or above' : 'below'} the ${thresholds?.noShowThresholdSeconds} second no-show threshold.`
        }
      >
        {/* Elapsed span, when it can be computed */}
        {ns.effectiveStartAt && ns.cancellationAt ? (
          <rect
            x={x(Date.parse(ns.effectiveStartAt))}
            y={axisY - 5}
            width={Math.max(1, x(Date.parse(ns.cancellationAt)) - x(Date.parse(ns.effectiveStartAt)))}
            height="10"
            rx="3"
            fill={clears ? 'var(--amber-soft)' : 'var(--teal-soft)'}
          />
        ) : null}

        {/* Axis */}
        <line x1={CLOCK_PAD} y1={axisY} x2={CLOCK_W - CLOCK_PAD} y2={axisY} stroke="var(--line)" strokeWidth="1.5" />

        {marks.map((mark, index) => {
          const px = x(Date.parse(mark.at));
          const above = index % 2 === 0;
          const labelY = above ? axisY - 16 : axisY + 24;
          const tickTop = above ? axisY - 10 : axisY;
          const tickBottom = above ? axisY : axisY + 10;
          return (
            <g key={mark.key}>
              <line x1={px} y1={tickTop} x2={px} y2={tickBottom} stroke={mark.tone} strokeWidth="2" />
              <circle cx={px} cy={axisY} r="3.5" fill={mark.tone} />
              <text
                x={px}
                y={labelY}
                textAnchor={px < 40 ? 'start' : px > CLOCK_W - 40 ? 'end' : 'middle'}
                className="case-visual__svg-label case-visual__svg-label--strong"
                fill={mark.tone}
              >
                {mark.short}
              </text>
            </g>
          );
        })}
      </svg>

      <dl className="case-visual__clock">
        <div>
          <dt>Elapsed to cancellation</dt>
          <dd>
            {ns.elapsedSeconds === null
              ? 'not computable'
              : `${Math.round(ns.elapsedSeconds)} s${clears === null ? '' : clears ? ' — at or above threshold' : ' — below threshold'}`}
          </dd>
        </div>
        <div>
          <dt>From earliest candidate start</dt>
          <dd>
            {ns.elapsedUnderEarliestSeconds === null
              ? 'not computable'
              : `${Math.round(ns.elapsedUnderEarliestSeconds)} s`}
          </dd>
        </div>
        <div>
          <dt>Longest stationary gap</dt>
          <dd>
            {ns.maxGapSeconds === null ? 'no stationary samples' : `${Math.round(ns.maxGapSeconds)} s`}
            {ns.continuityOk ? ' — continuous' : ' — breaks continuity'}
          </dd>
        </div>
        <div>
          <dt>Contact attempts</dt>
          <dd>{ns.contactAttempts}</dd>
        </div>
      </dl>

      {ns.materialStartConflict ? (
        <p className="case-visual__note case-visual__note--warn">
          The supplied policy is ambiguous about which clock governs the wait, and the choice changes
          whether the threshold is met. That conflict is why this case cannot be decided
          automatically.
        </p>
      ) : ns.policyAmbiguity ? (
        <p className="case-visual__note">
          The supplied policy does not settle which clock governs the wait, though here the choice
          does not change the outcome.
        </p>
      ) : null}
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/*  Route: planned vs actual                                           */
/* ------------------------------------------------------------------ */

function RouteComparison({
  caseRecord,
  evaluation,
  thresholds,
}: {
  caseRecord: CaseRecord;
  evaluation: DeterministicEvaluation;
  thresholds: PolicyThresholds | null;
}) {
  const comparison = evaluation.route?.comparison;
  const routeItems = caseRecord.evidence.filter((item) => item.kind === 'route');

  if (!comparison || !comparison.measurable || comparison.plannedDistanceM === null || comparison.actualDistanceM === null) {
    return (
      <figure className="case-visual__figure">
        <VisualHead label="Route length" note="Not drawn" />
        <img
          className="sequence-schematic__art"
          src="/diagrams/sequence-route.jpg"
          alt="Two lines drawn between the same two points: a smooth planned route and a longer wandering actual route."
        />
        <p className="case-visual__note">
          {comparison
            ? 'Planned or actual route length is missing, so the deviation cannot be measured. The excess is treated as unknown, not as zero.'
            : 'No route record is attached to this case.'}
        </p>
      </figure>
    );
  }

  const planned = comparison.plannedDistanceM;
  const actual = comparison.actualDistanceM;
  const longest = Math.max(planned, actual, 1);

  const bars = [
    { key: 'planned', label: 'Planned', meters: planned, tone: 'var(--teal)' },
    { key: 'actual', label: 'Actual', meters: actual, tone: comparison.deviationFlagged ? 'var(--amber)' : 'var(--ink)' },
  ];

  return (
    <figure className="case-visual__figure">
      <VisualHead
        label="Route length"
        note={comparison.deviationFlagged ? 'Deviation flagged' : 'Within threshold'}
      />

      <div className="case-visual__bars">
        {bars.map((bar) => (
          <div key={bar.key} className="case-visual__bar-row">
            <span className="case-visual__bar-label">{bar.label}</span>
            <span className="case-visual__bar">
              <span
                className="case-visual__bar-fill"
                style={{ width: `${(bar.meters / longest) * 100}%`, background: bar.tone }}
              />
            </span>
            <span className="case-visual__bar-value">{bar.meters} m</span>
          </div>
        ))}

        {comparison.excessMeters !== null ? (
          <div className="case-visual__bar-row case-visual__bar-row--excess">
            <span className="case-visual__bar-label">Excess</span>
            <span className="case-visual__bar">
              <span
                className="case-visual__bar-fill"
                style={{
                  width: `${(Math.abs(comparison.excessMeters) / longest) * 100}%`,
                  background: comparison.deviationFlagged ? 'var(--amber)' : 'var(--ink-soft)',
                }}
              />
            </span>
            <span className="case-visual__bar-value">
              {comparison.excessMeters > 0 ? '+' : ''}
              {comparison.excessMeters} m
              {comparison.excessPercent !== null ? ` (${comparison.excessPercent.toFixed(1)}%)` : ''}
            </span>
          </div>
        ) : null}
      </div>

      {thresholds ? (
        thresholds.referenceRules ? <p className="case-visual__note">The supplied policy flags excess distance over 1,000 m, without a percentage condition. Above {thresholds.referenceRules.routeAutoMaxMeters} m, a reviewer decides. Source fare totals {evaluation.route?.ledgerReconciled ? 'are consistent' : 'need verification'}; a full itemized ledger is not inferred. {evaluation.route?.eligibleRefundCents != null ? `Calculated refund eligibility: S$${(evaluation.route.eligibleRefundCents / 100).toFixed(2)}. This is not a posted award.` : ''}</p> :
        <p className="case-visual__note">
          A deviation is flagged only when it exceeds both {thresholds.routeExcessMeters} m and{' '}
          {thresholds.routeExcessPercent}% of the planned distance. Justification status:{' '}
          <strong>{evaluation.route?.justification.replace(/_/g, ' ')}</strong>. Fare ledger{' '}
          {evaluation.route?.ledgerReconciled ? 'reconciles' : 'does not reconcile'}
          {evaluation.route && !evaluation.route.ledgerReconciled
            ? ` (out by ${evaluation.route.ledgerDifferenceCents} cents)`
            : ''}
          .
        </p>
      ) : null}

      {routeItems.length > 0 ? (
        <ul className="case-visual__legend">
          {routeItems.map((item) => (
            <li key={item.id} className="case-visual__legend-item">
              <span className="case-visual__swatch" style={{ background: 'var(--teal)' }} />
              <Cite kind="evidence" id={item.id} />
              <span className="small muted">
                {item.kind === 'route' ? item.payload.justification : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="case-visual__note">
        Bar lengths are the recorded distances, drawn to scale against the longer of the two. No
        road geometry or travelled path is represented.
      </p>
    </figure>
  );
}

/* ------------------------------------------------------------------ */

function VisualHead({ label, note }: { label: string; note: string }) {
  return (
    <figcaption className="case-visual__head">
      <span className="case-visual__label">{label}</span>
      <span className="badge badge--neutral">{note}</span>
    </figcaption>
  );
}

