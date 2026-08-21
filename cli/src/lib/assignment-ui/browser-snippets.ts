/**
 * Exact browser inline function bodies for assignment confirmation pages.
 * Kept as string constants so generated HTML stays byte-stable; parity with
 * assignment-ui/*.ts implementations is enforced by unit tests.
 */
export const INLINE_ESCAPE_HTML = `function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }`;

export const INLINE_TICKET_DISPLAY_ID_FROM_INPUT = `function ticketDisplayIdFromInput(value) {
      const trimmed = String(value || '').trim();
      const urlMatch = /https?:\\/\\/[^\\s/]+\\/issue\\/([A-Za-z]+-\\d+)/i.exec(trimmed);
      if (urlMatch && urlMatch[1]) return urlMatch[1].toUpperCase();
      const displayMatch = /^[A-Za-z][A-Za-z0-9]+-\\d+$/.exec(trimmed);
      return displayMatch ? trimmed.toUpperCase() : '';
    }`;

export const INLINE_TICKET_DETAIL_URL = `function ticketDetailUrl(ticket) {
      return CAWPLAN_PORTAL_BASE + '/issue/' + encodeURIComponent(ticket);
    }`;
