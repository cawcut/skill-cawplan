import type {QaSessionData} from "../collect/qa-types.js";
import type {QaExcludedSession} from "../collect/aggregators/qa-daily.js";
import type {QaAssignmentBootstrap} from "./types.js";
import {escapeHtml, normalizePortalBase} from "../assignment-ui/format.js";
import {resolveSessionTitle} from "../assignment-ui/session-display.js";
import {humanInputsHtml} from "../assignment-ui/human-input-preview.js";
import {ticketDetailUrl} from "../assignment-ui/ticket-url.js";
import {
    INLINE_ESCAPE_HTML,
    INLINE_HUMAN_INPUT_HELPERS,
    INLINE_HUMAN_INPUTS_HTML,
    INLINE_TICKET_DETAIL_URL,
    INLINE_TICKET_DISPLAY_ID_FROM_INPUT,
} from "../assignment-ui/browser-snippets.js";

export interface QaAssignmentHtmlOptions {
    portalBase?: string;
    /** Embed report data for offline preview/tests instead of fetching at runtime. */
    bootstrap?: QaAssignmentBootstrap;
    /**
     * Read-only table preview: session list only, no product controls or action buttons.
     * Used to verify the static table segment independently.
     */
    readonlyPreview?: boolean;
}

function sessionTicketDisplayIds(session: QaSessionData): string[] {
    return [...new Set((session.ticket_display_ids ?? []).filter(Boolean).map(String))];
}

/** Mirrors coding assignment-html sessionDateTimeText; reads display_time_range only. */
export function sessionDateTimeText(session: QaSessionData): string {
    const range = session.display_time_range;
    const start = range?.start;
    if (start) {
        const d = new Date(start);
        if (!Number.isNaN(d.getTime())) {
            return d.toLocaleDateString("en-US", {month: "short", day: "numeric"}) + ", " +
                d.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"});
        }
    }
    const display = range?.display?.trim();
    if (display) return display;
    return "—";
}

/** Server-side row HTML for tests and readonly preview. */
export function renderQaSessionRowHtml(
    session: QaSessionData,
    products: QaAssignmentBootstrap["products"],
    opts: {
        interactive?: boolean;
        daily?: {human_inputs?: unknown[]};
        portalBase?: string;
        allTicketDisplayIds?: string[];
    } = {},
): string {
    const interactive = opts.interactive ?? false;
    const title = resolveSessionTitle(session, "qa");
    const report = {human_inputs: opts.daily?.human_inputs ?? []};
    const reqCount = (session.requirement_ids ?? []).length;
    const tpAdded = session.testpoint?.added ?? 0;
    const productCell = interactive
        ? productInputHtml(session, products)
        : `<span class="product-readonly">${escapeHtml(session.product_id ?? "—")}</span>`;

    return `<tr data-session-id="${escapeHtml(session.session_id)}">` +
        `<td class="sid-cell"><code>${escapeHtml(session.session_id)}</code></td>` +
        `<td class="title-cell">${escapeHtml(title)}</td>` +
        `<td class="input-cell">${humanInputsHtml(report, session)}</td>` +
        `<td class="agent-cell">${escapeHtml(session.agent || "—")}</td>` +
        `<td class="num-cell">${tpAdded}</td>` +
        `<td class="product-cell">${productCell}</td>` +
        (interactive
            ? `<td class="tickets-cell">${ticketPickerHtmlServer(
                session,
                opts.portalBase ?? "https://app.cawplan.com",
                opts.allTicketDisplayIds,
            )}</td>`
            : "") +
        `<td class="num-cell">${reqCount}</td>` +
        `<td class="dt-cell">${escapeHtml(sessionDateTimeText(session))}</td>` +
        `</tr>`;
}

function productInputHtml(
    session: QaSessionData,
    products: QaAssignmentBootstrap["products"],
): string {
    const currentProduct = products.find((product) => product.product_id === session.product_id);
    const productValue = currentProduct?.product_name ?? session.product_id ?? "";
    return `<input class="product" list="product-list" value="${escapeHtml(productValue)}" placeholder="Search product" aria-label="Product for session" />` +
        `<div class="product-error field-error"></div>`;
}

