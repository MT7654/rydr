import { z } from 'zod';
import {
  CaseRecordSchema,
  type CaseRecord,
  type EvidenceItem,
} from './contracts';

/**
 * Adapter for the supplied sample `reference/DISP-002.source.json`.
 *
 * Contract (product spec sections 2, 11 and source-review section 3):
 *  - the raw file is never modified
 *  - every evidence item keeps a stable ID and its original JSON pointer
 *  - missing fields (GPS accuracy, driver statement) stay missing
 *  - the advertised expected ruling and any source commentary are NOT carried
 *    into the case record, so they can never reach a runtime prompt
 */

const RawSourceSchema = z.object({
  dispute_ticket: z.object({
    dispute_id: z.string(),
    trip_id: z.string(),
    filed_by: z.string(),
    dispute_type: z.string(),
    description: z.string(),
  }),
  rider_profile: z.object({
    rider_id: z.string(),
    avg_rating: z.number().nullable(),
    total_trips: z.number().nullable(),
    dispute_history: z
      .object({ total_disputes: z.number().nullable() })
      .partial()
      .optional(),
    fraud_flags: z.number().nullable(),
    fraud_flag_details: z.string().nullable(),
  }),
  driver_profile: z.object({
    driver_id: z.string(),
    avg_rating: z.number().nullable(),
    total_trips: z.number().nullable(),
    dispute_history: z
      .object({ total_disputes: z.number().nullable() })
      .partial()
      .optional(),
    fraud_flags: z.number().nullable(),
  }),
  trip_data: z.object({
    trip_id: z.string(),
    pickup_location: z.object({
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
    }),
    dropoff_location: z
      .object({ name: z.string(), lat: z.number(), lng: z.number() })
      .nullable()
      .optional(),
    scheduled_time: z.string(),
    cancellation_fee: z.number(),
  }),
  gps_telemetry: z.array(
    z.object({
      timestamp: z.string(),
      lat: z.number(),
      lng: z.number(),
      speed_kmh: z.number().nullable(),
      status: z.string(),
    }),
  ),
  chat_logs: z.array(
    z.object({
      timestamp: z.string(),
      sender: z.string(),
      type: z.string(),
      content: z.string(),
    }),
  ),
  app_events: z.array(
    z.object({ timestamp: z.string(), event_type: z.string(), details: z.string() }),
  ),
  cancellation_policy: z.record(z.string(), z.unknown()).optional(),
});

export type RawDisp002 = z.infer<typeof RawSourceSchema>;

const DATASET = 'reference/DISP-002.source.json';

const GPS_ISSUE =
  'Reported accuracy radius is absent in the source, so an automatic pickup-zone determination is not possible.';
const CONTACT_ISSUE =
  'All recorded contact attempts are driver-initiated and no rider response appears in the supplied log. That supports a lack of observed response, not rider absence.';

function gpsStatus(value: string): 'en_route' | 'arrived' | 'waiting' | 'cancelled' | 'unknown' {
  switch (value) {
    case 'en_route':
    case 'arrived':
    case 'waiting':
    case 'cancelled':
      return value;
    default:
      return 'unknown';
  }
}

