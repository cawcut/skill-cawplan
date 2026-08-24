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

export const INLINE_HUMAN_INPUT_HELPERS = `function humanInputContent(input) {
      if (typeof input === 'string') return input;
      return input && (input.content || input.raw_block || input.topic || '');
    }

    function truncateHumanInput(input) {
      const text = String(input || '');
      return text.length > 200 ? text.slice(0, 200) + '...' : text;
    }

    function humanInputsForSession(report, session) {
      const allInputs = Array.isArray(report.human_inputs) ? report.human_inputs : [];
      const sessionId = String(session.session_id || '');
      return allInputs.filter((input) => String(input && input.session_id || '') === sessionId);
    }`;

export const INLINE_HUMAN_INPUTS_HTML = `function humanInputsHtml(report, session) {
      const inputs = humanInputsForSession(report, session)
        .filter((input) => humanInputContent(input))
        .slice(0, 3);
      if (inputs.length === 0) return '<span class="muted">No human inputs</span>';
      return '<ol class="human-inputs">' + inputs.map((input) => {
        const text = escapeHtml(truncateHumanInput(humanInputContent(input)));
        return '<li>' + text + '</li>';
      }).join('') + '</ol>';
    }`;
