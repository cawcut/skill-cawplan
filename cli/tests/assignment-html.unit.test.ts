import {describe, expect, test} from "vitest";
import {assignmentHtml} from "../src/lib/assign/assignment-html";

describe("assignmentHtml - stats panel", () => {
    test("contains stats-bar element", () => {
        expect(assignmentHtml()).toContain('id="stats-bar"');
    });

    test("contains stats-bar CSS", () => {
        expect(assignmentHtml()).toContain("#stats-bar {");
    });

    test("contains storage bar stats layout", () => {
        const html = assignmentHtml();
        expect(html).toContain(".storage-wrap");
        expect(html).toContain("function storageRow(title, counts, preferredOrder)");
    });

    test("contains renderStats function", () => {
        expect(assignmentHtml()).toContain("renderStats()");
    });
});

describe("assignmentHtml - human input source", () => {
    test("reads human inputs from report-level rows by session_id", () => {
        const html = assignmentHtml();
        expect(html).toContain("function humanInputsForSession(report, session)");
        expect(html).toContain("report.human_inputs");
        expect(html).toContain("input.session_id");
        expect(html).toContain("humanInputsHtml(report, s)");
        expect(html).not.toContain("input.session_title");
    });

    test("does not render category and topic table filters", () => {
        const html = assignmentHtml();
        expect(html).not.toContain('id="filter-category"');
        expect(html).not.toContain('id="filter-topic"');
        expect(html).not.toContain("<th>Category</th>");
        expect(html).not.toContain("<th>Topic</th>");
    });

    test("input column shows first three rows without wrapping", () => {
        const html = assignmentHtml();
        expect(html).toContain(".slice(0, 3)");
        expect(html).toContain(".input-cell { overflow: hidden; }");
        expect(html).toContain("white-space: nowrap; overflow: hidden; text-overflow: ellipsis;");
        expect(html).toContain("'<td class=\"input-cell\">' + humanInputsHtml(report, s) + '</td>'");
    });
});

describe("assignmentHtml - needs review filter", () => {
    test("contains filter-unassigned button", () => {
        expect(assignmentHtml()).toContain('id="filter-unassigned"');
    });

    test("contains showAssignedSessions state variable", () => {
        expect(assignmentHtml()).toContain("showAssignedSessions");
    });

    test("contains standalone search and filter toolbar CSS", () => {
        const html = assignmentHtml();
        expect(html).toContain(".tsearch {");
        expect(html).toContain(".filter-group {");
        expect(html).toContain("input.unassigned-cb");
    });

    test("shows assigned sessions by default and filters only when enabled", () => {
        const html = assignmentHtml();
        expect(html).toContain("function shouldShowSession(session)");
        expect(html).toContain("function sessionHasProduct(session)");
        expect(html).toContain("!showAssignedSessions && sessionHasProduct(session)");
        expect(html).toContain("let showAssignedSessions = false;");
        expect(html).toContain("showAssignedSessions = true;");
        expect(html).toContain('id="filter-unassigned" class="unassigned-cb" /> Unassigned product');
        expect(html).not.toContain("Unassigned only");
    });
});

describe("assignmentHtml - session column", () => {
    test("renders session title with cwd hover tooltip", () => {
        const html = assignmentHtml();
        expect(html).toContain("const cwdTitle = ' title=\"cwd: &quot;' + escapeHtml(s.cwd || '') + '&quot;\"';");
        expect(html).toContain("'<td><div class=\"session-title\"' + cwdTitle + '>' + escapeHtml(title) + '</div></td>'");
        expect(html).not.toContain("[s.agent, s.project].filter(Boolean).join(' | ')");
    });
});

describe("assignmentHtml - lines column", () => {
    test("uses session files_added/files_deleted fields for line deltas", () => {
        const html = assignmentHtml();
        expect(html).toContain("Number(session.files_added || 0)");
        expect(html).toContain("Number(session.files_deleted || 0)");
        expect(html).not.toContain("Number(session.lines_added || 0)");
        expect(html).not.toContain("Number(session.lines_deleted || 0)");
    });
});

describe("assignmentHtml - date time column", () => {
    test("formats date time like the standalone design", () => {
        const html = assignmentHtml();
        expect(html).toContain("d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})");
        expect(html).toContain("d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})");
        expect(html).toContain("'<td class=\"dt-cell\">' + escapeHtml(sessionDateTimeText(s)) + '</td>'");
        expect(html).not.toContain("sessionDateTimeText(date, s)");
    });
});

describe("assignmentHtml - model column", () => {
    test("renders agent text and models from session.models", () => {
        const html = assignmentHtml();
        expect(html).toContain("function sessionModels(session)");
        expect(html).toContain("function sessionModelsHtml(session)");
        expect(html).toContain("const models = Array.isArray(session.models) ? session.models : [];");
        expect(html).toContain("value.includes('claude')");
        expect(html).toContain("value.includes('gpt')");
        expect(html).toContain("'<td class=\"agent-cell\"");
        expect(html).toContain("'<td class=\"models-cell\"");
        expect(html).toContain("MODEL_ICON_PATHS");
        expect(html).not.toContain("function agentChip(agent)");
        expect(html).not.toContain(".agent-chip {");
        expect(html).not.toContain("escapeHtml(model || '—')");
    });
});