export function buildDisp002Case(raw: unknown): CaseRecord {
  const source = RawSourceSchema.parse(raw);
  const evidence: EvidenceItem[] = [];

  source.gps_telemetry.forEach((sample, index) => {
    evidence.push({
      id: `DISP002-GPS-${String(index + 1).padStart(2, '0')}`,
      kind: 'gps',
      timestamp: sample.timestamp,
      source: {
        dataset: DATASET,
        jsonPointer: `/gps_telemetry/${index}`,
        provenance: 'supplied_sample',
      },
      payload: {
        lat: sample.lat,
        lng: sample.lng,
        // The source contains no accuracy measurement. Not invented here.
        accuracyMeters: null,
        speedKmh: sample.speed_kmh,
        status: gpsStatus(sample.status),
      },
      qualityIssues: [GPS_ISSUE],
    });
  });

  let chatSeq = 0;
  let callSeq = 0;
  source.chat_logs.forEach((entry, index) => {
    const pointer = `/chat_logs/${index}`;
    if (entry.type === 'call') {
      callSeq += 1;
      const ringMatch = /rang (\d+)s/.exec(entry.content);
      evidence.push({
        id: `DISP002-CALL-${String(callSeq).padStart(2, '0')}`,
        kind: 'call',
        timestamp: entry.timestamp,
        source: { dataset: DATASET, jsonPointer: pointer, provenance: 'supplied_sample' },
        payload: {
          sender: entry.sender === 'rider' ? 'rider' : entry.sender === 'driver' ? 'driver' : 'system',
          direction: 'outgoing',
          answered: /not answered|no answer/i.test(entry.content) ? false : null,
          ringSeconds: ringMatch ? Number(ringMatch[1]) : null,
          content: entry.content,
        },
        qualityIssues: [CONTACT_ISSUE],
      });
      return;
    }
    if (entry.type === 'system') {
      evidence.push({
        id: `DISP002-EVT-LOG-${String(index + 1).padStart(2, '0')}`,
        kind: 'trip_event',
        timestamp: entry.timestamp,
        source: { dataset: DATASET, jsonPointer: pointer, provenance: 'supplied_sample' },
        payload: { eventType: 'chat_system_notice', details: entry.content },
        qualityIssues: [],
      });
      return;
    }
    chatSeq += 1;
    evidence.push({
      id: `DISP002-CHAT-${String(chatSeq).padStart(2, '0')}`,
      kind: 'chat',
      timestamp: entry.timestamp,
      source: { dataset: DATASET, jsonPointer: pointer, provenance: 'supplied_sample' },
      payload: {
        sender: entry.sender === 'rider' ? 'rider' : entry.sender === 'driver' ? 'driver' : 'system',
        type: 'message',
        content: entry.content,
      },
      qualityIssues: [CONTACT_ISSUE],
    });
  });

  const eventIssues: Record<string, string> = {
    driver_arrived:
      "Arrival is asserted from a GPS-derived 'within 10m' claim; the source contains no accuracy measurement to verify it.",
    wait_timer_started:
      'Timer start differs from the recorded arrival time and precedes the scheduled pickup time. The source does not state which clock governs.',
    wait_timer_expired:
      'Event timestamp is 08:48:10 while the event text states the free wait period ends at 08:48.',
    cancellation_fee_applied:
      'Cancellation occurs 6 minutes after scheduled pickup and 7m50s after the recorded timer start, which straddles the 8 minute no-show threshold.',
  };

  source.app_events.forEach((event, index) => {
    evidence.push({
      id: `DISP002-EVT-${String(index + 1).padStart(2, '0')}`,
      kind: 'trip_event',
      timestamp: event.timestamp,
      source: {
        dataset: DATASET,
        jsonPointer: `/app_events/${index}`,
        provenance: 'supplied_sample',
      },
      payload: { eventType: event.event_type, details: event.details },
      qualityIssues: eventIssues[event.event_type] ? [eventIssues[event.event_type]!] : [],
    });
  });

  evidence.push({
    id: 'DISP002-PAY-01',
    kind: 'payment',
    timestamp: source.app_events.find((e) => e.event_type === 'cancellation_fee_applied')
      ?.timestamp ?? null,
    source: {
      dataset: DATASET,
      jsonPointer: '/trip_data/cancellation_fee',
      provenance: 'supplied_sample',
    },
    payload: {
      component: 'cancellation_fee',
      amountCents: Math.round(source.trip_data.cancellation_fee * 100),
      direction: 'charge',
      method: 'e-wallet',
      status: 'applied',
    },
    qualityIssues: [],
  });

  evidence.push({
    id: 'DISP002-HIST-RIDER',
    kind: 'history',
    timestamp: null,
    source: {
      dataset: DATASET,
      jsonPointer: '/rider_profile',
      provenance: 'supplied_sample',
    },
    payload: {
      subject: 'rider',
      avgRating: source.rider_profile.avg_rating,
      totalTrips: source.rider_profile.total_trips,
      disputeCount: source.rider_profile.dispute_history?.total_disputes ?? null,
      fraudFlags: source.rider_profile.fraud_flags,
      note: source.rider_profile.fraud_flag_details,
    },
    qualityIssues: [
      'History is review-routing context only. It cannot establish liability or outweigh trip-specific evidence.',
    ],
  });

  evidence.push({
    id: 'DISP002-HIST-DRIVER',
    kind: 'history',
    timestamp: null,
    source: {
      dataset: DATASET,
      jsonPointer: '/driver_profile',
      provenance: 'supplied_sample',
    },
    payload: {
      subject: 'driver',
      avgRating: source.driver_profile.avg_rating,
      totalTrips: source.driver_profile.total_trips,
      disputeCount: source.driver_profile.dispute_history?.total_disputes ?? null,
      fraudFlags: source.driver_profile.fraud_flags,
      note: null,
    },
    qualityIssues: [
      'History is review-routing context only. It cannot establish liability or outweigh trip-specific evidence.',
    ],
  });

  const record: CaseRecord = {
    id: source.dispute_ticket.dispute_id,
    version: 1,
    category: 'no_show_charge',
    currency: 'SGD',
    disputedCents: Math.round(source.trip_data.cancellation_fee * 100),
    riderStatement: source.dispute_ticket.description,
    // No driver statement field exists in the source. None is invented.
    driverStatement: null,
    trip: {
      id: source.trip_data.trip_id,
      scheduledAt: source.trip_data.scheduled_time,
      pickup: {
        lat: source.trip_data.pickup_location.lat,
        lng: source.trip_data.pickup_location.lng,
        label: source.trip_data.pickup_location.name,
      },
      dropoff: source.trip_data.dropoff_location
        ? {
            lat: source.trip_data.dropoff_location.lat,
            lng: source.trip_data.dropoff_location.lng,
            label: source.trip_data.dropoff_location.name,
          }
        : null,
    },
    evidence,
    policyVersion: 'rydr-demo-policy-v1',
    suppliedPolicyId: 'supplied-sample-policy',
    provenance: 'supplied_sample',
    derivedFrom: null,
    changeLog: [],
  };

  return CaseRecordSchema.parse(record);
}
