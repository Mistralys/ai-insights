/**
 * Ticket reference rules. Pure functions, no I/O.
 *
 * A reference is either a bare number (`4578`, shown with the configured
 * queue) or a full `QUEUE-number` (`ABC-12`).
 */

export type NormaliseReferenceResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export const REFERENCE_ERROR_MESSAGE = 'Reference must be a number (4578) or QUEUE-number (ABC-12).';

const QUEUE_REF = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;

/** Strip a trailing `-` from a configured queue (`ABC-` and `ABC` are equivalent). */
function queueName(queue: string): string {
  return queue.trim().replace(/-$/, '');
}

/**
 * Normalise raw reference input. Empty gives `null`; digits are kept;
 * `queue-digits` is uppercased, and reduced to the number alone when the
 * queue equals the configured one (case-insensitive, non-empty queue).
 */
export function normaliseReference(raw: string, queue: string): NormaliseReferenceResult {
  const text = raw.replace(/\s+/g, '');
  if (text === '') return { ok: true, value: null };
  if (/^\d+$/.test(text)) return { ok: true, value: text };
  const match = QUEUE_REF.exec(text);
  const matchQueue = match?.[1] ?? '';
  const matchNumber = match?.[2] ?? '';
  if (!match) return { ok: false, message: REFERENCE_ERROR_MESSAGE };
  const configured = queueName(queue);
  if (configured !== '' && matchQueue.toUpperCase() === configured.toUpperCase()) {
    return { ok: true, value: matchNumber };
  }
  return { ok: true, value: `${matchQueue.toUpperCase()}-${matchNumber}` };
}

/** Display label: queue + ref for numeric refs, the ref as typed otherwise, `''` for none. */
export function ticketLabel(ref: string | null | undefined, queue: string): string {
  if (ref === null || ref === undefined || ref === '') return '';
  if (/^\d+$/.test(ref)) {
    const configured = queueName(queue);
    return configured === '' ? ref : `${configured}-${ref}`;
  }
  return ref;
}

/** True for a valid absolute `http:` or `https:` URL. */
export function isSafeTicketBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Ticket URL: `null` unless the base URL is a valid http(s) URL; otherwise base + label. */
export function ticketUrl(
  ref: string | null | undefined,
  settings: { ticket_base_url: string; ticket_queue: string },
): string | null {
  const label = ticketLabel(ref, settings.ticket_queue);
  if (label === '') return null;
  if (!isSafeTicketBaseUrl(settings.ticket_base_url)) return null;
  return settings.ticket_base_url + label;
}
