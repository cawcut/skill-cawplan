import type { ReviewState, TestPoint } from "./types.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function groupByGroup(testPoints: TestPoint[]): Map<string, TestPoint[]> {
  const groups = new Map<string, TestPoint[]>();
  for (const tp of testPoints) {
    const group = tp.current.group || "Ungrouped";
    const list = groups.get(group) ?? [];
    list.push(tp);
    groups.set(group, list);
  }
  return groups;
}

const STATUS_LABEL: Record<TestPoint["status"], string> = {
  unchanged: "",
  edited: "Edited",
  deleted: "Deleted",
  added: "Added",
};

const AI_STATUS_LABEL: Record<TestPoint["ai_status"], string> = {
  none: "",
  modified: "AI Modified",
  added: "AI Added",
};

const COLUMN_HEADERS: Record<"zh" | "en", { seq: string; title: string; tags: string; priority: string; actions: string }> = {
  zh: { seq: "序号", title: "标题", tags: "标签", priority: "优先级", actions: "操作" },
  en: { seq: "No.", title: "Title", tags: "Tags", priority: "Priority", actions: "Actions" },
};

function renderComment(comment: TestPoint["comments"][number], locked = false): string {
  return `
              <li class="comment-item" data-comment-id="${escapeHtml(comment.id)}">
                <span class="comment-text">${escapeHtml(comment.text)}</span>
                <button type="button" class="comment-delete-btn" data-action="delete-comment" title="Delete comment"${locked ? " disabled" : ""}>×</button>
              </li>`;
}

function renderOriginalCompare(tp: TestPoint): string {
  const o = tp.original;
  return `
              <div class="original-compare hidden" data-original-compare>
                <div class="original-compare-title">Original (round 1)</div>
                <div class="original-compare-row"><span class="original-compare-key">Title</span><span>${escapeHtml(o.title)}</span></div>
                <div class="original-compare-row"><span class="original-compare-key">Group</span><span>${escapeHtml(o.group)}</span></div>
                <div class="original-compare-row"><span class="original-compare-key">Tags</span><span>${o.tags.map((t) => escapeHtml(t)).join(", ")}</span></div>
                <div class="original-compare-row"><span class="original-compare-key">Priority</span><span>${escapeHtml(o.priority)}</span></div>
              </div>`;
}

function renderRow(seq: string, tp: TestPoint, pageLocked: boolean): string {
  const f = tp.current;
  // An AI-created row is already identified by its provenance label. Rendering the generic
  // `Added` label alongside it repeats the same information.
  const statusLabel = tp.ai_status === "added" && tp.status === "added" ? "" : STATUS_LABEL[tp.status];
  const aiStatusLabel = AI_STATUS_LABEL[tp.ai_status];
  const isDeleted = tp.status === "deleted";
  const isLocked = pageLocked;
  const actionButton = isDeleted
    ? `<button type="button" class="restore-btn" data-action="restore"${isLocked ? " disabled" : ""}>Restore</button>`
    : `<button type="button" class="delete-btn" data-action="delete"${isLocked ? " disabled" : ""}>Delete</button>`;
  const commentCount = tp.comments.length;
  const commentsHtml = tp.comments.map((c) => renderComment(c, isLocked)).join("");
  const editable = isLocked ? "false" : "true";
  return `
        <tr class="tp-row status-${tp.status}${isLocked ? " locked" : ""}" data-id="${escapeHtml(tp.id)}" data-status="${tp.status}" data-ai-status="${tp.ai_status}" data-comment-count="${commentCount}" data-locked="${isLocked}">
          <td>${escapeHtml(seq)}</td>
          <td>
            <div class="tp-title-cell">
              <span class="status-bar" aria-hidden="true"></span>
              <span class="field" data-field="title" data-editable="${editable}">${escapeHtml(f.title)}</span>
              ${statusLabel ? `<span class="status-label">${escapeHtml(statusLabel)}</span>` : ""}
              ${aiStatusLabel ? `<button type="button" class="status-label ai-status-label" data-action="toggle-original-compare">${escapeHtml(aiStatusLabel)}</button>` : ""}
              ${isLocked ? `<span class="status-label locked-label">Locked</span>` : ""}
            </div>
            ${aiStatusLabel ? renderOriginalCompare(tp) : ""}
          </td>
          <td><span class="field" data-field="tags" data-editable="${editable}">${f.tags.map((t) => escapeHtml(t)).join(", ")}</span></td>
          <td><span class="field" data-field="priority" data-editable="${editable}">${escapeHtml(f.priority)}</span></td>
          <td>
            ${actionButton}
            <button type="button" class="comment-toggle-btn" data-action="toggle-comments">Comment<span class="comment-count">${commentCount > 0 ? `(${commentCount})` : ""}</span></button>
          </td>
        </tr>
        <tr class="comment-row hidden" data-id="${escapeHtml(tp.id)}">
          <td></td>
          <td colspan="4">
            <div class="comment-panel">
              <ul class="comment-list">${commentsHtml}</ul>
              <div class="comment-form">
                <input type="text" class="comment-input" placeholder="Write a comment…"${isLocked ? " disabled" : ""} />
                <button type="button" class="comment-submit-btn"${isLocked ? " disabled" : ""}>Submit</button>
              </div>
            </div>
          </td>
        </tr>`;
}

