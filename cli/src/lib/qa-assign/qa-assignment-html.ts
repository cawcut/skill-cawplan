import type {QaSessionData} from "../collect/qa-types.js";
import type {QaExcludedSession} from "../collect/aggregators/qa-daily.js";
import type {QaAssignmentBootstrap} from "./types.js";
import {escapeHtml, normalizePortalBase} from "../assignment-ui/format.js";
import {INLINE_ESCAPE_HTML} from "../assignment-ui/browser-snippets.js";

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

function skillLayersText(session: QaSessionData): string {
    return (session.skill_layers ?? []).join(", ") || "—";
}

/** Server-side row HTML for tests and readonly preview. */
export function renderQaSessionRowHtml(
    session: QaSessionData,
    products: QaAssignmentBootstrap["products"],
    opts: {interactive?: boolean} = {},
): string {
    const interactive = opts.interactive ?? false;
    const title = session.session_title ?? session.session_id;
    const reqCount = (session.requirement_ids ?? []).length;
    const tpAdded = session.testpoint?.added ?? 0;
    const productCell = interactive
        ? productSelectHtml(session, products)
        : `<span class="product-readonly">${escapeHtml(session.product_id ?? "—")}</span>`;

    return `<tr data-session-id="${escapeHtml(session.session_id)}">` +
        `<td class="sid-cell"><code>${escapeHtml(session.session_id)}</code></td>` +
        `<td class="agent-cell">${escapeHtml(session.agent || "—")}</td>` +
        `<td class="title-cell">${escapeHtml(title)}</td>` +
        `<td class="product-cell">${productCell}</td>` +
        `<td class="num-cell">${reqCount}</td>` +
        `<td class="num-cell">${tpAdded}</td>` +
        `<td class="skills-cell">${escapeHtml(skillLayersText(session))}</td>` +
        (interactive
            ? `<td class="tickets-cell">${ticketInputHtml(session)}</td>`
            : "") +
        `</tr>`;
}

function productSelectHtml(
    session: QaSessionData,
    products: QaAssignmentBootstrap["products"],
): string {
    const selected = session.product_id ?? "";
    const options = ['<option value="">— Select product —</option>']
        .concat(products.map((product) => {
            const isSelected = product.product_id === selected ? " selected" : "";
            return `<option value="${escapeHtml(product.product_id)}"${isSelected}>${escapeHtml(product.product_name)}</option>`;
        }));
    return `<select class="product-select" aria-label="Product for session">${options.join("")}</select>` +
        `<div class="product-error field-error"></div>`;
}

