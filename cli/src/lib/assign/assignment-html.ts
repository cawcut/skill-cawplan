export function assignmentHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CawPlan AI Session Assignment</title>
  <style>
    :root {
      --uBlue-01: hsl(214,100%,95%);
      --uBlue-06: #006EFF;
      --uBlue-07: hsl(214,100%,40%);
      --n-00: #fff;
      --n-02: rgb(246,246,248);
      --n-03: rgb(237,237,240);
      --n-04: rgb(219,220,225);
      --n-09: rgb(107,109,118);
      --n-10: rgb(82,83,90);
      --n-12: rgb(33,33,36);
      --green-01: rgb(235,250,239);
      --green-07: rgb(46,163,80);
      --red-01: rgb(253,235,236);
      --red-06: rgb(240,58,62);
      --red-07: rgb(192,46,50);
      --orange-01: rgb(254,246,233);
      --text-00: rgba(0,0,0,1);
      --text-01: rgba(0,0,0,0.85);
      --text-02: rgba(0,0,0,0.65);
      --text-03: rgba(0,0,0,0.45);
      --text-04: rgba(0,0,0,0.20);
      --bg: #fff;
      --bg-shell: rgb(241,242,244);
      --bg-subtle: rgb(246,246,248);
      --bg-hover: rgb(246,246,248);
      --border-sub: rgb(238,239,241);
      --border: rgb(219,220,225);
      --shadow-superlow: 0 4px 12px 0 rgba(33,33,36,.04), 0 0 1px 0 rgba(33,33,36,.04);
      --r4: 4px;
      --r8: 8px;
      --font: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --fast: 150ms;
      --ease: cubic-bezier(.4,0,.2,1);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font); font-size: 13px; line-height: 20px; color: var(--text-01); background: var(--bg); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-feature-settings: "cv11","ss01"; }
    .app { min-height: 100vh; display: flex; }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .phdr { background: var(--bg); padding: 0 32px; }
    .ptitle { font-size: 19px; font-weight: 600; color: var(--text-00); letter-spacing: -0.01em; line-height: 28px; padding: 20px 0; }
    .pbody { padding: 24px 32px; display: flex; flex-direction: column; gap: 16px; }
    #stats-bar { display: flex; flex-direction: column; gap: 10px; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .kpi { background: var(--bg); padding: 16px 20px 20px; border: 1px solid var(--border-sub); border-radius: var(--r8); }
    .kpi-lbl { font-size: 11px; color: var(--text-03); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 10px; }
    .kpi-val { font-size: 27px; font-weight: 600; color: var(--text-00); letter-spacing: -.02em; line-height: 1; }
    .badge-strip { display: flex; flex-wrap: wrap; gap: 4px; }
    .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; line-height: 16px; white-space: nowrap; }
    .badge-cat-decision { background: #EEF4FF; color: #1E4BD1; }
    .badge-cat-direction { background: #F3EEFF; color: #6B28D3; }
    .badge-cat-correction { background: var(--red-01); color: var(--red-07); }
    .badge-cat-planning { background: var(--green-01); color: var(--green-07); }
    .badge-topic-bug { background: var(--red-01); color: var(--red-07); }
    .badge-topic-security { background: var(--orange-01); color: #c2410c; }
    .badge-topic-new_feature { background: var(--green-01); color: var(--green-07); }
    .badge-topic-ux { background: #cffafe; color: #0e7490; }
    .badge-topic-performance { background: #fef3c7; color: #b45309; }
    .badge-topic-docs { background: var(--n-02); color: var(--n-10); }
    .badge-topic-infra { background: var(--n-02); color: var(--n-10); }
    .badge-topic-improvement { background: #EEF4FF; color: #1E4BD1; }
    .badge-topic-other { background: var(--n-02); color: var(--text-02); }
    .storage-wrap { padding: 4px 0 8px 20px; display: flex; flex-direction: row; align-items: flex-start; gap: 32px; flex-wrap: wrap; }
    .storage-row { display: flex; flex-direction: column; gap: 4px; }
    .storage-ttl { font-size: 10px; color: var(--text-03); text-transform: uppercase; letter-spacing: .08em; }
    .storage-track { display: flex; height: 6px; border-radius: 99px; overflow: hidden; gap: 1px; width: 360px; max-width: 100%; }
    .storage-seg { height: 100%; transition: flex var(--fast) var(--ease); }
    .storage-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 3px; }
    .storage-leg-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-02); }
    .storage-leg-dot { width: 7px; height: 7px; border-radius: 2px; flex-shrink: 0; }
    .sc-decision { background: #1E4BD1; }
    .sc-direction { background: #6B28D3; }
    .sc-correction { background: #C02E32; }
    .sc-planning { background: #2EA350; }
    .sc-other { background: #6B6D76; }
    .sc-bug { background: #E05C6A; }
    .sc-ux { background: #3B82F6; }
    .sc-performance { background: #F59E0B; }
    .sc-security { background: #F97316; }
    .sc-new-feature { background: #10B981; }
    .sc-docs { background: #8B5CF6; }
    .sc-infra { background: #64748B; }
    .sc-improvement { background: #06B6D4; }
    input, select { font-family: var(--font); font-size: 13px; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--r4); background: var(--bg); color: var(--text-01); outline: none; width: 100%; transition: border-color var(--fast) var(--ease), box-shadow var(--fast) var(--ease); }
    input:focus, select:focus { border-color: var(--uBlue-06); box-shadow: 0 0 0 3px rgba(0,111,255,.12); }
    input::placeholder { color: var(--text-04); }
    input:disabled, select:disabled { background: var(--n-02); color: var(--text-03); cursor: not-allowed; }
    button { font-family: var(--font); font-size: 13px; font-weight: 600; height: 32px; padding: 0 14px; border-radius: var(--r4); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; transition: background var(--fast) var(--ease), border-color var(--fast) var(--ease), color var(--fast) var(--ease); }
    #save { background: var(--uBlue-06); color: #fff; border: 1px solid var(--uBlue-06); }
    #save:hover:not(:disabled) { background: hsl(214,100%,46%); border-color: hsl(214,100%,46%); }
    #save:disabled { opacity: .5; cursor: not-allowed; }
    #save.btn-saved { background: var(--green-07); border-color: var(--green-07); }
    #close { background: var(--bg); color: var(--text-01); border: 1px solid var(--border); }
    #close:hover { background: var(--bg-subtle); }
    .table-card { background: var(--bg); border-radius: var(--r8); overflow: hidden; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th { position: sticky; top: 0; background: var(--bg); padding: 9px 16px; text-align: left; font-size: 13px; font-weight: 600; color: var(--text-01); border-bottom: 1px solid var(--border-sub); white-space: nowrap; }
    td { padding: 12px 16px; border-bottom: 1px solid var(--border-sub); vertical-align: top; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: var(--bg-hover); transition: background 80ms; }
    .session-title { font-weight: 400; color: var(--text-00); font-size: 13px; }
    .session-meta { font-size: 13px; color: var(--text-02); margin-top: 2px; }
    .dt-cell { font-size: 12px; color: var(--text-02); white-space: nowrap; vertical-align: middle; padding-right: 20px; }
    .input-cell { overflow: hidden; }
    .human-inputs { margin: 0; padding: 0; list-style: none; max-width: 100%; overflow: hidden; }
    .human-inputs li { font-size: 11px; color: var(--text-02); line-height: 17px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .human-inputs li + li { color: var(--text-03); margin-top: 2px; }
    .lines-cell { white-space: nowrap; vertical-align: middle; }
    .lines-add { color: var(--green-07); font-size: 12px; font-weight: 700; }
    .lines-del { color: var(--red-07); font-size: 12px; font-weight: 700; }
    .num-cell { font-size: 13px; color: var(--text-01); vertical-align: middle; }
    .agent-chip { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: var(--r4); }
    .agent-claude { background: #F0E6DE; color: #C96442; }
    .agent-cursor { background: rgb(24,24,27); color: #fff; }
    .agent-gpt { background: #E8F5EE; color: #1A7F5A; }
    .agent-other { background: var(--n-03); color: var(--text-02); }
    .agent-chip svg { width: 14px; height: 14px; flex-shrink: 0; }
    .tsearch { padding: 10px 16px; border-bottom: 1px solid var(--border-sub); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .tsearch-wrap { position: relative; display: flex; align-items: center; }
    .tsearch-ico { position: absolute; left: 9px; color: var(--text-03); pointer-events: none; display: flex; width: 14px; height: 14px; }
    input.tsearch-input { width: 220px; height: 30px; padding: 0 10px 0 30px; border-radius: 6px; background: var(--bg-subtle); }
    input.tsearch-input:focus { background: var(--bg); }
    input.tsearch-input::placeholder { color: var(--text-03); }
    .filter-group { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    select.filter-select { height: 30px; padding: 0 26px 0 8px; font-size: 13px; width: auto; border: 1px solid var(--border); border-radius: var(--r4); background: var(--bg); cursor: pointer; color: var(--text-01); transition: border-color var(--fast) var(--ease), background var(--fast) var(--ease), color var(--fast) var(--ease); }
    select.filter-select.has-value { border-color: var(--uBlue-06); color: var(--uBlue-06); background: var(--uBlue-01); }
    .unassigned-label { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 13px; color: var(--text-01); user-select: none; }
    input.unassigned-cb { width: 14px; height: 14px; flex-shrink: 0; accent-color: var(--uBlue-06); cursor: pointer; border: none; padding: 0; }
    .required { color: var(--red-06); }
    .field-error { color: var(--red-06); font-size: 11px; margin-top: 4px; }
    tr.invalid-product input.product { border-color: var(--red-06); box-shadow: 0 0 0 3px rgba(240,58,62,.12); }
    .hidden { display: none !important; }
    .muted { color: var(--text-03); }
    .repo-url { margin-top: 6px; }
    .actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding-bottom: 4px; }
    .status { font-size: 13px; color: var(--text-03); }
    .status-error { color: var(--red-06) !important; }
    @media (max-width: 900px) { .pbody, .phdr { padding-left: 16px; padding-right: 16px; } .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
  </style>
</head>
<body>
  <div class="app">
    <main class="main">
      <div class="phdr"><div class="ptitle">CawPlan AI Session Assignment</div></div>
      <div class="pbody">
        <div id="stats-bar"></div>
        <div class="table-card">
          <div class="tsearch">
            <div class="tsearch-wrap">
              <span class="tsearch-ico">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="5.5" cy="5.5" r="4"></circle>
                  <line x1="8.5" y1="8.5" x2="12.5" y2="12.5"></line>
                </svg>
              </span>
              <input class="tsearch-input" type="text" id="search-input" placeholder="Search" />
            </div>
            <div class="filter-group">
              <select class="filter-select" id="filter-category">
                <option value="">Category</option>
                <option value="decision">Decision</option>
                <option value="direction">Direction</option>
                <option value="correction">Correction</option>
                <option value="planning">Planning</option>
                <option value="other">Other</option>
              </select>
              <select class="filter-select" id="filter-topic">
                <option value="">Topic</option>
              </select>
              <select class="filter-select" id="filter-agent">
                <option value="">Agent</option>
              </select>
              <select class="filter-select" id="filter-product">
                <option value="">Product</option>
              </select>
            </div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
              <label class="unassigned-label"><input type="checkbox" id="filter-unassigned" class="unassigned-cb" checked /> Unassigned only</label>
            </div>
          </div>
          <datalist id="product-list"></datalist>
          <div class="table-wrap">
            <table>
              <colgroup>
                <col style="width:88px" />
                <col style="width:98px" />
                <col style="width:140px" />
                <col style="width:180px" />
                <col style="width:82px" />
                <col style="width:52px" />
                <col style="width:76px" />
                <col style="width:140px" />
                <col style="width:260px" />
                <col style="width:120px" />
              </colgroup>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Topic</th>
                  <th>Session</th>
                  <th>Input</th>
                  <th>Lines</th>
                  <th>Files</th>
                  <th>Model</th>
                  <th>Product <span class="required">*</span></th>
                  <th>Repo</th>
                  <th>Date / Time</th>
                </tr>
              </thead>
              <tbody id="rows">
                <tr><td colspan="10" style="text-align:center;padding:40px 16px;color:rgba(0,0,0,.35);">Loading sessions...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="actions">
          <span id="status" class="status">Loading...</span>
          <button id="close" type="button">Close</button>
          <button id="save" type="button">Save assignments</button>
        </div>
      </div>
    </main>
  </div>
  <script type="module">
    const token = new URLSearchParams(location.search).get('token') || '';
    const { findMappingForSession, repoNameFromGitHubUrl } = await import(
      '/assign/matching.js?token=' + encodeURIComponent(token)
    );

    function parseRepoNameFromGitHubUrl(value) {
      try {
        return repoNameFromGitHubUrl(String(value || '').trim());
      } catch {
        return '';
      }
    }

    const api = (path, options = {}) => fetch(path + '?token=' + encodeURIComponent(token), {
      ...options,
      headers: {'content-type': 'application/json', ...(options.headers || {})},
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    });

    let batch = false;
    let reports = [];
    let products = [];
    let mappings = [];
    let showAssignedSessions = false;
    let searchQuery = '';
    let filterCategory = '';
    let filterTopic = '';
    let filterAgent = '';
    let filterProduct = '';

    function isMultiReport() {
      return batch || reports.length > 1;
    }

    function sessionHasProduct(session) {
      return Boolean(String(session && session.product_id != null ? session.product_id : '').trim());
    }

    function shouldShowSession(session) {
      if (!showAssignedSessions && sessionHasProduct(session)) return false;
      return true;
    }

    function updateFilterUi() {
      const btn = document.getElementById('filter-unassigned');
      if (!btn) return;
      btn.checked = !showAssignedSessions;
    }

    function updateSelectState(el) {
      if (!el) return;
      el.classList.toggle('has-value', Boolean(el.value));
    }

    function productLabel(product) {
      return product.product_name || product.name || product.product_id || product.unique_id || '';
    }

    function normalizeProducts(items) {
      return items.map((p) => ({
        product_id: p.product_id || p.unique_id,
        product_name: p.product_name || p.name || p.product_id || p.unique_id,
      })).filter((p) => p.product_id && p.product_name);
    }

    function findProduct(value) {
      const needle = String(value || '').trim().toLowerCase();
      if (!needle) return null;
      return products.find((p) =>
        String(p.product_id).toLowerCase() === needle ||
        String(p.product_name).toLowerCase() === needle
      ) || null;
    }

    function pendingMappingKey(productId, repoName) {
      return productId + '::' + repoName;
    }

    function upsertPendingMapping(product, repoUrl) {
      const repoName = parseRepoNameFromGitHubUrl(repoUrl);
      if (!repoName) return null;
      let mapping = mappings.find((m) => m.product_id === product.product_id && m.repo_name === repoName);
      if (mapping) {
        mapping.repo_url = repoUrl;
        mapping.pending = true;
        return mapping;
      }
      mapping = {
        product_id: product.product_id,
        product_name: product.product_name,
        repo_name: repoName,
        repo_url: repoUrl,
        pending: true,
      };
      mappings.push(mapping);
      return mapping;
    }

    function repoOptions(productId, selectedRepo) {
      const opts = mappings
        .filter((m) => m.product_id === productId && m.repo_name)
        .sort((a, b) => String(a.repo_name).localeCompare(String(b.repo_name)))
        .map((m) => '<option value="' + escapeHtml(m.repo_name) + '"' +
          (m.repo_name === selectedRepo ? ' selected' : '') + '>' +
          escapeHtml(m.repo_url || m.repo_name) + '</option>');
      opts.unshift('<option value="">No repository; assign product only</option>');
      opts.push('<option value="__link__">No repository; link one</option>');
      return opts.join('');
    }

    function selectedRepoForSession(session) {
      if (!session.product_id) return '';
      const mapping = findMappingForSession(
        session,
        mappings.filter((m) => m.product_id === session.product_id)
      );
      return mapping?.repo_name ?? '';
    }

    function updateRepoUrlInput(row) {
      const repo = row.querySelector('.repo');
      const repoUrl = row.querySelector('.repo-url');
      const product = findProduct(row.querySelector('.product').value);
      const productSelected = Boolean(product);
      repo.disabled = !productSelected;
      repoUrl.disabled = !productSelected || repo.value !== '__link__';
      repoUrl.classList.toggle('hidden', !productSelected || repo.value !== '__link__');
      repoUrl.required = productSelected && repo.value === '__link__';
    }

    function refreshRepoOptionsForProduct(productId) {
      document.querySelectorAll('tbody tr').forEach((row) => {
        const product = findProduct(row.querySelector('.product').value);
        if (!product || product.product_id !== productId) return;
        const repo = row.querySelector('.repo');
        const selected = repo.value;
        repo.innerHTML = repoOptions(productId, selected);
        repo.value = selected;
        updateRepoUrlInput(row);
      });
    }

    function addLinkedRepoFromRow(row) {
      const product = findProduct(row.querySelector('.product').value);
      if (!product) return;
      const repoUrl = row.querySelector('.repo-url').value.trim();
      const mapping = upsertPendingMapping(product, repoUrl);
      if (!mapping) return;
      refreshRepoOptionsForProduct(product.product_id);
    }

    function validateProductRow(row) {
      const productInput = row.querySelector('.product');
      const product = findProduct(productInput.value);
      const error = row.querySelector('.product-error');
      const valid = Boolean(product);
      row.classList.toggle('invalid-product', !valid);
      productInput.setCustomValidity(valid ? '' : 'Product is required. Choose a product from the list.');
      error.textContent = valid ? '' : 'Required: choose a product from the list.';
      return valid;
    }

    function validateProducts() {
      const rows = Array.from(document.querySelectorAll('tbody tr')).filter((row) => row.querySelector('.product'));
      const invalid = rows.filter((row) => !validateProductRow(row));
      if (invalid.length > 0) {
        invalid[0].querySelector('.product').reportValidity();
        invalid[0].scrollIntoView({block: 'center', behavior: 'smooth'});
        throw new Error('Product is required for every session.');
      }
    }

    function setRowProduct(row, product) {
      const entry = entryForRow(row);
      const session = entry && entry.report.sessions.find((s) => s.session_id === row.dataset.sessionId);
      const productInput = row.querySelector('.product');
      const repo = row.querySelector('.repo');
      if (!session || !productInput || !repo) return;
      productInput.value = product ? product.product_name : '';
      session.product_id = product ? product.product_id : undefined;
      session.product_name = product ? product.product_name : undefined;
      repo.innerHTML = product ? repoOptions(session.product_id, '') : repoOptions('', '');
      repo.value = '';
      updateRepoUrlInput(row);
      validateProductRow(row);
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function humanInputContent(input) {
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
    }

    function mostCommonHumanInputValue(report, session, field) {
      const counts = new Map();
      for (const input of humanInputsForSession(report, session)) {
        const value = String(input && input[field] || '').trim();
        if (!value) continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      let best = '';
      let bestCount = 0;
      for (const [value, count] of counts) {
        if (count > bestCount) {
          best = value;
          bestCount = count;
        }
      }
      return best;
    }

    function sessionCategory(report, session) {
      return mostCommonHumanInputValue(report, session, 'category');
    }

    function sessionTopic(report, session) {
      return mostCommonHumanInputValue(report, session, 'topic');
    }

    function sessionModelText(session) {
      const models = Array.isArray(session.models) && session.models.length
        ? session.models
        : Object.keys(session.model_usage || {});
      return models[0] || '';
    }

    function agentChip(agent) {
      const value = String(agent || '');
      const lower = value.toLowerCase();
      if (lower.includes('claude')) {
        return '<span class="agent-chip agent-claude" title="' + escapeHtml(value || 'Claude') + '"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 1.5l1.4 3.1L11.5 6 8.4 7.4 7 10.5 5.6 7.4 2.5 6l3.1-1.4L7 1.5z"/></svg></span>';
      }
      if (lower.includes('cursor')) {
        return '<span class="agent-chip agent-cursor" title="' + escapeHtml(value || 'Cursor') + '"><svg viewBox="0 0 14 14" fill="currentColor"><path d="M2.2 1.6l9.7 5.1-4.1 1.1-1.9 3.8L2.2 1.6z"/></svg></span>';
      }
      if (lower.includes('gpt') || lower.includes('codex')) {
        return '<span class="agent-chip agent-gpt" title="' + escapeHtml(value || 'GPT') + '"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="4" width="10" height="7" rx="1.5"/><path d="M5 4V3a2 2 0 014 0v1"/></svg></span>';
      }
      return '<span class="agent-chip agent-other" title="' + escapeHtml(value || 'Agent') + '"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M5.5 7h3"/></svg></span>';
    }

    function sessionLinesText(session) {
      const added = Number(session.files_added || 0);
      const deleted = Number(session.files_deleted || 0);
      if (!added && !deleted) return '<span class="muted">—</span>';
      return '<span class="lines-add">+' + added + '</span> <span class="lines-del">-' + deleted + '</span>';
    }

    function sessionDateTimeText(session) {
      const start = session.time_range && session.time_range.start;
      if (start) {
        const d = new Date(start);
        if (!Number.isNaN(d.getTime())) {
          return d.toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) + ', ' +
            d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
        }
      }
      return (session.time_range && session.time_range.display) || '';
    }

    function humanInputsHtml(report, session) {
      const inputs = humanInputsForSession(report, session)
        .filter((input) => humanInputContent(input))
        .slice(0, 3);
      if (inputs.length === 0) return '<span class="muted">No human inputs</span>';
      return '<ol class="human-inputs">' + inputs.map((input) => {
        const text = escapeHtml(truncateHumanInput(humanInputContent(input)));
        return '<li>' + text + '</li>';
      }).join('') + '</ol>';
    }

    function sessionStartMs(session) {
      const value = session.time_range && session.time_range.start;
      const ms = value ? Date.parse(value) : NaN;
      return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
    }

    function sessionCost(session) {
      if (typeof session.session_cost === 'number') return session.session_cost;
      const buckets = Array.isArray(session.usage_breakdown) ? session.usage_breakdown : [];
      return buckets.reduce((sum, bucket) => sum + (typeof bucket.cost === 'number' ? bucket.cost : 0), 0);
    }

    function sessionCostText(session) {
      const cost = sessionCost(session);
      return cost > 0 ? '$' + cost.toFixed(2) : 'Cost unknown';
    }

    function rowMatchesFilters(entry, session) {
      if (!shouldShowSession(session)) return false;
      const category = sessionCategory(entry.report, session);
      const topic = sessionTopic(entry.report, session);
      const product = products.find((p) => p.product_id === session.product_id);
      const productName = product ? product.product_name : (session.product_name || '');
      if (filterCategory && category !== filterCategory) return false;
      if (filterTopic && topic !== filterTopic) return false;
      if (filterAgent && session.agent !== filterAgent) return false;
      if (filterProduct && session.product_id !== filterProduct) return false;
      if (searchQuery) {
        const haystack = [
          session.session_title,
          session.session_name,
          session.session_id,
          session.agent,
          session.project,
          productName,
          category,
          topic,
          sessionModelText(session),
          humanInputsForSession(entry.report, session).map(humanInputContent).join(' '),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(searchQuery)) return false;
      }
      return true;
    }

    function rowEntries() {
      return reports.flatMap((entry) => {
        const sessions = [...entry.report.sessions].sort((a, b) => sessionStartMs(a) - sessionStartMs(b));
        return sessions
          .filter((session) => rowMatchesFilters(entry, session))
          .map((session) => ({...entry, session}));
      });
    }

    function entryForRow(row) {
      return reports.find((entry) => entry.file === row.dataset.file);
    }

    function renderStats() {
      const el = document.getElementById('stats-bar');
      if (!el) return;
      const allSessions = reports.flatMap((r) => Array.isArray(r.report.sessions) ? r.report.sessions : []);
      const total = allSessions.length;
      const assigned = allSessions.filter((s) => sessionHasProduct(s)).length;
      const unassigned = total - assigned;
      let cost = 0;
      for (const r of reports) {
        const costMap = r.report && r.report.totals && r.report.totals.cost;
        if (costMap && typeof costMap === 'object') {
          const val = typeof costMap['USD'] === 'number' ? costMap['USD'] : Object.values(costMap).find((v) => typeof v === 'number');
          if (typeof val === 'number') cost += val;
        }
      }
      const allInputs = reports.flatMap((r) => Array.isArray(r.report.human_inputs) ? r.report.human_inputs : []);
      const catCounts = {};
      const topicCounts = {};
      for (const input of allInputs) {
        if (input.category) catCounts[input.category] = (catCounts[input.category] || 0) + 1;
        if (input.topic) topicCounts[input.topic] = (topicCounts[input.topic] || 0) + 1;
      }
      function storageClass(value) {
        return 'sc-' + String(value).replace(/_/g, '-');
      }
      function storageRow(title, counts, preferredOrder) {
        const ordered = Object.entries(counts)
          .filter(([, n]) => n > 0)
          .sort((a, b) => {
            const ai = preferredOrder.indexOf(a[0]);
            const bi = preferredOrder.indexOf(b[0]);
            if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            return b[1] - a[1];
          });
        const sum = ordered.reduce((n, [, count]) => n + count, 0);
        if (!sum) return '';
        return '<div class="storage-row">' +
          '<div class="storage-ttl">' + escapeHtml(title) + '</div>' +
          '<div class="storage-track">' + ordered.map(([name, count]) =>
            '<div class="storage-seg ' + storageClass(name) + '" style="flex:' + count + '" title="' + escapeHtml(name + ' ' + count) + '"></div>'
          ).join('') + '</div>' +
          '<div class="storage-legend">' + ordered.map(([name, count]) =>
            '<span class="storage-leg-item"><span class="storage-leg-dot ' + storageClass(name) + '"></span>' + escapeHtml(name) + ' <span>' + count + '</span></span>'
          ).join('') + '</div>' +
        '</div>';
      }
      const storageRows = [
        storageRow('Category', catCounts, ['decision', 'planning', 'correction', 'direction', 'other']),
        storageRow('Topic', topicCounts, ['other', 'ux', 'bug', 'docs', 'new_feature', 'infra', 'performance', 'security', 'improvement']),
      ].filter(Boolean);
      el.innerHTML =
        '<div class="kpi-grid">' +
          '<div class="kpi"><div class="kpi-lbl">Sessions</div><div class="kpi-val">' + total + '</div></div>' +
          '<div class="kpi"><div class="kpi-lbl">Assigned</div><div class="kpi-val">' + assigned + '</div></div>' +
          '<div class="kpi"><div class="kpi-lbl">Unassigned</div><div class="kpi-val">' + unassigned + '</div></div>' +
          '<div class="kpi"><div class="kpi-lbl">Total Cost (USD)</div><div class="kpi-val">$' + cost.toFixed(2) + '</div></div>' +
        '</div>' +
        (storageRows.length ? '<div class="storage-wrap">' + storageRows.join('') + '</div>' : '');
    }

    function populateFilters() {
      const allSessions = reports.flatMap((r) => Array.isArray(r.report.sessions) ? r.report.sessions.map((s) => ({report: r.report, session: s})) : []);
      const topics = [...new Set(allSessions.map(({report, session}) => sessionTopic(report, session)).filter(Boolean))].sort();
      const agents = [...new Set(allSessions.map(({session}) => session.agent).filter(Boolean))].sort();
      const mappedProducts = [...new Map(products.map((p) => [p.product_id, p])).values()]
        .sort((a, b) => a.product_name.localeCompare(b.product_name));
      document.getElementById('filter-topic').innerHTML = '<option value="">Topic</option>' + topics.map((t) => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>').join('');
      document.getElementById('filter-agent').innerHTML = '<option value="">Agent</option>' + agents.map((a) => '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>').join('');
      document.getElementById('filter-product').innerHTML = '<option value="">Product</option>' + mappedProducts.map((p) => '<option value="' + escapeHtml(p.product_id) + '">' + escapeHtml(p.product_name) + '</option>').join('');
      document.getElementById('filter-topic').value = filterTopic;
      document.getElementById('filter-agent').value = filterAgent;
      document.getElementById('filter-product').value = filterProduct;
      document.querySelectorAll('.filter-select').forEach(updateSelectState);
    }

    function render() {
      renderStats();
      const productList = document.getElementById('product-list');
      productList.innerHTML = products.map((p) => '<option value="' + escapeHtml(p.product_name) + '"></option>').join('');
      populateFilters();
      const tbody = document.getElementById('rows');
      const entries = rowEntries();
      if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:40px 16px;"><span class="muted">No sessions match the current filters.</span></td></tr>';
      } else {
      tbody.innerHTML = entries.map(({file, date, report, session: s}) => {
        const title = s.session_title || s.session_name || s.session_id;
        const currentProduct = products.find((p) => p.product_id === s.product_id);
        const productValue = currentProduct ? currentProduct.product_name : (s.product_name || '');
        const selectedRepo = selectedRepoForSession(s);
        const category = sessionCategory(report, s);
        const topic = sessionTopic(report, s);
        return '<tr data-file="' + escapeHtml(file) + '" data-session-id="' + escapeHtml(s.session_id) + '">' +
          '<td>' + (category ? '<span class="badge badge-cat-' + escapeHtml(category) + '">' + escapeHtml(category) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (topic ? '<span class="badge badge-topic-' + escapeHtml(topic) + '">' + escapeHtml(topic) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td><div class="session-title">' + escapeHtml(title) + '</div></td>' +
          '<td class="input-cell">' + humanInputsHtml(report, s) + '</td>' +
          '<td class="lines-cell">' + sessionLinesText(s) + '</td>' +
          '<td class="num-cell">' + escapeHtml(s.files_changed ?? 0) + '</td>' +
          '<td>' + agentChip(s.agent) + '</td>' +
          '<td><input class="product" list="product-list" value="' + escapeHtml(productValue) + '" placeholder="Search product" required />' +
          '<div class="product-error field-error"></div></td>' +
          '<td><select class="repo">' + repoOptions(s.product_id, selectedRepo) + '</select>' +
          '<input class="repo-url hidden" type="url" placeholder="https://github.com/owner/repo" pattern="https://github\\.com/[^/]+/[^/]+" /></td>' +
          '<td class="dt-cell">' + escapeHtml(sessionDateTimeText(s)) + '</td>' +
          '</tr>';
      }).join('');
      }
      document.querySelectorAll('.product').forEach((el) => {
        el.addEventListener('change', () => {
          const tr = el.closest('tr');
          setRowProduct(tr, findProduct(el.value));
        });
      });
      document.querySelectorAll('.repo').forEach((el) => {
        const tr = el.closest('tr');
        updateRepoUrlInput(tr);
        el.addEventListener('change', () => updateRepoUrlInput(tr));
      });
      document.querySelectorAll('.repo-url').forEach((el) => {
        const tr = el.closest('tr');
        el.addEventListener('change', () => addLinkedRepoFromRow(tr));
        el.addEventListener('blur', () => addLinkedRepoFromRow(tr));
      });
    }

    async function load() {
      const [reportData, productData, mappingData] = await Promise.all([
        api('/api/report'),
        api('/api/products'),
        api('/api/product-repos'),
      ]);
      batch = Boolean(reportData.batch);
      reports = Array.isArray(reportData.reports)
        ? reportData.reports
        : [{file: reportData.file || '', date: reportData.report.date, report: reportData.report}];
      products = normalizeProducts(productData.products || []);
      mappings = mappingData.mappings || [];
      showAssignedSessions = false;
      updateFilterUi();
      render();
      document.getElementById('status').textContent = isMultiReport() ? 'Ready: ' + reports.length + ' report(s)' : 'Ready';
      document.getElementById('search-input').addEventListener('input', (e) => {
        searchQuery = String(e.target.value || '').trim().toLowerCase();
        render();
      });
      document.getElementById('filter-category').addEventListener('change', (e) => {
        filterCategory = String(e.target.value || '');
        updateSelectState(e.target);
        render();
      });
      document.getElementById('filter-topic').addEventListener('change', (e) => {
        filterTopic = String(e.target.value || '');
        updateSelectState(e.target);
        render();
      });
      document.getElementById('filter-agent').addEventListener('change', (e) => {
        filterAgent = String(e.target.value || '');
        updateSelectState(e.target);
        render();
      });
      document.getElementById('filter-product').addEventListener('change', (e) => {
        filterProduct = String(e.target.value || '');
        updateSelectState(e.target);
        render();
      });
      document.getElementById('filter-unassigned').addEventListener('click', () => {
        showAssignedSessions = !document.getElementById('filter-unassigned').checked;
        updateFilterUi();
        render();
      });
    }

    async function save() {
      const saveBtn = document.getElementById('save');
      const statusEl = document.getElementById('status');
      try {
        validateProducts();
      } catch (e) {
        statusEl.textContent = e.message;
        statusEl.className = 'status status-error';
        return;
      }
      const assignments = [];
      const pendingMappingsToCreate = new Set();
      for (const tr of document.querySelectorAll('tbody tr')) {
        const sessionId = tr.dataset.sessionId;
        const product = findProduct(tr.querySelector('.product').value);
        if (!product) {
          const title = tr.querySelector('.session-title').textContent || sessionId;
          statusEl.textContent = 'Product is required for session: ' + title;
          statusEl.className = 'status status-error';
          return;
        }
        const repoValue = tr.querySelector('.repo').value;
        let repoUrl;
        let linkedRepoName;
        if (repoValue === '__link__') {
          repoUrl = tr.querySelector('.repo-url').value.trim();
          if (!repoUrl) {
            statusEl.textContent = 'GitHub repository URL is required when linking a repository.';
            statusEl.className = 'status status-error';
            return;
          }
          linkedRepoName = parseRepoNameFromGitHubUrl(repoUrl);
          if (!linkedRepoName) {
            statusEl.textContent = 'GitHub repository URL must be in the format https://github.com/owner/repo.';
            statusEl.className = 'status status-error';
            return;
          }
        }
        const mapping = mappings.find((m) => m.product_id === product.product_id && m.repo_name === repoValue);
        const createKey = repoValue === '__link__' && linkedRepoName
          ? pendingMappingKey(product.product_id, linkedRepoName)
          : mapping && mapping.pending
            ? pendingMappingKey(mapping.product_id, mapping.repo_name)
            : '';
        const createMapping = Boolean(createKey && !pendingMappingsToCreate.has(createKey));
        if (createMapping) pendingMappingsToCreate.add(createKey);
        assignments.push({
          file: tr.dataset.file,
          session_id: sessionId,
          product_id: product.product_id,
          product_name: product.product_name,
          repo_name: mapping ? mapping.repo_name : linkedRepoName,
          repo_url: repoUrl || (mapping ? mapping.repo_url : undefined),
          create_mapping: createMapping,
        });
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      saveBtn.classList.remove('btn-saved');
      statusEl.textContent = 'Saving...';
      statusEl.className = 'status';
      try {
        const result = await api('/api/assignments', {method: 'POST', body: JSON.stringify({assignments})});
        const fileList = (result.files || [result.file]).join(', ');
        saveBtn.textContent = 'Saved ✓';
        saveBtn.classList.add('btn-saved');
        statusEl.textContent = 'Saved ' + result.assigned_sessions + ' session(s) to ' + fileList;
        statusEl.className = 'status';
        setTimeout(() => {
          saveBtn.textContent = 'Save assignments';
          saveBtn.classList.remove('btn-saved');
          saveBtn.disabled = false;
        }, 2000);
      } catch (e) {
        saveBtn.textContent = 'Save assignments';
        saveBtn.classList.remove('btn-saved');
        saveBtn.disabled = false;
        statusEl.textContent = e.message;
        statusEl.className = 'status status-error';
      }
    }

    document.getElementById('save').addEventListener('click', () => save());
    document.getElementById('close').addEventListener('click', () => api('/api/close', {method: 'POST'}).then(() => window.close()).catch((e) => alert(e.message)));
    load().catch((e) => document.getElementById('status').textContent = e.message);
  </script>
</body>
</html>`;
}
