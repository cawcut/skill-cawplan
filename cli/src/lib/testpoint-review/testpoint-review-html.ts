import { TESTPOINT_PRIORITIES } from "../qa-insights/types.js";
import { reviewPhase } from "./review-phase.js";
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

function renderPriorityOptions(selectedPriority: string): string {
  return TESTPOINT_PRIORITIES.map(
    (priority) =>
      `<option value="${priority}"${priority === selectedPriority ? " selected" : ""}>${priority}</option>`,
  ).join("");
}

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
              <span class="field" data-field="title" data-editable="${editable}">${escapeHtml(f.title)}</span>
              ${statusLabel ? `<span class="status-label">${escapeHtml(statusLabel)}</span>` : ""}
              ${aiStatusLabel ? `<button type="button" class="status-label ai-status-label" data-action="toggle-original-compare">${escapeHtml(aiStatusLabel)}</button>` : ""}
              ${isLocked ? `<span class="status-label locked-label">Locked</span>` : ""}
            </div>
            ${aiStatusLabel ? renderOriginalCompare(tp) : ""}
          </td>
          <td><span class="field" data-field="tags" data-editable="${editable}">${f.tags.map((t) => escapeHtml(t)).join(", ")}</span></td>
          <td><span class="priority-cell" data-priority="${escapeHtml(f.priority)}"><span class="priority-dot" aria-hidden="true"></span><select class="add-tp-input priority-select" data-field="priority" data-editable="${editable}" aria-label="Priority"${isLocked || isDeleted ? " disabled" : ""}>${renderPriorityOptions(f.priority)}</select></span></td>
          <td>
            <button type="button" class="edit-btn" data-action="edit"${isLocked || isDeleted ? " disabled" : ""}>Edit</button>
            <button type="button" class="comment-toggle-btn" data-action="toggle-comments">Comment<span class="comment-count">${commentCount > 0 ? `(${commentCount})` : ""}</span></button>
            ${actionButton}
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

// Single source for the Ignore answer: Ignore writes this text through the normal answer endpoint.
const IGNORE_ANSWER = "Ignore";
const DONE_CLOSE_HINT: Record<"zh" | "en", string> = {
  zh: "已完成，可关闭此页",
  en: "Done — you can close this tab",
};

const QUESTIONS_PAGE_TEXT = {
  title: "Questions to confirm",
  ignore: "Ignore",
  undo: "Undo",
  ignored: "Ignored",
  hint: "Answer AI's questions, or ignore them. Test points are regenerated from your answers.",
  placeholder: "Type your answer...",
  submit: "Submit to AI",
};

function questionCountLabel(count: number): string {
  return `${count} ${count === 1 ? "Question" : "Questions"}`;
}

function renderQuestionsPage(state: ReviewState, pageLocked: boolean): string {
  const questions = state.open_questions ?? [];
  const text = QUESTIONS_PAGE_TEXT;
  const disabledAttr = pageLocked ? " disabled" : "";
  const items = questions.map((question, index) => {
    const answer = (question.answer ?? "").trim();
    const isIgnored = answer === IGNORE_ANSWER;
    const stateClass = isIgnored ? " is-ignored" : answer ? " is-answered" : "";
    return `
        <li class="question-item${stateClass}" data-question-id="${escapeHtml(question.id)}">
          <div class="question-heading">
            <span class="question-dot" aria-hidden="true"></span>
            <span class="question-number">${String(index + 1).padStart(2, "0")}</span>
            <span class="question-text">${escapeHtml(question.text)}</span>
          </div>
          <div class="question-answer-form">
            <div class="question-input-wrap">
              <textarea class="question-answer-input" rows="1" placeholder="${escapeHtml(text.placeholder)}"${disabledAttr}${isIgnored ? " readonly" : ""}>${escapeHtml(question.answer ?? "")}</textarea>
              <span class="question-ignored-label">${escapeHtml(text.ignored)}</span>
            </div>
            <button type="button" class="question-ignore-btn" data-ignore-label="${escapeHtml(text.ignore)}" data-undo-label="${escapeHtml(text.undo)}"${disabledAttr}>${escapeHtml(isIgnored ? text.undo : text.ignore)}</button>
            <div class="question-save-error" role="alert" aria-live="polite">
              <span class="question-save-error-text"></span>
              <button type="button" class="question-save-retry">Retry</button>
            </div>
          </div>
        </li>`;
  }).join("");
  return `
    <section class="questions-page" id="questions-page">
      <div class="questions-heading">
        <span class="questions-title">${escapeHtml(text.title)}</span>
        <span class="questions-counts">${questionCountLabel(questions.length)}</span>
      </div>
      <p class="questions-hint">${escapeHtml(text.hint)}</p>
      <ol class="questions-list">${items}
      </ol>
    </section>`;
}

function renderAddTestPointToggle(pageLocked: boolean): string {
  return `
    <div class="add-tp">
      <button type="button" class="add-tp-toggle-btn" id="add-tp-toggle"${pageLocked ? " disabled" : ""}>+ Add Test Point</button>
    </div>`;
}

function renderAddTestPointForm(pageLocked: boolean, existingGroups: string[]): string {
  const disabledAttr = pageLocked ? " disabled" : "";
  const groupOptions = existingGroups
    .map((g) => `<li class="tp-combo-option" role="option" data-value="${escapeHtml(g)}">${escapeHtml(g)}</li>`)
    .join("");
  return `
    <div class="tp-modal-backdrop hidden" id="add-tp-form">
      <div class="tp-modal" role="dialog" aria-modal="true" aria-labelledby="add-tp-heading">
        <div class="tp-modal-header">
          <h3 id="add-tp-heading">Add Test Point</h3>
          <button type="button" class="tp-modal-close" id="add-tp-close" aria-label="Close">×</button>
        </div>
        <div class="tp-modal-body">
          <label class="tp-modal-field"><span>Title <em>*</em></span>
            <textarea class="add-tp-input" id="add-tp-title" rows="2" placeholder="Title (required)"${disabledAttr}></textarea>
            <span class="tp-modal-error hidden" id="add-tp-error">Title is required</span>
          </label>
          <label class="tp-modal-field"><span>Group</span>
            <span class="tp-combo" id="add-tp-combo">
              <input type="text" class="add-tp-input" id="add-tp-group" role="combobox" aria-expanded="false" aria-controls="add-tp-group-list" placeholder="Select an existing group or type a new one" autocomplete="off"${disabledAttr} />
              <ul class="tp-combo-list hidden" id="add-tp-group-list" role="listbox">${groupOptions}</ul>
            </span>
          </label>
          <label class="tp-modal-field"><span>Tags</span>
            <input type="text" class="add-tp-input" id="add-tp-tags" placeholder="Enter tags"${disabledAttr} />
          </label>
          <label class="tp-modal-field"><span>Priority</span>
            <select class="add-tp-input" id="add-tp-priority"${disabledAttr}>
        ${renderPriorityOptions("MEDIUM")}
      </select>
          </label>
        </div>
        <div class="tp-modal-footer">
          <button type="button" class="tp-modal-cancel" id="add-tp-cancel">Cancel</button>
          <button type="button" class="tp-modal-submit" id="add-tp-submit"${disabledAttr}>Add Test Point</button>
        </div>
      </div>
    </div>`;
}