function renderGlobalFeedbackPanel(globalComments: TestPoint["comments"], pageLocked: boolean): string {
  const commentsHtml = globalComments.map((c) => renderComment(c, pageLocked)).join("");
  const disabledAttr = pageLocked ? " disabled" : "";
  return `
    <section class="global-feedback">
      <h2 title="Feedback not tied to a specific test point; the AI uses it when optimizing.">Overall Feedback</h2>
      <ul class="comment-list" id="global-comment-list">${commentsHtml}</ul>
      <div class="comment-form" id="global-comment-form">
        <input type="text" class="comment-input" placeholder="Write overall feedback…"${disabledAttr} />
        <button type="button" class="comment-submit-btn"${disabledAttr}>Submit</button>
      </div>
    </section>`;
}

function renderAddTestPointPanel(pageLocked: boolean): string {
  const disabledAttr = pageLocked ? " disabled" : "";
  return `
    <div class="add-tp">
      <button type="button" class="add-tp-toggle-btn" id="add-tp-toggle"${disabledAttr}>+ Add Test Point</button>
    </div>
    <div class="add-tp-form hidden" id="add-tp-form">
      <input type="text" class="add-tp-input" id="add-tp-title" placeholder="Title (required)"${disabledAttr} />
      <input type="text" class="add-tp-input" id="add-tp-group" placeholder="Group"${disabledAttr} />
      <input type="text" class="add-tp-input" id="add-tp-tags" placeholder="Tags (comma-separated)"${disabledAttr} />
      <select class="add-tp-input" id="add-tp-priority"${disabledAttr}>
        <option value="CRITICAL">CRITICAL</option>
        <option value="HIGH">HIGH</option>
        <option value="MEDIUM" selected>MEDIUM</option>
        <option value="LOW">LOW</option>
      </select>
      <button type="button" class="comment-submit-btn" id="add-tp-submit"${disabledAttr}>Submit</button>
    </div>`;
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "all", label: "All" },
  { key: "edited", label: "Edited" },
  { key: "deleted", label: "Deleted" },
  { key: "added", label: "Added" },
  { key: "commented", label: "Commented" },
];

function renderFilterBar(): string {
  const buttons = FILTERS.map(
    (f, i) =>
      `<button type="button" class="filter-btn${i === 0 ? " active" : ""}" data-filter="${f.key}">${escapeHtml(f.label)}</button>`,
  ).join("");
  return `
    <div class="filter-bar">${buttons}</div>`;
}

const OPTIMIZE_STALE_MS = 10 * 60 * 1000;

function isOptimizeStale(reviewStatus: ReviewState["review_status"], optimizeRequestedAt: string | undefined): boolean {
  const isLocked = reviewStatus === "pending_optimize" || reviewStatus === "optimizing";
  if (!isLocked || !optimizeRequestedAt) return false;
  const requestedAt = new Date(optimizeRequestedAt).getTime();
  if (Number.isNaN(requestedAt)) return false;
  return Date.now() - requestedAt > OPTIMIZE_STALE_MS;
}

function renderOptimizeBar(reviewStatus: ReviewState["review_status"]): string {
  const isLocked = reviewStatus === "pending_optimize" || reviewStatus === "optimizing";
  return `
    <div class="optimize-bar">
      <button type="button" class="optimize-btn" id="optimize-btn"${isLocked ? " disabled" : ""}>Ask AI to Optimize</button>
    </div>`;
}

function renderSaveToCawPlanBar(pageLocked: boolean, visibleCount: number): string {
  const disabled = pageLocked || visibleCount === 0;
  return `
    <div class="save-cawplan-bar">
      <button type="button" class="save-cawplan-btn" id="save-cawplan-btn"${disabled ? " disabled" : ""}>Save to CawPlan</button>
    </div>`;
}

function renderActionNotices(optimizeHint: string, optimizeHintIsStale: boolean): string {
  return `
    <div class="action-notices" aria-live="polite" aria-atomic="true">
      <span class="action-notice optimize-hint${optimizeHintIsStale ? " optimize-hint-stale" : ""}" id="optimize-hint">${escapeHtml(optimizeHint)}</span>
      <span class="action-notice save-cawplan-hint" id="save-cawplan-hint"></span>
    </div>`;
}

function renderGroup(
  groupName: string,
  groupIndex: number,
  testPoints: TestPoint[],
  language: "zh" | "en",
  pageLocked: boolean,
): string {
  const headers = COLUMN_HEADERS[language];
  const rows = testPoints
    .map((tp, i) => renderRow(`${groupIndex}.${i + 1}`, tp, pageLocked))
    .join("");
  return `
    <section class="group" data-group="${groupIndex}">
      <h2>${groupIndex}. ${escapeHtml(groupName)}</h2>
      <table>
        <thead>
          <tr><th>${escapeHtml(headers.seq)}</th><th>${escapeHtml(headers.title)}</th><th>${escapeHtml(headers.tags)}</th><th>${escapeHtml(headers.priority)}</th><th>${escapeHtml(headers.actions)}</th></tr>
        </thead>
        <tbody>${rows}
        </tbody>
      </table>
    </section>`;
}