function ticketInputHtml(session: QaSessionData): string {
    const value = (session.ticket_display_ids ?? []).join(", ");
    return `<input class="ticket-input" type="text" value="${escapeHtml(value)}" placeholder="Ticket IDs (comma-separated)" />`;
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

    const preRenderedTable = opts.bootstrap
        ? `<tbody id="qa-rows">${opts.bootstrap.daily.sessions
            .map((session) => renderQaSessionRowHtml(
                session,
                opts.bootstrap!.products,
                {interactive: !readonly},
            ))
            .join("")}</tbody>`
        : `<tbody id="qa-rows"><tr><td colspan="${readonly ? 7 : 8}" class="muted">Loading sessions...</td></tr></tbody>`;

    const ticketHeader = readonly ? "" : "<th>Tickets</th>";
    const colSpan = readonly ? 7 : 8;

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
    td { padding: 10px 12px; border-bottom: 1px solid var(--border-sub); vertical-align: top; word-break: break-word; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--bg-hover); }
    .sid-cell code { font-size: 11px; }
    .skills-cell { font-size: 12px; color: var(--text-02); }
    .product-cell select, .tickets-cell input { width: 100%; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: 4px; font: inherit; }
    .product-cell select:focus, .tickets-cell input:focus { border-color: var(--uBlue-06); outline: none; box-shadow: 0 0 0 3px rgba(0,111,255,.12); }
    tr.invalid-product select.product-select { border-color: var(--red-06); box-shadow: 0 0 0 3px rgba(240,58,62,.12); }
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
        <table>
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Agent</th>
              <th>Title</th>
              <th>Product</th>
              <th>Requirements</th>
              <th>Test points added</th>
              <th>Skill layers</th>
              ${ticketHeader}
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

    function findProduct(productId) {
      const needle = String(productId || "").trim();
      if (!needle) return null;
      return products.find((p) => String(p.product_id) === needle) || null;
    }

    function skillLayersText(session) {
      return (Array.isArray(session.skill_layers) ? session.skill_layers : []).join(", ") || "—";
    }

    function productSelectHtml(session) {
      const selected = session.product_id || "";
      const options = ['<option value="">— Select product —</option>']
        .concat(products.map((product) => {
          const isSelected = product.product_id === selected ? " selected" : "";
          return '<option value="' + escapeHtml(product.product_id) + '"' + isSelected + '>' +
            escapeHtml(product.product_name) + '</option>';
        }));
      return '<select class="product-select" aria-label="Product for session">' + options.join("") + '</select>' +
        '<div class="product-error field-error"></div>';
    }

    function ticketInputHtml(session) {
      const value = (Array.isArray(session.ticket_display_ids) ? session.ticket_display_ids : []).join(", ");
      return '<input class="ticket-input" type="text" value="' + escapeHtml(value) + '" placeholder="Ticket IDs (comma-separated)" />';
    }

    function sessionRowHtml(session) {
      const title = session.session_title || session.session_id;
      const reqCount = (Array.isArray(session.requirement_ids) ? session.requirement_ids : []).length;
      const tpAdded = session.testpoint && typeof session.testpoint.added === "number" ? session.testpoint.added : 0;
      return '<tr data-session-id="' + escapeHtml(session.session_id) + '">' +
        '<td class="sid-cell"><code>' + escapeHtml(session.session_id) + '</code></td>' +
        '<td class="agent-cell">' + escapeHtml(session.agent || "—") + '</td>' +
        '<td class="title-cell">' + escapeHtml(title) + '</td>' +
        '<td class="product-cell">' + productSelectHtml(session) + '</td>' +
        '<td class="num-cell">' + reqCount + '</td>' +
        '<td class="num-cell">' + tpAdded + '</td>' +
        '<td class="skills-cell">' + escapeHtml(skillLayersText(session)) + '</td>' +
        '<td class="tickets-cell">' + ticketInputHtml(session) + '</td>' +
        '</tr>';
    }

    function renderSessionTable() {
      const tbody = document.getElementById("qa-rows");
      const sessions = Array.isArray(daily && daily.sessions) ? daily.sessions : [];
      if (sessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="${colSpan}" class="muted" style="text-align:center;padding:32px;">No QA sessions in this report.</td></tr>';
        return;
      }
      tbody.innerHTML = sessions.map(sessionRowHtml).join("");
      tbody.querySelectorAll(".product-select").forEach((select) => {
        select.addEventListener("change", () => validateProductRow(select.closest("tr")));
      });
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

    function parseTicketDisplayIds(raw) {
      return [...new Set(String(raw || "").split(/[,\\s]+/).map((part) => {
        const trimmed = part.trim();
        const urlMatch = /https?:\\/\\/[^\\s/]+\\/issue\\/([A-Za-z]+-\\d+)/i.exec(trimmed);
        if (urlMatch && urlMatch[1]) return urlMatch[1].toUpperCase();
        const displayMatch = /^[A-Za-z][A-Za-z0-9]+-\\d+$/.exec(trimmed);
        return displayMatch ? trimmed.toUpperCase() : "";
      }).filter(Boolean))];
    }

    function validateProductRow(row) {
      const select = row.querySelector(".product-select");
      const error = row.querySelector(".product-error");
      const product = findProduct(select.value);
      const valid = Boolean(product || !select.value);
      row.classList.toggle("invalid-product", !valid);
      select.setCustomValidity(valid ? "" : "Choose a product from the list.");
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
        invalid[0].querySelector(".product-select").reportValidity();
        throw new Error("Fix invalid product selections before saving.");
      }
    }

    function collectAssignments() {
      validateSingleProductPerSession();
      return Array.from(document.querySelectorAll("#qa-rows tr[data-session-id]")).map((row) => {
        const sessionId = row.dataset.sessionId;
        const select = row.querySelector(".product-select");
        const ticketInput = row.querySelector(".ticket-input");
        const product = findProduct(select.value);
        return {
          session_id: sessionId,
          product_id: product ? product.product_id : undefined,
          product_line_id: product ? product.product_line_id : undefined,
          product_name: product ? product.product_name : undefined,
          ticket_display_ids: parseTicketDisplayIds(ticketInput ? ticketInput.value : ""),
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
      products = payload.products || [];
      excludedSessions = payload.excludedSessions || [];
      return true;
    }

    async function init() {
      try {
        const embedded = await loadBootstrapFromDom();
        if (!embedded) {
          const payload = await api("/qa-assign/bootstrap");
          daily = payload.daily;
          products = payload.products || [];
          excludedSessions = payload.excludedSessions || [];
        }
        renderSessionTable();
        renderSupplementCandidates();
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