const OPTIMIZE_STALE_MS = 10 * 60 * 1000;

function isOptimizeStale(reviewStatus: ReviewState["review_status"], optimizeRequestedAt: string | undefined): boolean {
  const isLocked = reviewStatus === "pending_optimize" || reviewStatus === "optimizing";
  if (!isLocked || !optimizeRequestedAt) return false;
  const requestedAt = new Date(optimizeRequestedAt).getTime();
  if (Number.isNaN(requestedAt)) return false;
  return Date.now() - requestedAt > OPTIMIZE_STALE_MS;
}

function renderOptimizeBar(reviewStatus: ReviewState["review_status"], label = "Submit to AI", forceDisabled = false): string {
  const isLocked = reviewStatus === "pending_optimize" || reviewStatus === "optimizing";
  return `
    <div class="optimize-bar">
      <button type="button" class="optimize-btn" id="optimize-btn"${isLocked || forceDisabled ? " disabled" : ""}>${escapeHtml(label)}</button>
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
      <span class="optimize-hint action-notice${optimizeHintIsStale ? " optimize-hint-stale" : ""}" id="optimize-hint">${escapeHtml(optimizeHint)}</span>
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
  const isQuestionsPhase = reviewPhase(state) === "questions";
  const allAnswered = (state.open_questions ?? []).every((question) => (question.answer ?? "").trim() !== "");
  const answeredCount = (state.open_questions ?? []).filter((question) => (question.answer ?? "").trim() !== "").length;
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
      --teal: #0b7d6e;
      --teal-soft: #e0f5f1;
      --teal-bar: #14b8a6;
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

    .questions-page {
      margin: 16px 0;
      border: 1px solid #dce4fb;
      border-radius: var(--radius-md);
      background: var(--surface);
      overflow: hidden;
    }
    .questions-heading {
      background: #f1f5ff;
      min-height: 38px;
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 9px;
      color: var(--ink-700);
    }
    .questions-title { color: var(--ink-900); font-weight: 650; }
    .questions-counts { color: var(--ink-500); font-size: 12px; }
    .question-ignore-btn {
      flex-shrink: 0;
      height: 32px;
      min-width: 60px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--ink-700);
      font-size: 12px;
      cursor: pointer;
    }
    .question-ignore-btn:hover:not(:disabled) { background: var(--surface-tint); border-color: var(--ink-300); }
    .question-ignore-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .questions-list {
      margin: 0;
      padding: 0 12px;
      list-style: none;
      background: var(--surface);
      border-top: 1px solid #e5eafb;
    }
    .questions-hint { margin: 0; padding: 8px 12px; color: var(--ink-500); font-size: 12px; border-top: 1px solid #e5eafb; }
    .question-item { display: flex; align-items: center; gap: 16px; padding: 10px 2px; border-bottom: 1px solid var(--line-soft); }
    .question-dot { flex: 0 0 8px; width: 8px; height: 8px; margin-top: 7px; border-radius: 50%; background: #f59e0b; }
    .question-item.is-answered .question-dot { background: #2fb457; }
    .question-item.is-ignored .question-dot { background: #cfd5e3; }
    .question-item.is-ignored .question-text { color: #7B8494; font-weight: 400; }
    .question-item:last-child { border-bottom: 0; }
    .question-heading { display: flex; align-items: flex-start; gap: 10px; flex: 1 1 0; min-width: 0; }
    .question-number { padding-top: 0; line-height: 1.5; }
    .question-number { color: #9CA3AF; font-weight: 400; font-family: inherit; letter-spacing: normal; }
    .question-text { flex: 1; color: #374151; font-weight: 400; line-height: 1.5; overflow-wrap: anywhere; }
    .question-answer-form { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px; flex: 0 0 46%; min-width: 0; margin: 0; }
    .question-input-wrap { position: relative; flex: 1 1 0; min-width: 0; }
    .question-ignored-label { display: none; position: absolute; left: 10px; top: 0; line-height: 32px; color: var(--ink-400); pointer-events: none; }
    .question-item.is-ignored .question-ignored-label { display: block; }
    .question-item.is-ignored .question-answer-input { background: var(--surface-tint); color: transparent; cursor: default; }
    .question-item.is-ignored .question-ignore-btn { color: var(--accent-strong); font-weight: 600; }
    @media (max-width: 720px) {
      .question-item { flex-wrap: wrap; }
      .question-answer-form { flex-basis: 100%; margin-left: 28px; }
    }
    .question-answer-form .question-answer-input { width: 100%; }
    .question-answer-form .question-save-error { flex-basis: 100%; margin-top: 0; }
    .question-answer-input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      resize: none;
      overflow: hidden;
      min-height: 32px;
      padding: 6px 9px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
      color: var(--ink-900);
      background: var(--surface);
    }
    .question-answer-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
    .question-answer-input:disabled { cursor: not-allowed; opacity: 0.65; }
    .question-save-error {
      display: none;
      align-items: center;
      gap: 8px;
      margin-top: 5px;
      color: var(--red);
      font-size: 12px;
    }
    .question-save-error.visible { display: flex; }
    .question-save-retry {
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--accent-strong);
      cursor: pointer;
      font-family: inherit;
      font-size: inherit;
      text-decoration: underline;
    }
    .question-save-retry.hidden { display: none; }

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
    .tp-modal-backdrop {
      position: fixed; inset: 0; z-index: 100;
      display: flex; align-items: center; justify-content: center;
      padding: 24px 16px;
      background: rgba(17, 24, 39, 0.45);
      overscroll-behavior: contain;
    }
    .tp-modal-backdrop.hidden { display: none; }
    .stale-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 10px 0 0;
      padding: 10px 14px;
      border: 1px solid var(--red-bar);
      border-radius: var(--radius-sm);
      background: var(--red-soft);
      color: var(--red);
      font-size: 13px;
      font-weight: 550;
    }
    .stale-banner.hidden { display: none; }
    .stale-banner button {
      flex: none;
      height: 28px;
      padding: 0 12px;
      border: 1px solid var(--red-bar);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--red);
      font-weight: 600;
      cursor: pointer;
    }
    .tp-modal {
      width: 100%; max-width: 520px; max-height: 100%;
      display: flex; flex-direction: column;
      background: var(--surface); border-radius: 10px;
      box-shadow: 0 20px 50px rgba(17, 24, 39, 0.25);
    }
    .tp-modal-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 8px; }
    .tp-modal-header h3 { margin: 0; font-size: 16px; font-weight: 600; color: var(--ink-900); }
    .tp-modal-close {
      width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
      background: transparent; color: var(--ink-500); font-size: 20px; line-height: 1; cursor: pointer;
    }
    .tp-modal-close:hover { background: var(--surface-tint); color: var(--ink-900); }
    .tp-modal-body { padding: 8px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
    .tp-modal-field { display: flex; flex-direction: column; gap: 5px; font-size: 12.5px; font-weight: 550; color: var(--ink-700); }
    .tp-modal-field em { color: var(--red); font-style: normal; }
    .tp-modal-field .add-tp-input { width: 100%; font-weight: 400; }
    .tp-modal-error { color: var(--red); font-size: 12px; font-weight: 400; }
    .tp-modal-error.hidden { display: none; }
    .tp-combo { position: relative; display: block; }
    .tp-combo-list {
      position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 5;
      margin: 0; padding: 4px; list-style: none;
      max-height: 168px; overflow-y: auto;
      background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm);
      box-shadow: 0 8px 20px rgba(17, 24, 39, 0.12);
    }
    .tp-combo-list.hidden { display: none; }
    .tp-combo-option { height: 32px; line-height: 32px; padding: 0 8px; border-radius: 4px; font-size: 12.5px; font-weight: 400; color: var(--ink-700); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tp-combo-option:hover, .tp-combo-option.active { background: var(--accent-soft); color: var(--accent-strong); }
    .tp-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--line-soft); }
    .tp-modal-cancel, .tp-modal-submit {
      box-sizing: border-box; height: 32px; padding: 0 14px; border-radius: var(--radius-sm); font-size: 12.5px; font-weight: 550; line-height: 1; cursor: pointer;
      border: 1px solid var(--line); background: var(--surface); color: var(--ink-700);
    }
    .tp-modal-cancel:hover { background: var(--surface-tint); }
    .tp-modal-submit { background: var(--accent); border-color: var(--accent); color: #fff; }
    .tp-modal-submit:hover { background: var(--accent-strong); border-color: var(--accent-strong); }
    .tp-modal-submit:disabled { opacity: 0.55; cursor: not-allowed; }
    tr.tp-row.tp-flash td { animation: tp-flash 2.2s ease-out; }
    @keyframes tp-flash { 0%, 55% { background: #fff4c2; } 100% { background: transparent; } }
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
    textarea.add-tp-input { height: auto; min-height: 56px; max-height: 40vh; padding: 6px 10px; line-height: 1.5; resize: none; font-family: inherit; }

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
    th:nth-child(4) { width: 120px; }
    th:nth-child(5) { width: 230px; }
    tr.tp-row { transition: background 0.1s ease; background: var(--surface); }
    tr.tp-row:hover { background: var(--surface-tint); }
    td:first-child, th:first-child {
      color: var(--ink-400);
      font-size: 11.5px;
      font-family: var(--font-mono);
      white-space: nowrap;
    }
    .tp-title-cell { display: flex; align-items: center; gap: 9px; position: relative; min-height: 22px; }
    /* Full-height status bar on the row's left edge; AI provenance first, human status overrides it. */
    tr.tp-row[data-ai-status="modified"] td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
    tr.tp-row[data-ai-status="added"] td:first-child { box-shadow: inset 3px 0 0 var(--teal-bar); }
    tr.tp-row.status-added td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
    tr.tp-row.status-edited td:first-child { box-shadow: inset 3px 0 0 var(--amber-bar); }
    tr.tp-row.status-deleted td:first-child { box-shadow: inset 3px 0 0 var(--red-bar); }
    td:first-child { padding-left: 14px; }
    tr.status-deleted .field { color: var(--ink-500); text-decoration: line-through; text-decoration-color: var(--ink-300); }
    tr.status-deleted td { color: var(--ink-500); }
    .status-label {
      font-size: 11px;
      font-weight: 550;
      line-height: 16px;
      padding: 1px 8px;
      border-radius: 999px;
      background: var(--surface-tint);
      color: var(--ink-500);
      flex-shrink: 0;
    }
    tr.status-edited .status-label { background: var(--amber-soft); color: var(--amber); }
    tr.status-deleted .status-label { background: var(--red-soft); color: var(--red); }
    tr.status-added .status-label { background: var(--accent-soft); color: var(--accent-strong); }
    .ai-status-label {
      border: none;
      cursor: pointer;
      /* Keep the .status-label font size and weight; only normalize the button family. */
      font-family: inherit;
    }
    tr.tp-row .ai-status-label { background: var(--accent-soft); color: var(--accent-strong); }
    tr.tp-row[data-ai-status="added"] .ai-status-label { background: var(--teal-soft); color: var(--teal); }
    tr.tp-row .ai-status-label:hover { filter: brightness(0.96); }
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
    .priority-select {
      width: 100px;
      min-width: 0;
      padding: 0 24px 0 8px;
      border-color: transparent;
      background-color: transparent;
      background-image: none;
      box-shadow: none;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      transition: background-color 0.12s ease;
    }
    .priority-select:hover, .priority-select:focus {
      border-color: transparent;
      background-color: var(--line-soft);
      background-image:
        linear-gradient(45deg, transparent 50%, var(--ink-500) 50%),
        linear-gradient(135deg, var(--ink-500) 50%, transparent 50%);
      background-position:
        calc(100% - 11px) 50%,
        calc(100% - 7px) 50%;
      background-repeat: no-repeat;
      background-size: 4px 4px;
      box-shadow: none;
      outline: none;
    }

    .edit-btn, .delete-btn, .restore-btn, .comment-toggle-btn, .comment-submit-btn {
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
    .edit-btn:hover { background: var(--surface-tint); border-color: var(--ink-300); color: var(--ink-900); }
    .edit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .comment-toggle-btn, .delete-btn, .restore-btn { margin-left: 6px; }
    .priority-cell { display: inline-flex; align-items: center; position: relative; }
    .priority-dot { position: absolute; left: 4px; width: 7px; height: 7px; border-radius: 50%; background: var(--ink-300); pointer-events: none; }
    .priority-cell[data-priority="CRITICAL"] .priority-dot { background: #b91c1c; }
    .priority-cell[data-priority="HIGH"] .priority-dot { background: #ef4444; }
    .priority-cell[data-priority="MEDIUM"] .priority-dot { background: #f59e0b; }
    .priority-cell[data-priority="LOW"] .priority-dot { background: #22c55e; }
    .priority-cell .priority-select { padding-left: 18px; }
    tr.tp-row td:nth-child(5) { white-space: nowrap; }
    .comment-toggle-btn:hover { background: var(--surface-tint); border-color: var(--ink-300); color: var(--ink-900); }
    .comment-count { margin-left: 4px; color: inherit; font-weight: 550; }
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


    tr.tp-row.locked { background: var(--surface-sunken); }
    tr.tp-row.locked .field[data-editable="false"] { cursor: default; color: var(--ink-500); }
    tr.tp-row.locked .field[data-editable="false"]:hover { background: none; }
    .status-label.locked-label { background: var(--surface-tint); color: var(--ink-500); }
    .delete-btn:disabled, .restore-btn:disabled, .comment-delete-btn:disabled,
    .comment-submit-btn:disabled, .comment-input:disabled, .priority-select:disabled {
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
    .review-actions.questions-footer {
      position: sticky;
      bottom: 0;
      z-index: 10;
      margin: 16px -44px -72px;
      border-radius: 0 0 var(--radius-md) var(--radius-md);
      flex-wrap: nowrap;
      justify-content: space-between;
      gap: 14px;
      padding: 16px 48px;
      background: var(--surface);
      border-top: 1px solid var(--line-soft);
    }
    .review-actions.tp-footer { flex-wrap: wrap; }
    .tp-footer-right { display: flex; align-items: center; gap: 8px; }
    .tp-footer .action-notices { flex-basis: 100%; margin-top: 0; }
    .tp-footer .action-notices:not(:has(.action-notice:not(:empty))) { display: none; }
    .questions-progress { display: inline-block; padding: 3px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-strong); font-size: 12.5px; font-weight: 550; }
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
      <div class="stale-banner hidden" id="stale-banner" role="alert">
        <span id="stale-banner-text"></span>
        <button type="button" id="stale-reload-btn">Open latest</button>
      </div>
      <p class="meta-line">${isQuestionsPhase ? "" : `${visibleTestPoints.length} total`}${!isQuestionsPhase && archivedCount > 0 ? `<span class="sep">·</span>Already saved to CawPlan: ${archivedCount}` : ""}<span class="save-hint" id="save-hint"></span></p>
    </div>
    ${isQuestionsPhase
      ? `${renderQuestionsPage(state, pageLocked)}
    <section class="review-actions questions-footer" aria-label="Review actions">
      <span class="questions-progress" id="questions-progress">${answeredCount} / ${(state.open_questions ?? []).length} completed</span>
      ${renderOptimizeBar(state.review_status, QUESTIONS_PAGE_TEXT.submit, !allAnswered)}
    </section>
    ${renderActionNotices(optimizeHint, optimizeHintIsStale)}`
      : `${renderAddTestPointForm(pageLocked, Array.from(groups.keys()).filter((g) => g !== "Ungrouped"))}
    ${groupsHtml}
    <section class="review-actions questions-footer tp-footer" aria-label="Review actions">
      ${renderAddTestPointToggle(pageLocked)}
      <div class="tp-footer-right">
        ${renderOptimizeBar(state.review_status)}
        ${renderSaveToCawPlanBar(pageLocked, visibleTestPoints.length)}
      </div>
      ${renderActionNotices(optimizeHint, optimizeHintIsStale)}
    </section>`}
  </div>
  <script>
    (function () {
      var token = ${JSON.stringify(token)};
      var reviewId = ${JSON.stringify(state.review_id)};
      var lastKnownUpdatedAt = ${JSON.stringify(state.updated_at)};
      var isQuestionsPhase = ${JSON.stringify(isQuestionsPhase)};
      var pageLockedAtLoad = ${JSON.stringify(pageLocked)};
      var IGNORE_ANSWER = ${JSON.stringify(IGNORE_ANSWER)};
      var DONE_CLOSE_HINT = ${JSON.stringify(DONE_CLOSE_HINT[language])};

      function fieldValue(el, fieldName) {
        if (fieldName === "priority") return el.value.trim();
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

      var STALE_NOTE = " Anything typed but not submitted is not included.";
      var STALE_MESSAGES = {
        conflict: "This page is out of date: the review changed (a newer round or another tab). Your last change was not saved." + STALE_NOTE,
        locked: "This review is locked while AI optimizes. Your last change was not saved." + STALE_NOTE,
      };

      // A 409 on a stale or locked page freezes the whole page, so a later edit can never look
      // saved when it was not. Returns true when the 409 was one of these and has been surfaced.
      function showStaleFor409(data) {
        var error = data && data.error;
        var reason = error === "conflict" ? "conflict"
          : typeof error === "string" && error.indexOf("review is locked") === 0 ? "locked"
          : null;
        if (reason) {
          lockPage();
          ["optimize-btn", "save-cawplan-btn"].forEach(function (id) {
            var button = document.getElementById(id);
            if (button) button.disabled = true;
          });
          var banner = document.getElementById("stale-banner");
          var text = document.getElementById("stale-banner-text");
          if (banner && text) {
            text.textContent = STALE_MESSAGES[reason];
            banner.classList.remove("hidden");
          }
          return true;
        }
        if (error === "save_in_progress") {
          setSaveHint("A save to CawPlan is in progress. Your last change was not saved.");
          return true;
        }
        return false;
      }

      // Callers swallow Error("conflict"): the 409 has already been shown to the user.
      function handleApiResponse(res) {
        if (res.status === 409) {
          return res.json().then(function (data) {
            if (showStaleFor409(data)) throw new Error("conflict");
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

      // Question answers have their own serial queue because every Review mutation
      // shares the same updated_at revision. Existing mutations keep their current
      // behavior; this small gate only prevents them from racing an answer save.
      var questionStates = [];
      var questionQueue = [];
      var questionDrainPromise = null;
      var activeNonQuestionMutations = 0;
      var nonQuestionIdleWaiters = [];
      var questionInputsFrozen = false;

      function normalizeQuestionAnswer(value) {
        var trimmed = String(value == null ? "" : value).trim();
        return trimmed || null;
      }

      function waitForNonQuestionIdle() {
        if (activeNonQuestionMutations === 0) return Promise.resolve();
        return new Promise(function (resolve) { nonQuestionIdleWaiters.push(resolve); });
      }

      function finishNonQuestionMutation() {
        activeNonQuestionMutations = Math.max(0, activeNonQuestionMutations - 1);
        if (activeNonQuestionMutations !== 0) return;
        var waiters = nonQuestionIdleWaiters.splice(0);
        waiters.forEach(function (resolve) { resolve(); });
      }

      function runNonQuestionMutation(factory) {
        return flushQuestionAnswers({ requireSuccess: false, waitForNonQuestion: false }).catch(function () { return false; }).then(function () {
          activeNonQuestionMutations += 1;
          var result;
          try {
            result = factory();
          } catch (error) {
            finishNonQuestionMutation();
            throw error;
          }
          return Promise.resolve(result).then(function (value) {
            finishNonQuestionMutation();
            return value;
          }, function (error) {
            finishNonQuestionMutation();
            throw error;
          });
        });
      }

      function setQuestionError(state, message, canRetry) {
        state.error = message || "";
        state.errorEl.classList.toggle("visible", Boolean(message));
        state.errorText.textContent = message || "";
        state.retryBtn.classList.toggle("hidden", !canRetry);
      }

      function cancelQuestionTimers(state) {
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        if (state.retryTimer) clearTimeout(state.retryTimer);
        state.debounceTimer = null;
        state.retryTimer = null;
      }

      function enqueueQuestionSave(state, options) {
        options = options || {};
        if (options.keepalive) state.keepalive = true;
        state.desiredValue = normalizeQuestionAnswer(state.input.value);
        state.dirty = state.forceSave || state.desiredValue !== state.savedValue;
        if (!state.dirty || state.saving || state.queued || state.conflictBlocked) return;
        state.queued = true;
        questionQueue.push(state);
        startQuestionDrain();
      }

      function scheduleQuestionRetry(state) {
        if (state.autoRetryCount >= 1 || state.retryTimer || state.conflictBlocked) return;
        state.autoRetryCount += 1;
        state.retryTimer = setTimeout(function () {
          state.retryTimer = null;
          enqueueQuestionSave(state);
        }, 1500);
      }

      function startQuestionDrain() {
        if (questionDrainPromise) return questionDrainPromise;
        questionDrainPromise = (async function () {
          while (questionQueue.length > 0) {
            var state = questionQueue.shift();
            state.queued = false;
            if (state.conflictBlocked) continue;
            state.desiredValue = normalizeQuestionAnswer(state.input.value);
            state.dirty = state.forceSave || state.desiredValue !== state.savedValue;
            if (!state.dirty) continue;

            await waitForNonQuestionIdle();
            var submittedValue = state.desiredValue;
            var requestRevision = state.retryRevision || lastKnownUpdatedAt;
            var keepalive = state.keepalive;
            state.retryRevision = null;
            state.keepalive = false;
            state.saving = true;
            try {
              var url = "/api/open-questions/" + encodeURIComponent(state.id) + "/answer?token=" +
                encodeURIComponent(token) + "&updated_at=" + encodeURIComponent(requestRevision);
              var res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ answer: submittedValue }),
                keepalive: keepalive,
              });
              var data = await res.json().catch(function () { return {}; });
              if (res.status === 409) {
                state.forceSave = true;
                state.conflictBlocked = true;
                if (data && data.error === "conflict" && typeof data.server_updated_at === "string") {
                  state.conflictRevision = data.server_updated_at;
                  setQuestionError(state, "This answer was not saved because the Review changed. Retry to save your current input.", true);
                } else {
                  state.conflictRevision = null;
                  setQuestionError(state, "This answer was not saved because the Review is locked.", false);
                }
              } else if (!res.ok) {
                state.forceSave = true;
                setQuestionError(state, "Answer save failed. Retry to keep this input.", true);
                scheduleQuestionRetry(state);
              } else {
                if (data && typeof data.updated_at === "string") lastKnownUpdatedAt = data.updated_at;
                state.savedValue = data && data.open_question
                  ? normalizeQuestionAnswer(data.open_question.answer)
                  : submittedValue;
                state.forceSave = false;
                state.conflictBlocked = false;
                state.conflictRevision = null;
                state.autoRetryCount = 0;
                setQuestionError(state, "", false);
              }
            } catch (error) {
              state.forceSave = true;
              setQuestionError(state, "Answer save failed. Retry to keep this input.", true);
              scheduleQuestionRetry(state);
            } finally {
              state.saving = false;
              state.desiredValue = normalizeQuestionAnswer(state.input.value);
              state.dirty = state.forceSave || state.desiredValue !== state.savedValue;
              if (state.dirty && !state.conflictBlocked && !state.retryTimer) enqueueQuestionSave(state);
            }
          }
        })().then(function () {
          questionDrainPromise = null;
          if (questionQueue.length > 0) startQuestionDrain();
        }, function () {
          questionDrainPromise = null;
          if (questionQueue.length > 0) startQuestionDrain();
        });
        return questionDrainPromise;
      }

      function waitForQuestionQueueIdle() {
        var pending = questionDrainPromise;
        if (!pending) return Promise.resolve();
        return pending.then(waitForQuestionQueueIdle);
      }

      function waitForAllMutationActivity() {
        return waitForQuestionQueueIdle().then(waitForNonQuestionIdle).then(function () {
          if (questionDrainPromise || activeNonQuestionMutations > 0) return waitForAllMutationActivity();
        });
      }

      function flushQuestionAnswers(options) {
        options = options || {};
        var hadQuestionActivity = Boolean(questionDrainPromise);
        questionStates.forEach(function (state) {
          cancelQuestionTimers(state);
          state.desiredValue = normalizeQuestionAnswer(state.input.value);
          state.dirty = state.forceSave || state.desiredValue !== state.savedValue;
          if (state.dirty && !state.conflictBlocked) {
            hadQuestionActivity = true;
            enqueueQuestionSave(state, { keepalive: Boolean(options.keepalive) });
          }
        });
        var wait = options.waitForNonQuestion === false
          ? (hadQuestionActivity ? waitForQuestionQueueIdle() : Promise.resolve())
          : waitForAllMutationActivity();
        return wait.then(function () {
          if (!options.requireSuccess) return true;
          return !questionStates.some(function (state) {
            return state.dirty || state.saving || state.queued || Boolean(state.error);
          });
        });
      }

      function hasUnsavedQuestionAnswers() {
        return questionStates.some(function (state) {
          return state.dirty || state.saving || state.queued || Boolean(state.debounceTimer) || Boolean(state.error);
        });
      }

      function setQuestionInputsFrozen(frozen) {
        questionInputsFrozen = frozen;
        questionStates.forEach(function (state) {
          state.input.disabled = frozen;
          state.retryBtn.disabled = frozen;
          if (state.ignoreBtn) state.ignoreBtn.disabled = frozen;
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

        var editBtn = row.querySelector(".edit-btn");
        if (editBtn) editBtn.disabled = status === "deleted" || row.getAttribute("data-locked") === "true";

        var actionCell = row.querySelector(".delete-btn, .restore-btn");
        if (actionCell) {
          if (status === "deleted") {
            actionCell.outerHTML = '<button type="button" class="restore-btn" data-action="restore">Restore</button>';
          } else {
            actionCell.outerHTML = '<button type="button" class="delete-btn" data-action="delete">Delete</button>';
          }
          wireActionButton(row.querySelector(".delete-btn, .restore-btn"));
        }

        var prioritySelect = row.querySelector(".priority-select");
        if (prioritySelect) {
          prioritySelect.disabled = status === "deleted" || row.getAttribute("data-locked") === "true";
        }

      }

      function saveField(row, field, el) {
        var id = row.getAttribute("data-id");
        var body = {};
        body[field] = fieldValue(el, field);
        setSaveHint("Saving…");
        runNonQuestionMutation(function () {
          return fetch(withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + "?token=" + encodeURIComponent(token)), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }).then(handleApiResponse);
        })
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
        runNonQuestionMutation(function () {
          return fetch(withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + suffix + "?token=" + encodeURIComponent(token)), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }).then(handleApiResponse);
        })
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
      }

      function wireCommentDeleteButton(btn, id, list) {
        btn.addEventListener("click", function () {
          var li = btn.closest(".comment-item");
          var commentId = li.getAttribute("data-comment-id");
          setSaveHint("Deleting…");
          runNonQuestionMutation(function () {
            return fetch(
              withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + "/comments/" + encodeURIComponent(commentId) + "?token=" + encodeURIComponent(token)),
              { method: "DELETE" },
            ).then(handleApiResponse);
          })
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
          runNonQuestionMutation(function () {
            return fetch(withUpdatedAt("/api/test-points/" + encodeURIComponent(id) + "/comments?token=" + encodeURIComponent(token)), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: text }),
            }).then(handleApiResponse);
          })
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

      // Continue (the #optimize-btn on the Questions page) is enabled only when every question has an answer.
      function updateContinueState() {
        if (!isQuestionsPhase || pageLockedAtLoad || questionInputsFrozen) return;
        var btn = document.getElementById("optimize-btn");
        if (!btn) return;
        var answered = questionStates.filter(function (state) {
          return normalizeQuestionAnswer(state.input.value) !== null;
        }).length;
        btn.disabled = answered < questionStates.length;
        var progress = document.getElementById("questions-progress");
        if (progress) progress.textContent = answered + " / " + questionStates.length + " completed";
      }

      function autoGrow(el) {
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
      }

      function wireQuestionAnswers() {
        document.querySelectorAll(".question-item").forEach(function (item) {
          var questionId = item.getAttribute("data-question-id");
          var input = item.querySelector(".question-answer-input");
          var errorEl = item.querySelector(".question-save-error");
          var errorText = item.querySelector(".question-save-error-text");
          var retryBtn = item.querySelector(".question-save-retry");
          var ignoreBtn = item.querySelector(".question-ignore-btn");
          if (!questionId || !input || !errorEl || !errorText || !retryBtn) return;
          var initialValue = normalizeQuestionAnswer(input.value);
          var state = {
            id: questionId,
            input: input,
            errorEl: errorEl,
            errorText: errorText,
            retryBtn: retryBtn,
            ignoreBtn: ignoreBtn,
            savedValue: initialValue,
            desiredValue: initialValue,
            dirty: false,
            saving: false,
            queued: false,
            debounceTimer: null,
            retryTimer: null,
            autoRetryCount: 0,
            forceSave: false,
            conflictBlocked: false,
            conflictRevision: null,
            retryRevision: null,
            keepalive: false,
            error: "",
          };
          questionStates.push(state);

          function syncRowState() {
            var value = input.value.trim();
            var ignored = value === IGNORE_ANSWER;
            item.classList.toggle("is-ignored", ignored);
            item.classList.toggle("is-answered", !ignored && value !== "");
            input.readOnly = ignored;
            if (ignoreBtn) ignoreBtn.textContent = ignored ? ignoreBtn.getAttribute("data-undo-label") : ignoreBtn.getAttribute("data-ignore-label");
          }
          syncRowState();
          autoGrow(input);
          input.addEventListener("input", function () {
            autoGrow(input);
            syncRowState();
            updateContinueState();
            state.desiredValue = normalizeQuestionAnswer(input.value);
            state.dirty = state.forceSave || state.desiredValue !== state.savedValue;
            state.autoRetryCount = 0;
            if (state.debounceTimer) clearTimeout(state.debounceTimer);
            if (state.retryTimer) clearTimeout(state.retryTimer);
            state.retryTimer = null;
            if (!state.dirty) {
              state.conflictBlocked = false;
              state.conflictRevision = null;
              state.retryRevision = null;
              setQuestionError(state, "", false);
              return;
            }
            if (state.conflictBlocked || questionInputsFrozen) return;
            state.debounceTimer = setTimeout(function () {
              state.debounceTimer = null;
              enqueueQuestionSave(state);
            }, 650);
          });

          input.addEventListener("blur", function () {
            if (state.debounceTimer) clearTimeout(state.debounceTimer);
            state.debounceTimer = null;
            if (!questionInputsFrozen) enqueueQuestionSave(state);
          });

          if (ignoreBtn) {
            // Ignore is just a canned answer: same input, same answer endpoint, same flush path.
            ignoreBtn.addEventListener("click", function () {
              if (questionInputsFrozen) return;
              var undoing = input.value.trim() === IGNORE_ANSWER;
              input.value = undoing ? "" : IGNORE_ANSWER;
              input.dispatchEvent(new Event("input"));
              if (state.debounceTimer) clearTimeout(state.debounceTimer);
              state.debounceTimer = null;
              enqueueQuestionSave(state);
              if (undoing) input.focus();
            });
          }

          retryBtn.addEventListener("click", function () {
            if (questionInputsFrozen) return;
            cancelQuestionTimers(state);
            state.conflictBlocked = false;
            state.retryRevision = state.conflictRevision;
            state.conflictRevision = null;
            state.autoRetryCount = 0;
            setQuestionError(state, "", false);
            enqueueQuestionSave(state);
          });
        });
      }

      function wireAddTestPointPanel() {
        var toggleBtn = document.getElementById("add-tp-toggle");
        var form = document.getElementById("add-tp-form");
        if (!toggleBtn || !form) return;

        var titleInput = document.getElementById("add-tp-title");
        var groupInput = document.getElementById("add-tp-group");
        var tagsInput = document.getElementById("add-tp-tags");
        var priorityInput = document.getElementById("add-tp-priority");
        var submitBtn = document.getElementById("add-tp-submit");
        var cancelBtn = document.getElementById("add-tp-cancel");
        var closeBtn = document.getElementById("add-tp-close");
        var errorEl = document.getElementById("add-tp-error");
        var defaultPriority = priorityInput.value;
        var submitting = false;

        function isOpen() { return !form.classList.contains("hidden"); }
        function autoGrow() {
          titleInput.style.height = "auto";
          titleInput.style.height = titleInput.scrollHeight + "px";
        }
        function resetForm() {
          titleInput.value = "";
          groupInput.value = "";
          tagsInput.value = "";
          priorityInput.value = defaultPriority;
          errorEl.classList.add("hidden");
          titleInput.style.height = "";
        }
        var groupList = document.getElementById("add-tp-group-list");
        var comboOptions = Array.prototype.slice.call(groupList.querySelectorAll(".tp-combo-option"));
        var activeIndex = -1;
        function hideGroupList() {
          groupList.classList.add("hidden");
          groupInput.setAttribute("aria-expanded", "false");
          activeIndex = -1;
        }
        function visibleOptions() {
          return comboOptions.filter(function (o) { return !o.hidden; });
        }
        function setActive(index) {
          var visible = visibleOptions();
          comboOptions.forEach(function (o) { o.classList.remove("active"); });
          if (!visible.length) { activeIndex = -1; return; }
          activeIndex = (index + visible.length) % visible.length;
          visible[activeIndex].classList.add("active");
          visible[activeIndex].scrollIntoView({ block: "nearest" });
        }
        function showGroupList() {
          var q = groupInput.value.trim().toLowerCase();
          comboOptions.forEach(function (o) {
            o.hidden = q !== "" && o.getAttribute("data-value").toLowerCase().indexOf(q) === -1;
          });
          activeIndex = -1;
          if (!visibleOptions().length) { hideGroupList(); return; }
          groupList.classList.remove("hidden");
          groupInput.setAttribute("aria-expanded", "true");
        }
        function pickGroup(option) {
          groupInput.value = option.getAttribute("data-value");
          hideGroupList();
        }
        groupInput.addEventListener("focus", showGroupList);
        groupInput.addEventListener("input", showGroupList);
        groupInput.addEventListener("keydown", function (event) {
          var open = !groupList.classList.contains("hidden");
          if (event.key === "ArrowDown") { event.preventDefault(); if (!open) showGroupList(); setActive(activeIndex + 1); }
          else if (event.key === "ArrowUp" && open) { event.preventDefault(); setActive(activeIndex - 1); }
          else if (event.key === "Enter" && open && activeIndex >= 0) { event.preventDefault(); pickGroup(visibleOptions()[activeIndex]); }
        });
        // mousedown (not click) so the input keeps focus and selection wins over blur.
        groupList.addEventListener("mousedown", function (event) {
          var option = event.target.closest(".tp-combo-option");
          if (!option) return;
          event.preventDefault();
          pickGroup(option);
        });
        document.addEventListener("mousedown", function (event) {
          if (!event.target.closest("#add-tp-combo")) hideGroupList();
        });

        function openModal() {
          if (toggleBtn.disabled) return;
          form.classList.remove("hidden");
          titleInput.focus({ preventScroll: true });
        }
        function closeModal() {
          if (submitting) return;
          hideGroupList();
          form.classList.add("hidden");
          resetForm();
          toggleBtn.focus({ preventScroll: true });
        }

        toggleBtn.addEventListener("click", openModal);
        cancelBtn.addEventListener("click", function () { closeModal(); });
        closeBtn.addEventListener("click", function () { closeModal(); });
        document.addEventListener("keydown", function (event) {
          if (event.key === "Escape" && isOpen()) {
            event.preventDefault();
            if (!groupList.classList.contains("hidden")) { hideGroupList(); return; }
            closeModal();
          }
        });
        titleInput.addEventListener("input", function () {
          autoGrow();
          if (titleInput.value.trim()) errorEl.classList.add("hidden");
        });

        function submit() {
          var title = titleInput.value.trim();
          if (!title) {
            errorEl.classList.remove("hidden");
            titleInput.focus({ preventScroll: true });
            return;
          }
          var body = {
            title: title,
            group: groupInput.value.trim(),
            tags: tagsInput.value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
            priority: priorityInput.value.trim(),
          };
          submitting = true;
          submitBtn.disabled = true;
          setSaveHint("Saving…");
          runNonQuestionMutation(function () {
            return fetch(withUpdatedAt("/api/test-points?token=" + encodeURIComponent(token)), {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }).then(handleApiResponse);
          })
            .then(function (data) {
              try {
                if (data && data.test_point && data.test_point.id) {
                  sessionStorage.setItem("tp-review-focus-id", data.test_point.id);
                }
              } catch (e) { /* storage unavailable: skip auto-locate */ }
              location.reload();
            })
            .catch(function (err) {
              submitting = false;
              submitBtn.disabled = false;
              if (err && err.message === "conflict") return;
              setSaveHint("Save failed, please retry");
            });
        }

        submitBtn.addEventListener("click", submit);
      }

      // After an add, the page reloads; scroll the new row into view and flash it briefly.
      function focusNewlyAddedRow() {
        var id = null;
        try {
          id = sessionStorage.getItem("tp-review-focus-id");
          sessionStorage.removeItem("tp-review-focus-id");
        } catch (e) { return; }
        if (!id) return;
        var row = document.querySelector('tr.tp-row[data-id="' + id + '"]');
        if (!row) return;
        row.scrollIntoView({ block: "center" });
        row.classList.add("tp-flash");
        setTimeout(function () { row.classList.remove("tp-flash"); }, 2400);
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

      function wirePrioritySelect(el) {
        var row = el.closest(".tp-row");
        el.addEventListener("change", function () {
          if (row.classList.contains("status-deleted") || row.getAttribute("data-locked") === "true") return;
          var cell = el.closest(".priority-cell");
          if (cell) cell.setAttribute("data-priority", el.value);
          saveField(row, "priority", el);
        });
      }

      function wireEditButton(btn) {
        btn.addEventListener("click", function () {
          var row = btn.closest(".tp-row");
          if (row.classList.contains("status-deleted") || row.getAttribute("data-locked") === "true") return;
          // Reuse the inline title editor: a click on the title field starts editing.
          var title = row.querySelector('.field[data-field="title"][data-editable="true"]');
          if (title) title.click();
        });
      }

      function lockRow(row) {
        row.classList.add("locked");
        row.setAttribute("data-locked", "true");

        row.querySelectorAll(".field[data-editable=\\"true\\"]").forEach(function (field) {
          field.setAttribute("data-editable", "false");
        });
        row.querySelectorAll(".priority-select").forEach(function (select) {
          select.setAttribute("data-editable", "false");
          select.disabled = true;
        });

        var titleCell = row.querySelector(".tp-title-cell");
        if (titleCell && !titleCell.querySelector(".locked-label")) {
          var label = document.createElement("span");
          label.className = "status-label locked-label";
          label.textContent = "Locked";
          titleCell.appendChild(label);
        }

        row.querySelectorAll(".edit-btn, .delete-btn, .restore-btn").forEach(function (btn) {
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

        setQuestionInputsFrozen(true);

        var addToggle = document.getElementById("add-tp-toggle");
        if (addToggle) addToggle.disabled = true;
        var addForm = document.getElementById("add-tp-form");
        if (addForm) {
          addForm.querySelectorAll("input, textarea, select, button").forEach(function (el) {
            el.disabled = true;
          });
        }
      }

      function tryCloseTab(hint, extra) {
        try { window.close(); } catch (e) { /* browsers may refuse */ }
        if (hint) hint.textContent = DONE_CLOSE_HINT + (extra ? " " + extra : "");
      }

      function wireOptimizeButton() {
        var btn = document.getElementById("optimize-btn");
        var hint = document.getElementById("optimize-hint");
        if (!btn) return;

        btn.addEventListener("click", function () {
          btn.disabled = true;
          setQuestionInputsFrozen(true);
          if (hint) hint.textContent = "Requesting optimization…";
          flushQuestionAnswers({ requireSuccess: true })
            .then(function (flushed) {
              if (!flushed) throw new Error("question answers were not saved");
              return fetch(withUpdatedAt("/api/optimize?token=" + encodeURIComponent(token)), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}",
              });
            })
            .then(function (res) {
              if (res.status === 409) {
                return res.json().then(function (data) {
                  if (showStaleFor409(data)) throw new Error("conflict");
                  throw new Error("optimize request failed");
                });
              }
              if (!res.ok) throw new Error("optimize request failed");
              return res.json();
            })
            .then(function (data) {
              if (data && data.outcome === "NO_CHANGES") {
                btn.disabled = false;
                setQuestionInputsFrozen(false);
                if (hint) hint.textContent = "No changes to optimize. Make a change first.";
                return;
              }
              lockPage();
              tryCloseTab(hint, "If Chat does not respond, send “Continue optimization” in Chat.");
            })
            .catch(function (err) {
              if (err && err.message === "conflict") return;
              btn.disabled = false;
              setQuestionInputsFrozen(false);
              if (hint) hint.textContent = hasUnsavedQuestionAnswers()
                ? "Save the question answers successfully before optimizing."
                : "Request failed, please retry";
            });
        });
      }

      function wireSaveToCawPlanButton() {
        var btn = document.getElementById("save-cawplan-btn");
        var hint = document.getElementById("save-cawplan-hint");
        if (!btn) return;

        function submit() {
          btn.disabled = true;
          setQuestionInputsFrozen(true);
          if (hint) {
            hint.className = "action-notice save-cawplan-hint";
            hint.textContent = "Saving to CawPlan…";
          }
          flushQuestionAnswers({ requireSuccess: true })
            .then(function (flushed) {
              if (!flushed) throw new Error("Save the question answers successfully before saving to CawPlan.");
              return fetch(withUpdatedAt("/api/save-to-cawplan?token=" + encodeURIComponent(token)), {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}",
              });
            })
            .then(function (res) {
              return res.json().then(function (data) { return { res: res, data: data }; });
            })
            .then(function (result) {
              var res = result.res;
              var data = result.data;
              if (res.status === 409 && showStaleFor409(data)) {
                throw new Error("conflict");
              }
              if (res.status === 409 && data && data.error === "unresolved_feedback") {
                btn.disabled = false;
                setQuestionInputsFrozen(false);
                if (hint) {
                  hint.className = "action-notice save-cawplan-hint save-cawplan-hint-error";
                  hint.textContent = "Comments or answered Questions must be processed by Ask AI before saving.";
                }
                return;
              }
              if (!res.ok) {
                throw new Error((data && data.message) || "save request failed");
              }
              if (data.outcome === "NOOP") {
                if (hint) hint.textContent = "Nothing new to save — every visible test point is already archived.";
                btn.disabled = false;
                setQuestionInputsFrozen(false);
                return;
              }
              lockPage();
              tryCloseTab(hint);
            })
            .catch(function (err) {
              if (err && err.message === "conflict") return;
              btn.disabled = false;
              setQuestionInputsFrozen(false);
              if (hint) {
                hint.className = "action-notice save-cawplan-hint save-cawplan-hint-error";
                hint.textContent = (err && err.message) || "Save failed, please retry";
              }
            });
        }

        btn.addEventListener("click", submit);
      }

      function wireQuestionLifecycleFlush() {
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "hidden") {
            flushQuestionAnswers({ requireSuccess: false, keepalive: true });
          }
        });
        window.addEventListener("pagehide", function () {
          flushQuestionAnswers({ requireSuccess: false, keepalive: true });
        });
        window.addEventListener("beforeunload", function (event) {
          if (!hasUnsavedQuestionAnswers()) return;
          event.preventDefault();
          event.returnValue = "";
        });
      }

      document.querySelectorAll(".field[data-editable=\\"true\\"]").forEach(wireField);
      document.querySelectorAll(".priority-select[data-editable=\\"true\\"]").forEach(wirePrioritySelect);
      document.querySelectorAll(".edit-btn").forEach(wireEditButton);
      document.querySelectorAll(".delete-btn, .restore-btn").forEach(wireActionButton);
      document.querySelectorAll(".comment-toggle-btn").forEach(wireCommentToggle);
      document.querySelectorAll(".ai-status-label").forEach(wireOriginalCompareToggle);
      document.querySelectorAll("tr.comment-row").forEach(wireCommentForm);
      wireQuestionAnswers();
      wireQuestionLifecycleFlush();
      wireAddTestPointPanel();
      focusNewlyAddedRow();
      var staleReloadBtn = document.getElementById("stale-reload-btn");
      if (staleReloadBtn) staleReloadBtn.addEventListener("click", function () { location.reload(); });
      wireOptimizeButton();
      wireSaveToCawPlanButton();
    })();
  </script>
</body>
</html>`;
}
