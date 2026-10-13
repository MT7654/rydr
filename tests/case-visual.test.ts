import { describe, expect, it } from 'vitest';
import { plotZoneSamples, projectZonePoint, type ZoneSampleInput } from '../src/domain/caseVisual';
import { haversineMeters } from '../src/domain/geo';

/**
 * The pickup-zone picture is an illustration of a determination, so the one
 * thing that must never happen is the picture disagreeing with the engine. These
 * tests pin the two ways that could happen: a distance derived from the drawing
 * projection rather than from haversine, and a classification invented in the
 * component instead of delegated to `classifyZone`.
 */

const PICKUP = { lat: 1.2848, lng: 103.8382 };
const RADIUS = 50;

function sample(overrides: Partial<ZoneSampleInput> = {}): ZoneSampleInput {
  return {
    id: 'SYN-GPS-01',
    timestamp: '2026-09-17T09:12:00+08:00',
    status: 'arrived',
    lat: PICKUP.lat,
    lng: PICKUP.lng,
    accuracyMeters: 8,
    ...overrides,
  };
}

/** Roughly `meters` north of the pickup point. */
function northOf(meters: number) {
  return { lat: PICKUP.lat + meters / 111_320, lng: PICKUP.lng };
}

describe('plotZoneSamples', () => {
  it('measures distance by haversine, not by the drawing projection', () => {
    const far = northOf(400);
    const plot = plotZoneSamples(PICKUP, [sample({ ...far })], RADIUS);

    expect(plot.samples[0]!.distance).toBeCloseTo(haversineMeters(PICKUP, far), 9);
  });

  it('classifies through the engine: a sample sitting on the pickup point is inside', () => {
    const plot = plotZoneSamples(PICKUP, [sample()], RADIUS);
    expect(plot.samples[0]!.zone).toBe('inside');
  });

  it('classifies through the engine: a sample well beyond the radius is outside', () => {
    const plot = plotZoneSamples(PICKUP, [sample({ ...northOf(400) })], RADIUS);
    expect(plot.samples[0]!.zone).toBe('outside');
  });

  it('keeps a sample indeterminate when the two circles straddle the boundary', () => {
    // 60 m out with a 40 m accuracy radius: distance - accuracy (20) is inside,
    // distance + accuracy (100) is outside, so nothing can be concluded.
    const plot = plotZoneSamples(PICKUP, [sample({ ...northOf(60), accuracyMeters: 40 })], RADIUS);
    expect(plot.samples[0]!.zone).toBe('indeterminate');
  });

  it('keeps a sample indeterminate when no accuracy radius was reported', () => {
    const plot = plotZoneSamples(PICKUP, [sample({ accuracyMeters: null })], RADIUS);
    expect(plot.samples[0]!.zone).toBe('indeterminate');
  });

  it('always leaves room for the zone itself, even with every sample at the pin', () => {
    const plot = plotZoneSamples(PICKUP, [sample(), sample({ id: 'SYN-GPS-02' })], RADIUS);
    expect(plot.spanMeters).toBe(RADIUS);
  });

  it('extends the view to the worst sample plus its own accuracy radius', () => {
    const plot = plotZoneSamples(PICKUP, [sample({ ...northOf(200), accuracyMeters: 30 })], RADIUS);

    const worst = plot.samples[0]!;
    expect(plot.spanMeters).toBeCloseTo(worst.distance + 30, 6);
    expect(plot.spanMeters).toBeGreaterThan(RADIUS);
  });

  it('reports every sample it was given, in order', () => {
    const plot = plotZoneSamples(
      PICKUP,
      [
        sample({ id: 'A' }),
        sample({ id: 'B', ...northOf(20) }),
        sample({ id: 'C', ...northOf(30) }),
      ],
      RADIUS,
    );
    expect(plot.samples.map((point) => point.id)).toEqual(['A', 'B', 'C']);
  });
});

describe('projectZonePoint', () => {
  it('places a point at exactly its measured distance from the centre', () => {
    const plot = plotZoneSamples(PICKUP, [sample({ ...northOf(400) })], RADIUS);
    const point = plot.samples[0]!;
    const pxPerMeter = 0.25;

    const { x, y } = projectZonePoint(point, pxPerMeter, 220, 134);
    const drawnRadius = Math.hypot(x - 220, y - 134);

    expect(drawnRadius).toBeCloseTo(point.distance * pxPerMeter, 6);
  });

  it('draws north upwards', () => {
    const plot = plotZoneSamples(PICKUP, [sample({ ...northOf(100) })], RADIUS);
    const { y } = projectZonePoint(plot.samples[0]!, 1, 220, 134);
    expect(y).toBeLessThan(134);
  });

  it('survives a sample recorded at the pickup point without producing NaN', () => {
    const plot = plotZoneSamples(PICKUP, [sample()], RADIUS);
    const { x, y } = projectZonePoint(plot.samples[0]!, 1, 220, 134);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
    expect(x).toBeCloseTo(220, 6);
    expect(y).toBeCloseTo(134, 6);
  });
});