describe("assignmentHtml - repo column", () => {
    test("uses custom repo picker instead of native dropdown UI", () => {
        const html = assignmentHtml();
        expect(html).toContain(".repo-field {");
        expect(html).toContain("select.repo { display: none;");
        expect(html).toContain(".repo-picker {");
        expect(html).toContain("function repoPickerHtml(productId, selectedRepo)");
        expect(html).toContain("function syncRepoPicker(row)");
        expect(html).toContain("function setRepoMenuOpen(picker, open)");
        expect(html).toContain(".repo-trigger { width: 100%; height: 32px;");
        expect(html).toContain(".repo-trigger:disabled { background: var(--bg);");
        expect(html).toContain("repoPickerHtml(s.product_id, selectedRepo)");
        expect(html).toContain("class=\"repo-option");
    });
});

describe("assignmentHtml - tickets column", () => {
    test("renders tickets column from session ticket display IDs", () => {
        const html = assignmentHtml();
        expect(html).toContain("<th>Tickets</th>");
        expect(html).toContain("function sessionTickets(session)");
        expect(html).toContain("session.ticket_display_ids");
        expect(html).not.toContain("session.ticket_ids");
        expect(html).toContain("function allTicketDisplayIds()");
        expect(html).toContain("function ticketDisplayIdFromInput(value)");
        expect(html).toContain("urlMatch[1].toUpperCase()");
        expect(html).toContain("ticketDisplayIdFromInput(value)");
        expect(html).toContain("function ticketOptionRows(session)");
        expect(html).toContain("function ticketPickerHtml(session)");
        expect(html).toContain("function selectedTicketDisplayIds(picker)");
        expect(html).toContain("function addTicketOption(picker, value)");
        expect(html).toContain("function addTicketFromRow(row)");
        expect(html).toContain("'<td class=\"tickets-cell\"");
        expect(html).toContain("'<td class=\"tickets-cell\">' + ticketPickerHtml(s) + '</td>'");
        expect(html).toContain("class=\"ticket-picker\"");
        expect(html).toContain("class=\"ticket-option-cb\"");
        expect(html).toContain("class=\"ticket-remove\"");
        expect(html).toContain("'<input class=\"ticket-add\" placeholder=\"Add ticket ID\" />'");
        expect(html).toContain("ticket_display_ids: selectedTicketDisplayIds");
        expect(html).toContain("querySelectorAll('.ticket-option-cb:checked')");
    });

    test("supports adding tickets before saving", () => {
        const html = assignmentHtml();
        expect(html).toContain("event.key !== 'Enter'");
        expect(html).toContain("addTicketFromRow(el.closest('tr'))");
        expect(html).toContain("addTicketFromRow(tr);");
    });

    test("requires product selection before tickets can be changed", () => {
        const html = assignmentHtml();
        expect(html).toContain(".ticket-picker.disabled .ticket-trigger");
        expect(html).toContain("function updateTicketPickerState(row)");
        expect(html).toContain("const productSelected = Boolean(findProduct(row.querySelector('.product').value));");
        expect(html).toContain("picker.classList.toggle('disabled', !productSelected);");
        expect(html).toContain("input.disabled = !productSelected;");
        expect(html).toContain("if (!productSelected) setTicketMenuOpen(picker, false);");
        expect(html).toContain("updateTicketPickerState(row);");
        expect(html).toContain("if (picker.classList.contains('disabled')) return;");
    });

    test("places tickets column after repo column", () => {
        const html = assignmentHtml();
        expect(html.indexOf("<th>Repo</th>")).toBeLessThan(html.indexOf("<th>Tickets</th>"));
        expect(html.indexOf("'<td><div class=\"repo-field\"><select class=\"repo\">")).toBeLessThan(html.indexOf("'<td class=\"tickets-cell\""));
    });

    test("uses ten-column empty states", () => {
        const html = assignmentHtml();
        expect(html).toContain('colspan="10"');
        expect(html).not.toContain('colspan="11"');
        expect(html).not.toContain('colspan="12"');
    });

    test("includes tickets in table search text", () => {
        const html = assignmentHtml();
        expect(html).toContain("sessionTicketsText(session)");
    });
});

describe("assignmentHtml - submit effect", () => {
    test("contains Saved check-mark text", () => {
        expect(assignmentHtml()).toContain("Saved ✓");
    });

    test("tells the user to return to the agent after saving", () => {
        const html = assignmentHtml();
        expect(html).toContain("Saved ✓ Return to agent");
        expect(html).toContain("Return to your agent to review and confirm upload.");
    });

    test("does not use alert for save confirmation", () => {
        expect(assignmentHtml()).not.toContain("alert('Saved");
    });

    test("contains btn-saved CSS class", () => {
        expect(assignmentHtml()).toContain(".btn-saved");
    });

    test("contains status-error CSS class", () => {
        expect(assignmentHtml()).toContain(".status-error");
    });
});