export function testPointReviewHtml(state?: ReviewState, token = ""): string {
  if (!state) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Test Point Review</title>
</head>
<body>
  <h1>Test Point Review — skeleton under construction</h1>
</body>
</html>`;
  }

  const language: "zh" | "en" = state.language === "en" ? "en" : "zh";
  const pageLocked = state.review_status === "pending_optimize" || state.review_status === "optimizing";
  // Archived test points (design §4.1) are gone from the page entirely — not shown, not locked.
  const visibleTestPoints = state.test_points.filter((tp) => tp.archived !== true);
  const archivedCount = state.test_points.length - visibleTestPoints.length;
  const groups = groupByGroup(visibleTestPoints);
  const optimizeHintIsStale = isOptimizeStale(state.review_status, state.optimize_requested_at);
  const optimizeHint = optimizeHintIsStale
    ? "Last optimization request may not have completed — please tell the Agent in Chat to “continue optimizing”."
    : pageLocked
      ? "Optimization requested — this review is locked until the AI responds."
      : "";
  const groupsHtml = Array.from(groups.entries())
    .map(([groupName, testPoints], index) => renderGroup(groupName, index + 1, testPoints, language, pageLocked))
    .join("\n");

  return `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8" />
  <title>Test Point Review</title>
  <style>
    :root {
      --ink-900: #14161a;
      --ink-700: #454a54;
      --ink-500: #767c88;
      --ink-400: #9498a3;
      --ink-300: #d3d6db;
      --line: #e3e5e9;
      --line-soft: #ececef;
      --page-bg: #f3f4f6;
      --surface: #ffffff;
      --surface-sunken: #fafafb;
      --surface-tint: #f6f7f9;
      --accent: #3159d6;
      --accent-strong: #2547b0;
      --accent-soft: #eef1fc;
      --amber: #92660a;
      --amber-soft: #fbf2dd;
      --amber-bar: #dba528;
      --red: #ad3a34;
      --red-soft: #fbecea;
      --red-bar: #d15c53;
      --radius-sm: 5px;
      --radius-md: 7px;
      --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
    }
    * { box-sizing: border-box; }
    html { background: var(--page-bg); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Helvetica Neue", sans-serif;
      color: var(--ink-700);
      background: var(--page-bg);
      font-size: 13.5px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      margin: 0;
      padding: 28px 32px 64px;
    }
    .page-shell {
      max-width: 1320px;
      margin: 0 auto;
      background: var(--surface);
      border: 1px solid var(--line-soft);
      border-radius: var(--radius-md);
      padding: 32px 44px 72px;
    }
    .page-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--line-soft);
    }
    h1 {
      font-size: 18px;
      font-weight: 650;
      color: var(--ink-900);
      margin: 0;
      letter-spacing: -0.015em;
      display: flex;
      align-items: baseline;
      gap: 10px;
    }
    .meta-line {
      margin: 0;
      color: var(--ink-400);
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-variant-numeric: tabular-nums;
    }
    .meta-line .review-id { font-family: var(--font-mono); font-size: 11px; color: var(--ink-400); }
    .meta-line .sep { color: var(--ink-300); }
    .save-hint { font-size: 12px; color: var(--accent); font-weight: 500; }

    .global-feedback {
      margin: 16px 0;
      padding: 10px 14px;
      background: var(--surface-tint);
      border-radius: var(--radius-md);
    }
    .global-feedback h2 {
      margin: 0 0 6px 0;
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.05em;
      color: var(--ink-500);
    }
    .global-feedback .comment-list { margin: 0 0 6px 0; }
    .global-feedback .comment-item {
      padding: 4px 2px;
      border-bottom: 1px solid var(--line-soft);
    }
    .global-feedback .comment-form { border-top: none; }
    .global-feedback .comment-input { background: var(--surface); height: 28px; }
    .global-feedback .comment-submit-btn { height: 28px; }

    .review-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 16px 0;
      flex-wrap: wrap;
    }
    .add-tp { margin-right: auto; }
    .add-tp-toggle-btn {
      font-size: 12.5px;
      font-weight: 550;
      height: 30px;
      padding: 0 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink-700);
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
    }
    .add-tp-toggle-btn:hover { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-strong); }
    .add-tp-form {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: -6px 0 16px;
      flex-basis: 100%;
      order: 4;
      padding: 12px;
      border: 1px solid var(--line-soft);
      border-radius: var(--radius-md);
      background: var(--surface-sunken);
    }
    .add-tp-form.hidden { display: none; }
    .add-tp-input {
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      background: var(--surface);
      color: var(--ink-900);
    }
    .add-tp-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    #add-tp-title { flex: 2; min-width: 200px; }
    #add-tp-group, #add-tp-tags, #add-tp-priority { flex: 1; min-width: 100px; }

    .round-badge {
      display: inline-flex;
      align-items: center;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--accent);
      background: var(--accent-soft);
      border-radius: var(--radius-sm);
      padding: 1px 8px;
      letter-spacing: 0.01em;
    }

    .filter-bar { display: flex; gap: 2px; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--line-soft); }
    .filter-btn {
      font-size: 12px;
      font-weight: 500;
      height: 26px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      color: var(--ink-500);
      transition: background 0.12s ease, color 0.12s ease;
    }
    .filter-btn:hover { background: var(--surface-tint); color: var(--ink-700); }
    .filter-btn.active { background: var(--accent-soft); color: var(--accent-strong); font-weight: 600; }

    .group { margin-bottom: 26px; }
    .group h2 {
      font-size: 13.5px;
      font-weight: 650;
      color: var(--ink-900);
      padding-bottom: 10px;
      margin: 0 0 2px;
      display: flex;
      align-items: baseline;
      gap: 8px;
      border-bottom: 1px solid var(--line-soft);
    }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { text-align: left; padding: 9px 10px; vertical-align: middle; }
    td { border-bottom: 1px solid var(--line-soft); }
    th {
      color: var(--ink-400);
      font-weight: 500;
      font-size: 10.5px;
      letter-spacing: 0.04em;
      padding-top: 4px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--line-soft);
    }
    th:nth-child(1) { width: 52px; }
    th:nth-child(3) { width: 160px; }
    th:nth-child(4) { width: 90px; }
    th:nth-child(5) { width: 172px; }
    tr.tp-row { transition: background 0.1s ease; background: var(--surface); }
    tr.tp-row:hover { background: var(--surface-tint); }
    td:first-child, th:first-child {
      color: var(--ink-400);
      font-size: 11.5px;
      font-family: var(--font-mono);
      white-space: nowrap;
    }
    .tp-title-cell { display: flex; align-items: center; gap: 9px; position: relative; min-height: 22px; }
    .status-bar { width: 2.5px; align-self: stretch; border-radius: 2px; background: transparent; margin-left: -10px; }
    tr.status-edited .status-bar { background: var(--amber-bar); opacity: 0.75; }
    tr.status-deleted .status-bar { background: var(--red-bar); opacity: 0.75; }
    tr.status-added .status-bar { background: var(--accent); opacity: 0.75; }
    tr.status-deleted .field { color: var(--ink-500); text-decoration: line-through; text-decoration-color: var(--ink-300); }
    tr.status-deleted td { color: var(--ink-500); }
    .status-label {
      font-size: 10.5px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--surface-tint);
      color: var(--ink-500);
      letter-spacing: 0.02em;
      flex-shrink: 0;
    }
    tr.status-edited .status-label { background: var(--amber-soft); color: var(--amber); }
    tr.status-deleted .status-label { background: var(--red-soft); color: var(--red); }
    tr.status-added .status-label { background: var(--accent-soft); color: var(--accent-strong); }
    .ai-status-label {
      background: var(--accent-soft);
      color: var(--accent-strong);
      border: none;
      cursor: pointer;
      /* Keep the .status-label font size and weight; only normalize the button family. */
      font-family: inherit;
    }
    .ai-status-label:hover { background: var(--accent); color: #fff; }
    .original-compare {
      margin: 6px 0 2px 18px;
      padding: 8px 10px;
      background: var(--surface-tint);
      border-radius: var(--radius-sm);
      font-size: 12px;
    }
    .original-compare.hidden { display: none; }
    .original-compare-title { font-weight: 650; color: var(--ink-500); margin-bottom: 4px; font-size: 11px; letter-spacing: 0.02em; }
    .original-compare-row { display: flex; gap: 8px; padding: 2px 0; }
    .original-compare-key { flex-shrink: 0; width: 52px; color: var(--ink-400); font-weight: 550; }
    .field { color: var(--ink-900); }
    .field[data-editable="true"] { cursor: text; border-radius: 4px; padding: 3px 6px; margin: -3px -6px; transition: background 0.12s ease; }
    .field[data-editable="true"]:hover { background: var(--surface-tint); }
    .field[contenteditable="true"] { background: #fff8e4; outline: 1.5px solid var(--amber-bar); box-shadow: 0 0 0 3px rgba(219, 165, 40, 0.14); }

    .delete-btn, .restore-btn, .comment-toggle-btn, .comment-submit-btn {
      font-size: 12px;
      font-weight: 550;
      height: 26px;
      padding: 0 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--ink-700);
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
      display: inline-flex;
      align-items: center;
      flex-shrink: 0;
      white-space: nowrap;
    }
    .delete-btn:hover { background: var(--red-soft); border-color: var(--red-bar); color: var(--red); }
    .restore-btn { border-color: var(--amber-bar); color: var(--amber); background: var(--amber-soft); }
    .restore-btn:hover { background: #f7e6bd; }
    .comment-toggle-btn { margin-left: 6px; color: var(--ink-500); }
    tr.tp-row td:nth-child(5) { white-space: nowrap; }
    .comment-toggle-btn:hover { background: var(--surface-tint); border-color: var(--ink-300); color: var(--ink-700); }
    .comment-count { margin-left: 4px; color: var(--ink-400); font-weight: 500; }
    .comment-submit-btn { background: var(--surface); border-color: var(--line); color: var(--ink-700); font-weight: 550; }
    .comment-submit-btn:hover { background: var(--surface-tint); border-color: var(--ink-300); color: var(--ink-900); }

    tr.comment-row.hidden { display: none; }
    tr.comment-row td { border-bottom: 1px solid var(--line-soft); background: #fbfcff; padding: 0 10px; }
    .comment-panel { padding: 8px 8px 10px 12px; border-left: 2px solid #dfe6fb; margin: 0 0 0 22px; }
    .comment-list { list-style: none; margin: 0 0 6px 0; padding: 0; }
    .comment-item { padding: 4px 0; font-size: 12.5px; display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line-soft); }
    .comment-item:last-child { border-bottom: none; }
    .comment-text { flex: 1; color: var(--ink-700); }
    .comment-delete-btn {
      border: none;
      background: none;
      color: var(--ink-300);
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      padding: 3px 6px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .comment-delete-btn:hover { color: var(--red); background: var(--red-soft); }
    .comment-form { display: flex; align-items: center; gap: 8px; }
    .comment-input {
      flex: 1;
      height: 30px;
      padding: 0 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      font-size: 12.5px;
      background: var(--surface-sunken);
      color: var(--ink-900);
      transition: border-color 0.12s ease, background 0.12s ease;
    }
    .comment-input:focus { outline: none; border-color: var(--accent); background: var(--surface); box-shadow: 0 0 0 3px var(--accent-soft); }

    tr.tp-row.filtered-out, tr.comment-row.filtered-out { display: none; }
    .group.filtered-out { display: none; }

    tr.tp-row.locked { background: var(--surface-sunken); }
    tr.tp-row.locked .field[data-editable="false"] { cursor: default; color: var(--ink-500); }
    tr.tp-row.locked .field[data-editable="false"]:hover { background: none; }
    .status-label.locked-label { background: var(--surface-tint); color: var(--ink-500); }
    .delete-btn:disabled, .restore-btn:disabled, .comment-delete-btn:disabled,
    .comment-submit-btn:disabled, .comment-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .optimize-bar {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .optimize-btn {
      font-size: 12.5px;
      font-weight: 600;
      height: 30px;
      padding: 0 14px;
      border-radius: var(--radius-sm);
      border: 1px solid #9eafea;
      background: var(--accent-soft);
      color: var(--accent-strong);
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .optimize-btn:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
    .optimize-btn:disabled { background: var(--ink-300); border-color: var(--ink-300); color: var(--surface); cursor: not-allowed; }
    .save-cawplan-bar {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .save-cawplan-btn {
      font-size: 12.5px;
      font-weight: 600;
      height: 30px;
      padding: 0 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      cursor: pointer;
      transition: background 0.12s ease, border-color 0.12s ease;
    }
    .save-cawplan-btn:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
    .save-cawplan-btn:disabled { background: var(--ink-300); border-color: var(--ink-300); color: var(--surface); cursor: not-allowed; }
    .action-notices {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      margin-top: 8px;
    }
    .action-notice {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      max-width: 100%;
      padding: 5px 8px;
      border-radius: var(--radius-sm);
      background: var(--amber-soft);
      color: var(--amber);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
    }
    .action-notice:empty { display: none; }
    .action-notice::before {
      content: "!";
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
      border-radius: 50%;
      background: var(--amber);
      color: var(--amber-soft);
      font-size: 10px;
      font-weight: 800;
    }
  </style>
</head>
<body>
  <div class="page-shell">
    <div class="page-header">
      <h1>Test Point Review<span class="round-badge">Round ${state.round}</span></h1>
      <p class="meta-line"><span class="review-id">${escapeHtml(state.review_id)}</span><span class="sep">·</span>${visibleTestPoints.length} total${archivedCount > 0 ? `<span class="sep">·</span>Already saved to CawPlan: ${archivedCount}` : ""}<span class="save-hint" id="save-hint"></span></p>
    </div>
    ${renderGlobalFeedbackPanel(state.global_comments, pageLocked)}
    <section class="review-actions" aria-label="Review actions">
      ${renderAddTestPointPanel(pageLocked)}
      ${renderOptimizeBar(state.review_status)}
      ${renderSaveToCawPlanBar(pageLocked, visibleTestPoints.length)}
    </section>
    ${renderActionNotices(optimizeHint, optimizeHintIsStale)}
    ${renderFilterBar()}
    ${groupsHtml}
  </div>
  <script>
    (function () {
      var token = ${JSON.stringify(token)};
      var reviewId = ${JSON.stringify(state.review_id)};
      var lastKnownUpdatedAt = ${JSON.stringify(state.updated_at)};

      function fieldValue(el, fieldName) {
        var text = el.textContent || "";
        if (fieldName === "tags") {
          return text.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
        }
        return text.trim();
      }

      var STATUS_LABEL = ${JSON.stringify(STATUS_LABEL)};

      function setSaveHint(text) {
        var hint = document.getElementById("save-hint");
        if (hint) hint.textContent = text;
      }

      function withUpdatedAt(url) {
        return url + (url.indexOf("?") === -1 ? "?" : "&") + "updated_at=" + encodeURIComponent(lastKnownUpdatedAt);
      }

      function handleApiResponse(res) {
        if (res.status === 409) {
          return res.json().then(function (data) {
            if (data && data.error === "conflict") {
              setSaveHint("This data was updated elsewhere. Please refresh before saving again.");
              throw new Error("conflict");
            }
            throw new Error("request failed");
          });
        }
        if (!res.ok) throw new Error("request failed");
        return res.json().then(function (data) {
          if (data && typeof data.updated_at === "string") {
            lastKnownUpdatedAt = data.updated_at;
          }
          return data;
        });
      }

      function applyRowStatus(row, status) {
        row.className = row.className.replace(/\\bstatus-\\S+/g, "").trim();
        row.classList.add("tp-row", "status-" + status);
        row.setAttribute("data-status", status);

        var titleCell = row.querySelector(".tp-title-cell");
        var existingLabel = titleCell && titleCell.querySelector(".status-label:not(.ai-status-label):not(.locked-label)");
        if (existingLabel) existingLabel.parentNode.removeChild(existingLabel);
        var text = STATUS_LABEL[status];
        var hasAiAddedLabel = row.getAttribute("data-ai-status") === "added" &&
          titleCell && titleCell.querySelector(".ai-status-label");
        if (titleCell && text && !(status === "added" && hasAiAddedLabel)) {
          var label = document.createElement("span");
          label.className = "status-label";
          label.textContent = text;
          titleCell.appendChild(label);
        }

        var actionCell = row.querySelector(".delete-btn, .restore-btn");
        if (actionCell) {
          if (status === "deleted") {
            actionCell.outerHTML = '<button type="button" class="restore-btn" data-action="restore">Restore</button>';
          } else {
            actionCell.outerHTML = '<button type="button" class="delete-btn" data-action="delete">Delete</button>';
          }
          wireActionButton(row.querySelector(".delete-btn, .restore-btn"));
        }

        applyFilterToRow(row);
      }

      var activeFilter = "all";

      function rowMatchesFilter(row, filter) {
        if (filter === "all") return true;
        if (filter === "commented") return Number(row.getAttribute("data-comment-count")) > 0;
        return row.getAttribute("data-status") === filter;
      }

      function applyFilterToRow(row) {
        var matches = rowMatchesFilter(row, activeFilter);
        row.classList.toggle("filtered-out", !matches);
        var id = row.getAttribute("data-id");
        var commentRow = document.querySelector('tr.comment-row[data-id="' + id + '"]');
        if (commentRow && !matches) commentRow.classList.add("filtered-out");
        else if (commentRow) commentRow.classList.remove("filtered-out");

        var section = row.closest(".group");
        if (section) {
          var visibleRow = section.querySelector("tr.tp-row:not(.filtered-out)");
          section.classList.toggle("filtered-out", !visibleRow);
        }
      }

      function applyFilter(filter) {
        activeFilter = filter;
        document.querySelectorAll("tr.tp-row").forEach(applyFilterToRow);
      }

      function wireFilterBar() {
        var buttons = document.querySelectorAll(".filter-btn");
        buttons.forEach(function (btn) {
          btn.addEventListener("click", function () {
            buttons.forEach(function (b) { b.classList.remove("active"); });
            btn.classList.add("active");
            applyFilter(btn.getAttribute("data-filter"));
          });
        });
      }

      function saveField(row, field, el) {
        var id = row.getAttribute("data-id");
        var body = {};
        body[field] = fieldValue(el, field);
        setSaveHint("Saving…");
        fetch(withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + "?token=" + encodeURIComponent(token)), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
          .then(handleApiResponse)
          .then(function () {
            applyRowStatus(row, "edited");
            setSaveHint("Saved");
            setTimeout(function () { setSaveHint(""); }, 1500);
          })
          .catch(function (err) {
            if (err && err.message === "conflict") return;
            setSaveHint("Save failed, please retry");
          });
      }

      function setDeleted(row, deleted) {
        var id = row.getAttribute("data-id");
        var suffix = deleted ? "/delete" : "/restore";
        setSaveHint(deleted ? "Deleting…" : "Restoring…");
        fetch(withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + suffix + "?token=" + encodeURIComponent(token)), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
          .then(handleApiResponse)
          .then(function (data) {
            applyRowStatus(row, data.test_point.status);
            setSaveHint("Saved");
            setTimeout(function () { setSaveHint(""); }, 1500);
          })
          .catch(function (err) {
            if (err && err.message === "conflict") return;
            setSaveHint("Action failed, please retry");
          });
      }

      function wireActionButton(btn) {
        if (!btn) return;
        btn.addEventListener("click", function () {
          var row = btn.closest(".tp-row");
          var action = btn.getAttribute("data-action");
          setDeleted(row, action === "delete");
        });
      }

      function escapeHtmlClient(value) {
        var div = document.createElement("div");
        div.textContent = value;
        return div.innerHTML;
      }

      function wireCommentToggle(btn) {
        btn.addEventListener("click", function () {
          var row = btn.closest(".tp-row");
          var id = row.getAttribute("data-id");
          var commentRow = document.querySelector('tr.comment-row[data-id="' + id + '"]');
          if (commentRow) commentRow.classList.toggle("hidden");
        });
      }

      function wireOriginalCompareToggle(btn) {
        btn.addEventListener("click", function () {
          var panel = btn.closest(".tp-title-cell").parentNode.querySelector("[data-original-compare]");
          if (panel) panel.classList.toggle("hidden");
        });
      }

      function updateCommentCount(id, list) {
        var row = document.querySelector('tr.tp-row[data-id="' + id + '"]');
        if (!row) return;
        var count = list.querySelectorAll(".comment-item").length;
        row.setAttribute("data-comment-count", String(count));
        var countEl = row.querySelector(".comment-count");
        if (countEl) {
          countEl.textContent = count > 0 ? " (" + count + ")" : "";
        }
        applyFilterToRow(row);
      }

      function wireCommentDeleteButton(btn, id, list) {
        btn.addEventListener("click", function () {
          var li = btn.closest(".comment-item");
          var commentId = li.getAttribute("data-comment-id");
          setSaveHint("Deleting…");
          fetch(
            withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + "/comments/" + encodeURIComponent(commentId) + "?token=" + encodeURIComponent(token)),
            { method: "DELETE" },
          )
            .then(handleApiResponse)
            .then(function () {
              li.parentNode.removeChild(li);
              updateCommentCount(id, list);
              setSaveHint("Saved");
              setTimeout(function () { setSaveHint(""); }, 1500);
            })
            .catch(function (err) {
              if (err && err.message === "conflict") return;
              setSaveHint("Delete failed, please retry");
            });
        });
      }

      function wireCommentForm(commentRow) {
        var id = commentRow.getAttribute("data-id");
        var input = commentRow.querySelector(".comment-input");
        var submitBtn = commentRow.querySelector(".comment-submit-btn");
        var list = commentRow.querySelector(".comment-list");

        list.querySelectorAll(".comment-delete-btn").forEach(function (btn) {
          wireCommentDeleteButton(btn, id, list);
        });

        function submit() {
          var text = input.value.trim();
          if (!text) return;
          setSaveHint("Saving…");
          fetch(withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + "/comments?token=" + encodeURIComponent(token)), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: text }),
          })
            .then(handleApiResponse)
            .then(function (data) {
              var comments = data.test_point.comments;
              var newComment = comments[comments.length - 1];
              var li = document.createElement("li");
              li.className = "comment-item";
              li.setAttribute("data-comment-id", newComment.id);
              li.innerHTML =
                '<span class="comment-text">' + escapeHtmlClient(text) + '</span>' +
                '<button type="button" class="comment-delete-btn" data-action="delete-comment" title="Delete comment">×</button>';
              list.appendChild(li);
              wireCommentDeleteButton(li.querySelector(".comment-delete-btn"), id, list);
              input.value = "";

              updateCommentCount(id, list);

              setSaveHint("Saved");
              setTimeout(function () { setSaveHint(""); }, 1500);
            })
            .catch(function (err) {
              if (err && err.message === "conflict") return;
              setSaveHint("Save failed, please retry");
            });
        }

        submitBtn.addEventListener("click", submit);
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        });
      }

      function wireGlobalCommentDeleteButton(btn, list) {
        btn.addEventListener("click", function () {
          var li = btn.closest(".comment-item");
          var commentId = li.getAttribute("data-comment-id");
          setSaveHint("Deleting…");
          fetch(
            withUpdatedAt("/api/global-comments/" + encodeURIComponent(commentId) + "?token=" + encodeURIComponent(token)),
            { method: "DELETE" },
          )
            .then(handleApiResponse)
            .then(function () {
              li.parentNode.removeChild(li);
              setSaveHint("Saved");
              setTimeout(function () { setSaveHint(""); }, 1500);
            })
            .catch(function (err) {
              if (err && err.message === "conflict") return;
              setSaveHint("Delete failed, please retry");
            });
        });
      }

      function wireGlobalFeedbackForm() {
        var form = document.getElementById("global-comment-form");
        if (!form) return;
        var input = form.querySelector(".comment-input");
        var submitBtn = form.querySelector(".comment-submit-btn");
        var list = document.getElementById("global-comment-list");

        list.querySelectorAll(".comment-delete-btn").forEach(function (btn) {
          wireGlobalCommentDeleteButton(btn, list);
        });

        function submit() {
          var text = input.value.trim();
          if (!text) return;
          setSaveHint("Saving…");
          fetch(withUpdatedAt("/api/global-comments?token=" + encodeURIComponent(token)), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: text }),
          })
            .then(handleApiResponse)
            .then(function (data) {
              var comments = data.global_comments;
              var newComment = comments[comments.length - 1];
              var li = document.createElement("li");
              li.className = "comment-item";
              li.setAttribute("data-comment-id", newComment.id);
              li.innerHTML =
                '<span class="comment-text">' + escapeHtmlClient(text) + '</span>' +
                '<button type="button" class="comment-delete-btn" data-action="delete-comment" title="Delete comment">×</button>';
              list.appendChild(li);
              wireGlobalCommentDeleteButton(li.querySelector(".comment-delete-btn"), list);
              input.value = "";

              setSaveHint("Saved");
              setTimeout(function () { setSaveHint(""); }, 1500);
            })
            .catch(function (err) {
              if (err && err.message === "conflict") return;
              setSaveHint("Save failed, please retry");
            });
        }

        submitBtn.addEventListener("click", submit);
        input.addEventListener("keydown", function (event) {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          }
        });
      }

      function wireAddTestPointPanel() {
        var toggleBtn = document.getElementById("add-tp-toggle");
        var form = document.getElementById("add-tp-form");
        if (!toggleBtn || !form) return;

        toggleBtn.addEventListener("click", function () {
          form.classList.toggle("hidden");
        });

        var titleInput = document.getElementById("add-tp-title");
        var groupInput = document.getElementById("add-tp-group");
        var tagsInput = document.getElementById("add-tp-tags");
        var priorityInput = document.getElementById("add-tp-priority");
        var submitBtn = document.getElementById("add-tp-submit");

        function submit() {
          var title = titleInput.value.trim();
          if (!title) return;
          var body = {
            title: title,
            group: groupInput.value.trim(),
            tags: tagsInput.value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
            priority: priorityInput.value.trim(),
          };
          setSaveHint("Saving…");
          fetch(withUpdatedAt("/api/test-points?token=" + encodeURIComponent(token)), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          })
            .then(handleApiResponse)
            .then(function () {
              location.reload();
            })
            .catch(function (err) {
              if (err && err.message === "conflict") return;
              setSaveHint("Save failed, please retry");
            });
        }

        submitBtn.addEventListener("click", submit);
      }

      function wireField(el) {
        var row = el.closest(".tp-row");
        var field = el.getAttribute("data-field");
        var originalText = el.textContent;

        el.addEventListener("click", function () {
          if (el.getAttribute("contenteditable") === "true") return;
          if (row.classList.contains("status-deleted")) return;
          el.setAttribute("contenteditable", "true");
          originalText = el.textContent;
          el.focus();
        });

        el.addEventListener("blur", function () {
          if (el.getAttribute("contenteditable") !== "true") return;
          el.removeAttribute("contenteditable");
          if (el.textContent === originalText) return;
          saveField(row, field, el);
        });

        el.addEventListener("keydown", function (event) {
          if (event.key === "Enter" && field !== "tags") {
            event.preventDefault();
            el.blur();
          }
          if (event.key === "Escape") {
            el.textContent = originalText;
            el.blur();
          }
        });
      }

      function lockRow(row) {
        row.classList.add("locked");
        row.setAttribute("data-locked", "true");

        row.querySelectorAll(".field[data-editable=\\"true\\"]").forEach(function (field) {
          field.setAttribute("data-editable", "false");
        });

        var titleCell = row.querySelector(".tp-title-cell");
        if (titleCell && !titleCell.querySelector(".locked-label")) {
          var label = document.createElement("span");
          label.className = "status-label locked-label";
          label.textContent = "Locked";
          titleCell.appendChild(label);
        }

        row.querySelectorAll(".delete-btn, .restore-btn").forEach(function (btn) {
          btn.disabled = true;
        });

        var id = row.getAttribute("data-id");
        var commentRow = document.querySelector('tr.comment-row[data-id="' + id + '"]');
        if (commentRow) {
          commentRow.querySelectorAll(".comment-delete-btn, .comment-submit-btn, .comment-input").forEach(function (el) {
            el.disabled = true;
          });
        }
      }

      function lockPage() {
        document.querySelectorAll("tr.tp-row").forEach(lockRow);

        var globalForm = document.getElementById("global-comment-form");
        if (globalForm) {
          globalForm.querySelectorAll(".comment-input, .comment-submit-btn").forEach(function (el) {
            el.disabled = true;
          });
        }
        document.querySelectorAll("#global-comment-list .comment-delete-btn").forEach(function (el) {
          el.disabled = true;
        });

        var addToggle = document.getElementById("add-tp-toggle");
        if (addToggle) addToggle.disabled = true;
        var addForm = document.getElementById("add-tp-form");
        if (addForm) {
          addForm.querySelectorAll("input, button").forEach(function (el) {
            el.disabled = true;
          });
        }
      }

      function wireOptimizeButton() {
        var btn = document.getElementById("optimize-btn");
        var hint = document.getElementById("optimize-hint");
        if (!btn) return;

        btn.addEventListener("click", function () {
          btn.disabled = true;
          if (hint) hint.textContent = "Requesting optimization…";
          fetch("/api/optimize?token=" + encodeURIComponent(token), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
            .then(function (res) {
              if (!res.ok) throw new Error("optimize request failed");
              return res.json();
            })
            .then(function (data) {
              if (data && data.outcome === "NO_CHANGES") {
                btn.disabled = false;
                if (hint) hint.textContent = "No changes to optimize. Make a change first.";
                return;
              }
              lockPage();
              if (hint) {
                hint.textContent = "Optimization requested. This review is locked while AI is working. If Chat does not respond, send “Continue optimization” in Chat.";
              }
            })
            .catch(function () {
              btn.disabled = false;
              if (hint) hint.textContent = "Request failed, please retry";
            });
        });
      }

      function wireSaveToCawPlanButton() {
        var btn = document.getElementById("save-cawplan-btn");
        var hint = document.getElementById("save-cawplan-hint");
        if (!btn) return;

        function submit() {
          btn.disabled = true;
          if (hint) {
            hint.className = "action-notice save-cawplan-hint";
            hint.textContent = "Saving to CawPlan…";
          }
          fetch("/api/save-to-cawplan?token=" + encodeURIComponent(token), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          })
            .then(function (res) {
              return res.json().then(function (data) { return { res: res, data: data }; });
            })
            .then(function (result) {
              var res = result.res;
              var data = result.data;
              if (res.status === 409 && data && data.error === "unresolved_feedback") {
                btn.disabled = false;
                if (hint) {
                  hint.className = "action-notice save-cawplan-hint save-cawplan-hint-error";
                  hint.textContent = "Comments or Overall Feedback must be processed by Ask AI before saving.";
                }
                return;
              }
              if (!res.ok) {
                throw new Error((data && data.message) || "save request failed");
              }
              if (data.outcome === "NOOP") {
                if (hint) hint.textContent = "Nothing new to save — every visible test point is already archived.";
                btn.disabled = false;
                return;
              }
              lockPage();
              if (hint) {
                hint.textContent =
                  "Saved " + data.archived_count + " test point(s) to CawPlan. This review session has ended.";
              }
            })
            .catch(function (err) {
              btn.disabled = false;
              if (hint) {
                hint.className = "action-notice save-cawplan-hint save-cawplan-hint-error";
                hint.textContent = (err && err.message) || "Save failed, please retry";
              }
            });
        }

        btn.addEventListener("click", submit);
      }

      document.querySelectorAll(".field[data-editable=\\"true\\"]").forEach(wireField);
      document.querySelectorAll(".delete-btn, .restore-btn").forEach(wireActionButton);
      document.querySelectorAll(".comment-toggle-btn").forEach(wireCommentToggle);
      document.querySelectorAll(".ai-status-label").forEach(wireOriginalCompareToggle);
      document.querySelectorAll("tr.comment-row").forEach(wireCommentForm);
      wireGlobalFeedbackForm();
      wireAddTestPointPanel();
      wireFilterBar();
      wireOptimizeButton();
      wireSaveToCawPlanButton();
    })();
  </script>
</body>
</html>`;
}
