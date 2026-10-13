/**
 * Geospatial helpers.
 *
 * These are engineering approximations over supplied coordinates, not verified
 * geographic facts. Imported coordinates are never independently geocoded, and
 * no result here implies live traffic or road routing.
 */

export type ZoneClass = 'inside' | 'outside' | 'indeterminate';

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Conservative zone test from product spec section 7:
 *   inside         if d + accuracy <= radius
 *   outside        if d - accuracy >  radius
 *   indeterminate  otherwise
 *
 * A missing accuracy radius makes the determination indeterminate. This is an
 * engineering rule, not a statistical guarantee of location accuracy.
 */
export function classifyZone(
  distanceMeters: number,
  accuracyMeters: number | null,
  radiusMeters: number,
): ZoneClass {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters)) {
    return 'indeterminate';
  }
  if (distanceMeters + accuracyMeters <= radiusMeters) return 'inside';
  if (distanceMeters - accuracyMeters > radiusMeters) return 'outside';
  return 'indeterminate';
}

export interface StationarySample {
  timestamp: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  status: string;
}

const STATIONARY_STATUSES = new Set(['arrived', 'waiting', 'cancelled']);

/**
 * Largest gap between consecutive stationary samples, in seconds.
 * Returns null when there are fewer than two stationary samples.
 */
export function maxStationaryGapSeconds(samples: StationarySample[]): number | null {
  const stationary = samples
    .filter((s) => STATIONARY_STATUSES.has(s.status) && s.timestamp !== null)
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (stationary.length < 2) return null;
  let max = 0;
  for (let i = 1; i < stationary.length; i += 1) {
    const gap =
      (Date.parse(stationary[i]!.timestamp) -
        Date.parse(stationary[i - 1]!.timestamp)) /
      1000;
    if (gap > max) max = gap;
  }
  return Math.round(max);
}

/**
 * True when a stationary sample is determinately outside the pickup radius.
 * An off-zone observation contradicts an arrival claim.
 */
export function hasContraryOffZoneSample(
  samples: StationarySample[],
  pickup: { lat: number; lng: number },
  radiusMeters: number,
): boolean {
  return samples.some((sample) => {
    if (!STATIONARY_STATUSES.has(sample.status)) return false;
    const d = haversineMeters(pickup, sample);
    return classifyZone(d, sample.accuracyMeters, radiusMeters) === 'outside';
  });
}