function ticketPickerHtmlServer(
    session: QaSessionData,
    portalBase: string,
    allTicketDisplayIds: string[] = [],
): string {
    const selected = new Set(sessionTicketDisplayIds(session).map((item) => item.trim().toUpperCase()).filter(Boolean));
    const options = [...new Set([...allTicketDisplayIds, ...selected])].sort();
    const optionRows = options.length === 0
        ? `<div class="ticket-empty">No tickets yet</div>`
        : options.map((ticket) =>
            `<div class="ticket-option">` +
            `<label class="ticket-option-choice">` +
            `<input class="ticket-option-cb" type="checkbox" value="${escapeHtml(ticket)}"${selected.has(ticket) ? " checked" : ""} />` +
            `<span class="ticket-option-label">${escapeHtml(ticket)}</span>` +
            `</label>` +
            `<a class="ticket-link ticket-open-link" href="${escapeHtml(ticketDetailUrl(portalBase, ticket))}" target="_blank" rel="noopener noreferrer">Open</a>` +
            `</div>`,
        ).join("");
    const tickets = sessionTicketDisplayIds(session);
    const tagsHtml = tickets.length === 0
        ? `<span class="ticket-placeholder">Select tickets</span>`
        : tickets.map((ticket) =>
            `<span class="ticket-tag" data-ticket="${escapeHtml(ticket)}">` +
            `<a class="ticket-link" href="${escapeHtml(ticketDetailUrl(portalBase, ticket))}" target="_blank" rel="noopener noreferrer">${escapeHtml(ticket)}</a>` +
            `<button class="ticket-remove" type="button" data-ticket="${escapeHtml(ticket)}" aria-label="Remove ${escapeHtml(ticket)}">×</button>` +
            `</span>`,
        ).join("");
    return `<div class="ticket-picker">` +
        `<div class="ticket-trigger" role="button" tabindex="0">${tagsHtml}</div>` +
        `<div class="ticket-menu hidden">` +
        `<div class="ticket-options">${optionRows}</div>` +
        `<input class="ticket-add" placeholder="Add ticket ID" />` +
        `</div>` +
        `</div>`;
}

/** Server-side supplement candidate list for tests. */
export function renderExcludedSessionCandidatesHtml(excluded: QaExcludedSession[]): string {
    if (excluded.length === 0) {
        return `<p class="muted">No commit-only or empty sessions to supplement.</p>`;
    }
    return `<ul class="supplement-list">${excluded.map((entry) => {
        const title = entry.title ?? "untitled";
        return `<li class="supplement-item" data-session-id="${escapeHtml(entry.session_id)}">` +
            `<div class="supplement-meta">` +
            `<code>${escapeHtml(entry.session_id)}</code>` +
            `<span class="supplement-agent">${escapeHtml(entry.agent)}</span>` +
            `<span class="supplement-title">${escapeHtml(title)}</span>` +
            `<span class="supplement-reason">${escapeHtml(entry.reason)}</span>` +
            `</div>` +
            `<button type="button" class="supplement-add" data-session-id="${escapeHtml(entry.session_id)}">Add session</button>` +
            `</li>`;
    }).join("")}</ul>`;
}

