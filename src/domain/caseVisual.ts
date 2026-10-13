import { classifyZone, haversineMeters, type ZoneClass } from './geo';

/**
 * Geometry for the pickup-zone visual.
 *
 * Kept out of the component so the honesty of the picture can be tested: the
 * plotted distance is always the engine's own haversine measurement and the
 * classification is always the engine's own `classifyZone`, so the diagram
 * cannot drift from the determination it illustrates.
 */

export interface ZoneSampleInput {
  id: string;
  timestamp: string | null;
  status: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
}

export interface PlottedZoneSample {
  id: string;
  timestamp: string | null;
  status: string;
  accuracy: number | null;
  /** Metres from the pickup point, by haversine. Never a pixel estimate. */
  distance: number;
  /** Local east/north offsets in metres, used only to pick a bearing. */
  east: number;
  north: number;
  zone: ZoneClass;
}

export interface ZonePlot {
  samples: PlottedZoneSample[];
  /**
   * Worst-case extent that must fit on screen: the furthest sample plus its
   * accuracy radius, floored at the zone radius so the zone is always drawn.
   */
  spanMeters: number;
  radiusMeters: number;
}

export function plotZoneSamples(
  pickup: { lat: number; lng: number },
  samples: ZoneSampleInput[],
  radiusMeters: number,
): ZonePlot {
  const lngScale = 111_320 * Math.cos((pickup.lat * Math.PI) / 180);

  const plotted = samples.map((sample) => {
    const distance = haversineMeters(pickup, { lat: sample.lat, lng: sample.lng });
    return {
      id: sample.id,
      timestamp: sample.timestamp,
      status: sample.status,
      accuracy: sample.accuracyMeters,
      distance,
      east: (sample.lng - pickup.lng) * lngScale,
      north: (sample.lat - pickup.lat) * 111_320,
      zone: classifyZone(distance, sample.accuracyMeters, radiusMeters),
    };
  });

  const spanMeters = plotted.reduce(
    (acc, point) => Math.max(acc, point.distance + (point.accuracy ?? 0)),
    radiusMeters,
  );

  return { samples: plotted, spanMeters, radiusMeters };
}

/**
 * Places a sample on the canvas at exactly its measured distance, on its true
 * bearing. The offset only supplies the direction, so the drawn radius can never
 * disagree with the reported distance even where the local projection is coarse.
 */
export function projectZonePoint(
  point: Pick<PlottedZoneSample, 'east' | 'north' | 'distance'>,
  pxPerMeter: number,
  centreX: number,
  centreY: number,
): { x: number; y: number } {
  const norm = Math.hypot(point.east, point.north) || 1;
  return {
    x: centreX + (point.east / norm) * point.distance * pxPerMeter,
    y: centreY - (point.north / norm) * point.distance * pxPerMeter,
  };
}
