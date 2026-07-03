import {describe, expect, test} from "vitest";
import {assignmentHtml} from "../src/lib/assign/assignment-html";

describe("assignmentHtml - badge CSS", () => {
    test("contains base badge style", () => {
        expect(assignmentHtml()).toContain(".badge {");
    });

    test("contains category badge styles", () => {
        const html = assignmentHtml();
        expect(html).toContain(".badge-cat-decision");
        expect(html).toContain(".badge-cat-direction");
        expect(html).toContain(".badge-cat-correction");
        expect(html).toContain(".badge-cat-planning");
    });

    test("contains topic badge styles", () => {
        const html = assignmentHtml();
        expect(html).toContain(".badge-topic-bug");
        expect(html).toContain(".badge-topic-other");
    });

    test("humanInputsHtml builds badge elements", () => {
        const html = assignmentHtml();
        expect(html).toContain("badge-cat-");
        expect(html).toContain("badge-topic-");
    });
});

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

    test("shows most common category and topic for a session", () => {
        const html = assignmentHtml();
        expect(html).toContain("function mostCommonHumanInputValue(report, session, field)");
        expect(html).toContain("return mostCommonHumanInputValue(report, session, 'category')");
        expect(html).toContain("return mostCommonHumanInputValue(report, session, 'topic')");
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

    test("rowEntries hides assigned sessions by default", () => {
        const html = assignmentHtml();
        expect(html).toContain("function shouldShowSession(session)");
        expect(html).toContain("function sessionHasProduct(session)");
        expect(html).toContain("!showAssignedSessions && sessionHasProduct(session)");
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