export function qaAssignmentHtml(opts: QaAssignmentHtmlOptions = {}): string {
    const portalBase = normalizePortalBase(opts.portalBase ?? "https://app.cawplan.com");
    const readonly = opts.readonlyPreview === true;
    const bootstrapJson = opts.bootstrap ? JSON.stringify(opts.bootstrap) : "";

    const allTicketDisplayIds = opts.bootstrap
        ? [...new Set(opts.bootstrap.daily.sessions
            .flatMap((session) => session.ticket_display_ids ?? [])
            .filter(Boolean)
            .map((item) => String(item).trim().toUpperCase()))].sort()
        : [];
    const preRenderedTable = opts.bootstrap
        ? `<tbody id="qa-rows">${opts.bootstrap.daily.sessions
            .map((session) => renderQaSessionRowHtml(
                session,
                opts.bootstrap!.products,
                {
                    interactive: !readonly,
                    daily: opts.bootstrap!.daily,
                    portalBase,
                    allTicketDisplayIds,
                },
            ))
            .join("")}</tbody>`
        : `<tbody id="qa-rows"><tr><td colspan="${readonly ? 8 : 9}" class="muted">Loading sessions...</td></tr></tbody>`;
    const productListOptions = opts.bootstrap
        ? opts.bootstrap.products.map((product) =>
            `<option value="${escapeHtml(product.product_name)}"></option>`,
        ).join("")
        : "";

    const ticketHeader = readonly ? "" : "<th>Tickets</th>";
    const colSpan = readonly ? 8 : 9;

    const supplementSection = readonly
        ? ""
        : `<section id="qa-supplement-panel" class="supplement-panel hidden">
            <h2 class="section-title">Add excluded sessions (optional)</h2>
            <p class="section-help">Optional: add sessions filtered out as commit-only or empty. You do not need to type a session ID manually.</p>
            <div id="qa-supplement-candidates"></div>
          </section>`;

    const actions = readonly
        ? ""
        : `<div class="actions">
            <span id="status" class="status">Loading...</span>
            <button id="close" type="button">Close</button>
            <button id="save" type="button">Save assignments</button>
          </div>`;

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CawPlan QA Session Assignment</title>
  <style>
    :root {
      --uBlue-01: hsl(214,100%,95%);
      --uBlue-06: #006EFF;
      --uBlue-07: hsl(214,100%,40%);
      --n-02: rgb(246,246,248);
      --border-sub: rgb(238,239,241);
      --border: rgb(219,220,225);
      --text-00: rgba(0,0,0,1);
      --text-01: rgba(0,0,0,0.85);
      --text-02: rgba(0,0,0,0.65);
      --text-03: rgba(0,0,0,0.45);
      --bg: #fff;
      --bg-hover: rgb(246,246,248);
      --red-06: rgb(240,58,62);
      --green-07: rgb(46,163,80);
      --font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); font-size: 13px; line-height: 20px; color: var(--text-01); background: var(--bg); }
    .app { min-height: 100vh; display: flex; flex-direction: column; }
    .phdr { padding: 20px 32px 0; }
    .ptitle { font-size: 19px; font-weight: 600; color: var(--text-00); line-height: 28px; }
    .pbody { padding: 24px 32px 32px; display: flex; flex-direction: column; gap: 16px; }
    .table-card { border: 1px solid var(--border-sub); border-radius: 8px; overflow: hidden; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th { background: var(--bg); padding: 10px 12px; text-align: left; font-size: 12px; font-weight: 600; border-bottom: 1px solid var(--border-sub); white-space: nowrap; }
    th:last-child { text-align: right; }
    td { padding: 10px 12px; border-bottom: 1px solid var(--border-sub); vertical-align: top; word-break: break-word; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--bg-hover); }
    .sid-cell code { font-size: 11px; }
    .dt-cell { font-size: 12px; color: var(--text-02); white-space: nowrap; vertical-align: middle; text-align: right; }
    .input-cell { overflow: hidden; }
    .human-inputs { margin: 0; padding: 0; list-style: none; max-width: 100%; overflow: hidden; }
    .human-inputs li { font-size: 11px; color: var(--text-02); line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .human-inputs li + li { color: var(--text-03); margin-top: 2px; }
    input, select { font-family: var(--font); font-size: 13px; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text-01); outline: none; width: 100%; }
    input:focus, select:focus { border-color: var(--uBlue-06); box-shadow: 0 0 0 3px rgba(0,111,255,.12); }
    input::placeholder { color: var(--text-03); }
    button { font-family: var(--font); font-size: 13px; font-weight: 600; cursor: pointer; border: 0; background: transparent; }
    .product-cell, .tickets-cell { vertical-align: middle; }
    .tickets-cell { font-size: 12px; color: var(--text-02); overflow: visible; }
    .ticket-picker { position: relative; min-width: 180px; }
    .ticket-trigger { min-height: 32px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 26px 4px 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); cursor: pointer; position: relative; }
    .ticket-trigger::after { content: "▾"; position: absolute; right: 8px; top: 5px; color: var(--text-03); font-size: 12px; }
    .ticket-trigger:focus { border-color: var(--uBlue-06); box-shadow: 0 0 0 3px rgba(0,111,255,.12); outline: none; }
    .ticket-picker.disabled .ticket-trigger { background: var(--n-02); color: var(--text-03); cursor: not-allowed; }
    .ticket-picker.disabled .ticket-trigger::after { color: var(--text-03); }
    .ticket-picker.disabled .ticket-tag { background: var(--border-sub); color: var(--text-03); }
    .ticket-picker.disabled .ticket-remove { color: var(--text-03); cursor: not-allowed; }
    .ticket-tag { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--uBlue-01); color: var(--uBlue-07); font-size: 11px; font-weight: 600; }
    .ticket-link { color: inherit; text-decoration: none; }
    .ticket-link:hover { text-decoration: underline; }
    .ticket-remove { color: var(--uBlue-07); width: 14px; height: 14px; padding: 0; font-size: 12px; line-height: 14px; }
    .ticket-placeholder { color: var(--text-03); font-size: 12px; }
    .ticket-menu { position: absolute; z-index: 9999; top: calc(100% + 4px); left: 0; right: 0; min-width: 220px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); box-shadow: 0 4px 12px rgba(33,33,36,.04); pointer-events: auto; }
    .ticket-picker.drop-up .ticket-menu { top: auto; bottom: calc(100% + 4px); }
    .ticket-options { max-height: 144px; overflow: auto; display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .ticket-option { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; color: var(--text-01); cursor: pointer; }
    .ticket-option:hover { background: var(--bg-hover); }
    .ticket-option input { width: 14px; height: 14px; padding: 0; flex-shrink: 0; }
    .ticket-option-choice { min-width: 0; display: flex; align-items: center; gap: 6px; flex: 1; cursor: pointer; }
    .ticket-option-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ticket-open-link { margin-left: auto; color: var(--uBlue-07); font-weight: 600; font-size: 11px; }
    .ticket-empty { color: var(--text-03); font-size: 12px; padding: 4px 6px; }
    input.ticket-add { height: 28px; font-size: 12px; }
    tr.invalid-product input.product { border-color: var(--red-06); box-shadow: 0 0 0 3px rgba(240,58,62,.12); }
    .field-error { color: var(--red-06); font-size: 11px; margin-top: 4px; }
    .field-error:empty { display: none; }
    .section-title { font-size: 15px; font-weight: 600; margin-bottom: 6px; }
    .section-help { color: var(--text-02); margin-bottom: 10px; }
    ${readonly ? "" : `.supplement-panel { border: 1px solid var(--border-sub); border-radius: 8px; padding: 16px; }
    .supplement-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .supplement-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border: 1px solid var(--border-sub); border-radius: 6px; }
    .supplement-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-width: 0; }
    .supplement-meta code { font-size: 11px; }
    .supplement-agent, .supplement-reason { font-size: 12px; color: var(--text-02); }
    .supplement-title { font-weight: 500; }
    .supplement-add { height: 30px; padding: 0 12px; border: 1px solid var(--uBlue-06); background: var(--uBlue-01); color: var(--uBlue-07); border-radius: 4px; cursor: pointer; font: inherit; font-weight: 600; white-space: nowrap; }
    .supplement-add:disabled { opacity: .5; cursor: not-allowed; }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    #save { background: var(--uBlue-06); color: #fff; border: 1px solid var(--uBlue-06); height: 32px; padding: 0 14px; border-radius: 4px; cursor: pointer; font: inherit; font-weight: 600; }
    #close { background: var(--bg); color: var(--text-01); border: 1px solid var(--border); height: 32px; padding: 0 14px; border-radius: 4px; cursor: pointer; font: inherit; font-weight: 600; }`}
    .status { font-size: 13px; color: var(--text-03); margin-right: auto; }
    .status-error { color: var(--red-06); }
    .hidden { display: none !important; }
    .muted { color: var(--text-03); }
    @media (max-width: 900px) { .phdr, .pbody { padding-left: 16px; padding-right: 16px; } }
  </style>
</head>
<body>
  <div class="app">
    <div class="phdr"><div class="ptitle">CawPlan QA Session Assignment</div></div>
    <div class="pbody">
      <div class="table-card">
        ${readonly ? "" : `<datalist id="product-list">${productListOptions}</datalist>`}
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Title</th>
              <th>Input</th>
              <th>Agent</th>
              <th>Test points added</th>
              <th>Product</th>
              ${ticketHeader}
              <th>Requirements</th>
              <th>Date / Time</th>
            </tr>
          </thead>
          ${preRenderedTable}
        </table>
      </div>
      ${supplementSection}
      ${actions}
    </div>
  </div>
  ${bootstrapJson ? `<script type="application/json" id="qa-bootstrap">${bootstrapJson.replace(/</g, "\\u003c")}</script>` : ""}
  ${readonly ? "" : `<script type="module">
    const token = new URLSearchParams(location.search).get("token") || "";
    const CAWPLAN_PORTAL_BASE = ${JSON.stringify(portalBase)};

    const api = (path, options = {}) => fetch(path + "?token=" + encodeURIComponent(token), {
      ...options,
      headers: {"content-type": "application/json", ...(options.headers || {})},
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || res.statusText);
        err.response = data;
        throw err;
      }
      return data;
    });

    let daily = null;
    let products = [];
    let excludedSessions = [];
    let manuallyAddedIds = new Set();

    ${INLINE_ESCAPE_HTML}

    function resolveSessionTitle(session) {
      return session.session_title ?? session.session_id;
    }

    ${INLINE_HUMAN_INPUT_HELPERS}

    function normalizeProducts(items) {
      return items.map((p) => ({
        product_id: p.product_id || p.unique_id,
        product_name: p.product_name || p.name || p.product_id || p.unique_id,
        product_line_id: p.product_line_id || (p.product_line && (p.product_line.unique_id || p.product_line.id)),
      })).filter((p) => p.product_id && p.product_name);
    }

    function findProduct(value) {
      const needle = String(value || "").trim().toLowerCase();
      if (!needle) return null;
      return products.find((p) =>
        String(p.product_id).toLowerCase() === needle ||
        String(p.product_name).toLowerCase() === needle
      ) || null;
    }

    function findSession(sessionId) {
      return (daily.sessions || []).find((session) => session.session_id === sessionId);
    }

    function sessionTickets(session) {
      const displayIds = Array.isArray(session.ticket_display_ids) ? session.ticket_display_ids : [];
      return [...new Set(displayIds.filter(Boolean).map(String))];
    }

    function allTicketDisplayIds() {
      const sessions = Array.isArray(daily && daily.sessions) ? daily.sessions : [];
      const ids = sessions.flatMap((session) => Array.isArray(session.ticket_display_ids) ? session.ticket_display_ids : []);
      return [...new Set(ids.filter(Boolean).map((item) => String(item).trim().toUpperCase()).filter(Boolean))].sort();
    }

    ${INLINE_TICKET_DISPLAY_ID_FROM_INPUT}

    ${INLINE_TICKET_DETAIL_URL}

    function ticketLinkHtml(ticket) {
      return '<a class="ticket-link" href="' + escapeHtml(ticketDetailUrl(ticket)) + '" target="_blank" rel="noopener noreferrer" title="Open ' + escapeHtml(ticket) + '">' + escapeHtml(ticket) + '</a>';
    }

    function ticketOpenLinkHtml(ticket) {
      return '<a class="ticket-link ticket-open-link" href="' + escapeHtml(ticketDetailUrl(ticket)) + '" target="_blank" rel="noopener noreferrer" title="Open ' + escapeHtml(ticket) + '">Open</a>';
    }

    function ticketOptionRows(session) {
      const selected = new Set(sessionTickets(session).map((item) => String(item).trim().toUpperCase()).filter(Boolean));
      const options = [...new Set([...allTicketDisplayIds(), ...selected])].sort();
      if (options.length === 0) return '<div class="ticket-empty">No tickets yet</div>';
      return options.map((ticket) =>
        '<div class="ticket-option">' +
          '<label class="ticket-option-choice">' +
            '<input class="ticket-option-cb" type="checkbox" value="' + escapeHtml(ticket) + '"' + (selected.has(ticket) ? ' checked' : '') + ' />' +
            '<span class="ticket-option-label">' + escapeHtml(ticket) + '</span>' +
          '</label>' +
          ticketOpenLinkHtml(ticket) +
        '</div>'
      ).join('');
    }

    function ticketTagsHtml(session) {
      const tickets = sessionTickets(session);
      if (tickets.length === 0) return '<span class="ticket-placeholder">Select tickets</span>';
      return tickets.map((ticket) =>
        '<span class="ticket-tag" data-ticket="' + escapeHtml(ticket) + '">' +
          ticketLinkHtml(ticket) +
          '<button class="ticket-remove" type="button" data-ticket="' + escapeHtml(ticket) + '" aria-label="Remove ' + escapeHtml(ticket) + '">×</button>' +
        '</span>'
      ).join('');
    }

    function ticketPickerHtml(session) {
      return '<div class="ticket-picker">' +
        '<div class="ticket-trigger" role="button" tabindex="0">' + ticketTagsHtml(session) + '</div>' +
        '<div class="ticket-menu hidden">' +
          '<div class="ticket-options">' + ticketOptionRows(session) + '</div>' +
          '<input class="ticket-add" placeholder="Add ticket ID" />' +
        '</div>' +
      '</div>';
    }

    function productInputHtml(session) {
      const currentProduct = products.find((product) => product.product_id === session.product_id);
      const productValue = currentProduct ? currentProduct.product_name : (session.product_name || "");
      return '<input class="product" list="product-list" value="' + escapeHtml(productValue) + '" placeholder="Search product" aria-label="Product for session" />' +
        '<div class="product-error field-error"></div>';
    }

    ${INLINE_HUMAN_INPUTS_HTML}

    function sessionDateTimeText(session) {
      const range = session.display_time_range;
      const start = range && range.start;
      if (start) {
        const d = new Date(start);
        if (!Number.isNaN(d.getTime())) {
          return d.toLocaleDateString("en-US", {month: "short", day: "numeric"}) + ", " +
            d.toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"});
        }
      }
      const display = range && range.display ? String(range.display).trim() : "";
      if (display) return display;
      return "—";
    }

    function sessionRowHtml(session) {
      const title = resolveSessionTitle(session);
      const reqCount = (Array.isArray(session.requirement_ids) ? session.requirement_ids : []).length;
      const tpAdded = session.testpoint && typeof session.testpoint.added === "number" ? session.testpoint.added : 0;
      return '<tr data-session-id="' + escapeHtml(session.session_id) + '">' +
        '<td class="sid-cell"><code>' + escapeHtml(session.session_id) + '</code></td>' +
        '<td class="title-cell">' + escapeHtml(title) + '</td>' +
        '<td class="input-cell">' + humanInputsHtml(daily, session) + '</td>' +
        '<td class="agent-cell">' + escapeHtml(session.agent || "—") + '</td>' +
        '<td class="num-cell">' + tpAdded + '</td>' +
        '<td class="product-cell">' + productInputHtml(session) + '</td>' +
        '<td class="tickets-cell">' + ticketPickerHtml(session) + '</td>' +
        '<td class="num-cell">' + reqCount + '</td>' +
        '<td class="dt-cell">' + escapeHtml(sessionDateTimeText(session)) + '</td>' +
        '</tr>';
    }

    function renderProductList() {
      const productList = document.getElementById("product-list");
      if (!productList) return;
      productList.innerHTML = products.map((product) =>
        '<option value="' + escapeHtml(product.product_name) + '"></option>'
      ).join("");
    }

    function selectedTicketDisplayIds(picker) {
      if (!picker) return [];
      return [...new Set(Array.from(picker.querySelectorAll(".ticket-option-cb:checked") || [])
        .map((option) => String(option.value || "").trim().toUpperCase())
        .filter(Boolean))];
    }

    function renderTicketTags(picker) {
      const selected = selectedTicketDisplayIds(picker);
      const trigger = picker.querySelector(".ticket-trigger");
      trigger.innerHTML = selected.length
        ? selected.map((ticket) =>
          '<span class="ticket-tag" data-ticket="' + escapeHtml(ticket) + '">' +
            ticketLinkHtml(ticket) +
            '<button class="ticket-remove" type="button" data-ticket="' + escapeHtml(ticket) + '" aria-label="Remove ' + escapeHtml(ticket) + '">×</button>' +
          '</span>'
        ).join('')
        : '<span class="ticket-placeholder">Select tickets</span>';
    }

    function ensureTicketOption(picker, ticket, checked) {
      const existing = Array.from(picker.querySelectorAll(".ticket-option-cb") || []).find((option) => option.value === ticket);
      if (existing) {
        if (checked) existing.checked = true;
        return true;
      }
      const options = picker.querySelector(".ticket-options");
      const empty = options.querySelector(".ticket-empty");
      if (empty) empty.remove();
      const label = document.createElement("div");
      label.className = "ticket-option";
      label.innerHTML = '<label class="ticket-option-choice">' +
        '<input class="ticket-option-cb" type="checkbox" value="' + escapeHtml(ticket) + '"' + (checked ? ' checked' : '') + ' />' +
        '<span class="ticket-option-label">' + escapeHtml(ticket) + '</span>' +
        '</label>' +
        ticketOpenLinkHtml(ticket);
      options.appendChild(label);
      return true;
    }

    function addTicketOption(picker, value) {
      const ticket = ticketDisplayIdFromInput(value);
      if (!ticket) return false;
      document.querySelectorAll(".ticket-picker").forEach((candidate) => {
        ensureTicketOption(candidate, ticket, candidate === picker);
      });
      renderTicketTags(picker);
      return true;
    }

    function syncRowTickets(row) {
      if (!row) return;
      const session = findSession(row.dataset.sessionId);
      const picker = row.querySelector(".ticket-picker");
      if (session && picker) session.ticket_display_ids = selectedTicketDisplayIds(picker);
    }

    function addTicketFromRow(row) {
      if (!row) return;
      const input = row.querySelector(".ticket-add");
      const picker = row.querySelector(".ticket-picker");
      if (!input || !picker) return;
      if (picker.classList.contains("disabled")) return;
      if (addTicketOption(picker, input.value)) {
        input.value = "";
        syncRowTickets(row);
      }
    }

    function resetFloatingMenu(menu, scrollEl) {
      menu.style.position = "";
      menu.style.left = "";
      menu.style.right = "";
      menu.style.top = "";
      menu.style.bottom = "";
      menu.style.width = "";
      menu.style.maxHeight = "";
      if (scrollEl) scrollEl.style.maxHeight = "";
    }

    function setTicketMenuOpen(picker, open) {
      const menu = picker.querySelector(".ticket-menu");
      const options = picker.querySelector(".ticket-options");
      if (open) {
        setTimeout(() => picker.querySelector(".ticket-add")?.focus(), 0);
      } else {
        picker.classList.remove("drop-up");
        resetFloatingMenu(menu, options);
      }
      menu.classList.toggle("hidden", !open);
    }

    function closeAllMenus() {
      document.querySelectorAll(".ticket-picker").forEach((picker) => setTicketMenuOpen(picker, false));
    }

    function updateTicketPickerState(row) {
      const picker = row.querySelector(".ticket-picker");
      if (!picker) return;
      const productSelected = Boolean(findProduct(row.querySelector(".product").value));
      picker.classList.toggle("disabled", !productSelected);
      picker.querySelector(".ticket-trigger").setAttribute("aria-disabled", String(!productSelected));
      picker.querySelector(".ticket-trigger").tabIndex = productSelected ? 0 : -1;
      picker.querySelectorAll(".ticket-option-cb, .ticket-add").forEach((input) => {
        input.disabled = !productSelected;
      });
      if (!productSelected) setTicketMenuOpen(picker, false);
    }

    function wireTicketPicker(picker, row) {
      picker.querySelector(".ticket-trigger").addEventListener("click", (event) => {
        if (picker.classList.contains("disabled")) return;
        if (event.target.closest(".ticket-link")) return;
        if (event.target.closest(".ticket-remove")) return;
        setTicketMenuOpen(picker, picker.querySelector(".ticket-menu").classList.contains("hidden"));
      });
      picker.querySelector(".ticket-trigger").addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (picker.classList.contains("disabled")) return;
        setTicketMenuOpen(picker, picker.querySelector(".ticket-menu").classList.contains("hidden"));
      });
      picker.addEventListener("change", (event) => {
        if (picker.classList.contains("disabled")) return;
        if (!event.target.classList.contains("ticket-option-cb")) return;
        renderTicketTags(picker);
        syncRowTickets(row);
      });
      picker.addEventListener("click", (event) => {
        if (picker.classList.contains("disabled")) return;
        if (event.target.closest(".ticket-link")) return;
        const remove = event.target.closest(".ticket-remove");
        if (!remove) return;
        event.stopPropagation();
        const ticket = remove.dataset.ticket;
        const checkbox = Array.from(picker.querySelectorAll(".ticket-option-cb")).find((option) => option.value === ticket);
        if (checkbox) checkbox.checked = false;
        renderTicketTags(picker);
        syncRowTickets(row);
      });
      picker.querySelector(".ticket-add").addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addTicketFromRow(row);
      });
      picker.querySelector(".ticket-add").addEventListener("mousedown", (event) => {
        event.stopPropagation();
      });
      picker.querySelector(".ticket-add").addEventListener("click", (event) => {
        event.stopPropagation();
        event.currentTarget.focus();
      });
      picker.querySelector(".ticket-add").addEventListener("blur", () => {
        addTicketFromRow(row);
      });
    }

    function wireSessionRows() {
      document.querySelectorAll("#qa-rows tr[data-session-id]").forEach((row) => {
        const productInput = row.querySelector(".product");
        productInput.addEventListener("change", () => setRowProduct(row, findProduct(productInput.value)));
        const picker = row.querySelector(".ticket-picker");
        if (picker) {
          wireTicketPicker(picker, row);
          updateTicketPickerState(row);
        }
      });
    }

    function setRowProduct(row, product) {
      const session = findSession(row.dataset.sessionId);
      const productInput = row.querySelector(".product");
      if (!session || !productInput) return;
      productInput.value = product ? product.product_name : "";
      if (product) {
        session.product_id = product.product_id;
        session.product_name = product.product_name;
      } else {
        delete session.product_id;
        delete session.product_name;
      }
      validateProductRow(row);
      updateTicketPickerState(row);
    }

    function renderSessionTable() {
      const tbody = document.getElementById("qa-rows");
      const sessions = Array.isArray(daily && daily.sessions) ? daily.sessions : [];
      if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="${colSpan}" class="muted" style="text-align:center;padding:32px;">No QA sessions in this report.</td></tr>';
        return;
      }
      tbody.innerHTML = sessions.map(sessionRowHtml).join("");
      wireSessionRows();
    }

    function renderSupplementCandidates() {
      const panel = document.getElementById("qa-supplement-panel");
      const container = document.getElementById("qa-supplement-candidates");
      const visible = Array.isArray(excludedSessions) ? excludedSessions.filter((entry) => {
        const inReport = (daily.sessions || []).some((s) => s.session_id === entry.session_id);
        return !inReport && !manuallyAddedIds.has(entry.session_id);
      }) : [];
      if (visible.length === 0) {
        panel.classList.add("hidden");
        container.innerHTML = "";
        return;
      }
      panel.classList.remove("hidden");
      container.innerHTML = '<ul class="supplement-list">' + visible.map((entry) => {
        const title = entry.title || "untitled";
        return '<li class="supplement-item" data-session-id="' + escapeHtml(entry.session_id) + '">' +
          '<div class="supplement-meta">' +
          '<code>' + escapeHtml(entry.session_id) + '</code>' +
          '<span class="supplement-agent">' + escapeHtml(entry.agent) + '</span>' +
          '<span class="supplement-title">' + escapeHtml(title) + '</span>' +
          '<span class="supplement-reason">' + escapeHtml(entry.reason) + '</span>' +
          '</div>' +
          '<button type="button" class="supplement-add" data-session-id="' + escapeHtml(entry.session_id) + '">Add session</button>' +
          '</li>';
      }).join("") + '</ul>';
      container.querySelectorAll(".supplement-add").forEach((button) => {
        button.addEventListener("click", () => addExcludedSession(button.dataset.sessionId));
      });
    }

    function emptyAssetChange() {
      return {added: 0, modified: 0, deleted: 0};
    }

    function addExcludedSession(sessionId) {
      const entry = excludedSessions.find((item) => item.session_id === sessionId);
      if (!entry) return;
      if ((daily.sessions || []).some((s) => s.session_id === sessionId)) return;
      daily.sessions.push({
        session_id: entry.session_id,
        agent: entry.agent,
        session_title: entry.title || entry.session_id,
        ticket_ids: [],
        ticket_display_ids: [],
        requirement_ids: [],
        skill_layers: [],
        testpoint: emptyAssetChange(),
        testcase: emptyAssetChange(),
      });
      manuallyAddedIds.add(sessionId);
      renderSessionTable();
      renderSupplementCandidates();
    }

    function validateProductRow(row) {
      const productInput = row.querySelector(".product");
      const error = row.querySelector(".product-error");
      const product = findProduct(productInput.value);
      const valid = Boolean(product || !productInput.value.trim());
      row.classList.toggle("invalid-product", !valid);
      productInput.setCustomValidity(valid ? "" : "Choose a product from the list.");
      if (error) error.textContent = valid ? "" : "Choose a product from the list.";
      return valid;
    }

    /** Each session row owns exactly one product selector — at most one product per session. */
    function validateSingleProductPerSession() {
      const rows = Array.from(document.querySelectorAll("#qa-rows tr[data-session-id]"));
      const seen = new Set();
      for (const row of rows) {
        const sessionId = row.dataset.sessionId;
        if (seen.has(sessionId)) {
          throw new Error("Duplicate session row: " + sessionId);
        }
        seen.add(sessionId);
        validateProductRow(row);
      }
      const invalid = rows.filter((row) => row.classList.contains("invalid-product"));
      if (invalid.length > 0) {
        invalid[0].querySelector(".product").reportValidity();
        throw new Error("Fix invalid product selections before saving.");
      }
    }

    function collectAssignments() {
      document.querySelectorAll("#qa-rows tr[data-session-id]").forEach((row) => addTicketFromRow(row));
      validateSingleProductPerSession();
      return Array.from(document.querySelectorAll("#qa-rows tr[data-session-id]")).map((row) => {
        const sessionId = row.dataset.sessionId;
        const product = findProduct(row.querySelector(".product").value);
        return {
          session_id: sessionId,
          product_id: product ? product.product_id : undefined,
          product_line_id: product ? product.product_line_id : undefined,
          product_name: product ? product.product_name : undefined,
          ticket_display_ids: selectedTicketDisplayIds(row.querySelector(".ticket-picker")),
          manually_added: manuallyAddedIds.has(sessionId),
        };
      });
    }

    function setStatus(message, isError = false) {
      const el = document.getElementById("status");
      el.textContent = message;
      el.classList.toggle("status-error", isError);
    }

    async function loadBootstrapFromDom() {
      const node = document.getElementById("qa-bootstrap");
      if (!node) return false;
      const payload = JSON.parse(node.textContent || "{}");
      daily = payload.daily;
      products = normalizeProducts(payload.products || []);
      excludedSessions = payload.excludedSessions || [];
      return true;
    }

    async function init() {
      try {
        const embedded = await loadBootstrapFromDom();
        if (!embedded) {
          const payload = await api("/qa-assign/bootstrap");
          daily = payload.daily;
          products = normalizeProducts(payload.products || []);
          excludedSessions = payload.excludedSessions || [];
        }
        renderProductList();
        renderSessionTable();
        renderSupplementCandidates();
        document.addEventListener("click", (event) => {
          document.querySelectorAll(".ticket-picker").forEach((picker) => {
            if (!picker.contains(event.target)) setTicketMenuOpen(picker, false);
          });
        });
        window.addEventListener("resize", closeAllMenus);
        setStatus("Review QA sessions, adjust products/tickets, and save.");
      } catch (err) {
        setStatus(err.message || "Failed to load QA assignment data.", true);
      }
    }

    document.getElementById("save").addEventListener("click", async () => {
      try {
        const assignments = collectAssignments();
        await api("/qa-assign/save", {method: "POST", body: JSON.stringify({assignments})});
        setStatus("Saved.");
      } catch (err) {
        setStatus(err.message || "Save failed.", true);
      }
    });
    document.getElementById("close").addEventListener("click", () => window.close());

    init();
  </script>`}
</body>
</html>`;
}
