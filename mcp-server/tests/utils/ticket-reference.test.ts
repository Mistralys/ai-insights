import { describe, it, expect } from 'vitest';
import { normaliseReference, ticketLabel, ticketUrl, isSafeTicketBaseUrl } from '../../src/utils/ticket-reference.js';

const MSG = 'Reference must be a number (4578) or QUEUE-number (ABC-12).';

describe('normaliseReference', () => {
  it('handles empty, digits and queue refs', () => {
    expect(normaliseReference('  ', 'ABC')).toEqual({ ok: true, value: null });
    expect(normaliseReference(' 45 78 ', 'ABC')).toEqual({ ok: true, value: '4578' });
    expect(normaliseReference('xyz-12', 'ABC')).toEqual({ ok: true, value: 'XYZ-12' });
  });
  it('strips the configured queue case-insensitively', () => {
    expect(normaliseReference('abc-12', 'ABC')).toEqual({ ok: true, value: '12' });
    expect(normaliseReference('abc-12', 'ABC-')).toEqual({ ok: true, value: '12' });
    expect(normaliseReference('abc-12', '')).toEqual({ ok: true, value: 'ABC-12' });
  });
  it('rejects anything else', () => {
    for (const bad of ['abc', '12-ab', '-12', 'a b-', '#12']) {
      expect(normaliseReference(bad, 'ABC')).toEqual({ ok: false, message: MSG });
    }
  });
});

describe('ticketLabel / ticketUrl', () => {
  it('labels', () => {
    expect(ticketLabel('12', 'ABC')).toBe('ABC-12');
    expect(ticketLabel('12', 'ABC-')).toBe('ABC-12');
    expect(ticketLabel('12', '')).toBe('12');
    expect(ticketLabel('XYZ-3', 'ABC')).toBe('XYZ-3');
    expect(ticketLabel(null, 'ABC')).toBe('');
  });
  it('urls', () => {
    const s = { ticket_base_url: 'https://t.example/browse/', ticket_queue: 'ABC' };
    expect(ticketUrl('12', s)).toBe('https://t.example/browse/ABC-12');
    expect(ticketUrl(null, s)).toBeNull();
    expect(ticketUrl('12', { ...s, ticket_base_url: '' })).toBeNull();
    expect(ticketUrl('12', { ...s, ticket_base_url: 'javascript:alert(1)//' })).toBeNull();
  });
  it('isSafeTicketBaseUrl', () => {
    expect(isSafeTicketBaseUrl('http://a.b/')).toBe(true);
    expect(isSafeTicketBaseUrl('https://a.b/')).toBe(true);
    expect(isSafeTicketBaseUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeTicketBaseUrl('ftp://a.b/')).toBe(false);
    expect(isSafeTicketBaseUrl('nonsense')).toBe(false);
  });
});
