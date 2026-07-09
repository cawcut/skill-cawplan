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
    .models-cell { font-size: 12px; color: var(--text-02); vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agent-cell { font-size: 12px; color: var(--text-02); vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tickets-cell { font-size: 12px; color: var(--text-02); vertical-align: middle; overflow: visible; }
    .ticket-picker { position: relative; min-width: 180px; }
    .ticket-trigger { min-height: 32px; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 26px 4px 6px; border: 1px solid var(--border); border-radius: var(--r4); background: var(--bg); cursor: pointer; position: relative; }
    .ticket-trigger::after { content: "▾"; position: absolute; right: 8px; top: 5px; color: var(--text-03); font-size: 12px; }
    .ticket-trigger:focus { border-color: var(--uBlue-06); box-shadow: 0 0 0 3px rgba(0,111,255,.12); outline: none; }
    .ticket-picker.disabled .ticket-trigger { background: var(--n-02); color: var(--text-03); cursor: not-allowed; }
    .ticket-picker.disabled .ticket-trigger::after { color: var(--text-04); }
    .ticket-picker.disabled .ticket-tag { background: var(--n-03); color: var(--text-03); }
    .ticket-picker.disabled .ticket-remove { color: var(--text-04); cursor: not-allowed; }
    .ticket-tag { display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--uBlue-01); color: var(--uBlue-07); font-size: 11px; font-weight: 600; }
    .ticket-remove { border: 0; background: transparent; color: var(--uBlue-07); width: 14px; height: 14px; padding: 0; font-size: 12px; line-height: 14px; justify-content: center; }
    .ticket-placeholder { color: var(--text-03); font-size: 12px; }
    .ticket-menu { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; right: 0; min-width: 220px; padding: 8px; border: 1px solid var(--border); border-radius: var(--r8); background: var(--bg); box-shadow: var(--shadow-superlow); }
    .ticket-options { max-height: 144px; overflow: auto; display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .ticket-option { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: var(--r4); color: var(--text-01); cursor: pointer; }
    .ticket-option:hover { background: var(--bg-subtle); }
    .ticket-option input { width: 14px; height: 14px; padding: 0; flex-shrink: 0; }
    .ticket-empty { color: var(--text-03); font-size: 12px; padding: 4px 6px; }
    input.ticket-add { height: 28px; font-size: 12px; }
    .model-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; vertical-align: middle; }
    .model-icon img { width: 24px; height: 24px; display: block; border-radius: 6px; }
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
    .repo-field { display: flex; flex-direction: column; gap: 6px; }
    select.repo { display: none; }
    .repo-picker { position: relative; }
    .repo-trigger { width: 100%; height: 32px; min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--r4); background: var(--bg); color: var(--text-01); cursor: pointer; font-size: 13px; font-weight: 400; line-height: 30px; text-align: left; }
    .repo-trigger:hover:not(:disabled) { border-color: var(--border); background: var(--bg); }
    .repo-trigger:focus { border-color: var(--uBlue-06); background: var(--bg); box-shadow: 0 0 0 3px rgba(0,111,255,.12); outline: none; }
    .repo-trigger:disabled { background: var(--bg); color: var(--text-03); cursor: not-allowed; }
    .repo-trigger-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-trigger-arrow { color: var(--text-03); flex-shrink: 0; }
    .repo-menu { position: absolute; z-index: 25; top: calc(100% + 4px); left: 0; right: 0; min-width: 260px; max-height: 224px; overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: var(--r8); background: var(--bg); box-shadow: var(--shadow-superlow); }
    .repo-option { width: 100%; min-height: 30px; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border: 0; border-radius: var(--r4); background: transparent; color: var(--text-01); font-size: 12px; font-weight: 400; text-align: left; }
    .repo-option:hover { background: var(--bg-subtle); }
    .repo-option.selected { background: var(--uBlue-01); color: var(--uBlue-07); }
    .repo-option-check { width: 14px; color: var(--uBlue-06); flex-shrink: 0; }
    .repo-option-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .repo-url { height: 30px; border-radius: 6px; background: var(--bg-subtle); font-size: 12px; }
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
              <select class="filter-select" id="filter-agent">
                <option value="">Agent</option>
              </select>
              <select class="filter-select" id="filter-product">
                <option value="">Product</option>
              </select>
            </div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:8px;">
              <label class="unassigned-label"><input type="checkbox" id="filter-unassigned" class="unassigned-cb" /> Unassigned product</label>
            </div>
          </div>
          <datalist id="product-list"></datalist>
          <div class="table-wrap">
            <table>
              <colgroup>
                <col style="width:140px" />
                <col style="width:180px" />
                <col style="width:82px" />
                <col style="width:52px" />
                <col style="width:76px" />
                <col style="width:140px" />
                <col style="width:140px" />
                <col style="width:260px" />
                <col style="width:120px" />
                <col style="width:120px" />
              </colgroup>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Input</th>
                  <th>Lines</th>
                  <th>Files</th>
                  <th>Agent</th>
                  <th>Models</th>
                  <th>Product <span class="required">*</span></th>
                  <th>Repo</th>
                  <th>Tickets</th>
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
    const MODEL_ICON_PATHS = {
      gpt: '/assets/model-gpt.png',
      claude: '/assets/model-claude.png',
      cursor: '/assets/model-cursor.png',
    };

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

    function repoOptionItems(productId) {
      const items = mappings
        .filter((m) => m.product_id === productId && m.repo_name)
        .sort((a, b) => String(a.repo_name).localeCompare(String(b.repo_name)))
        .map((m) => ({
          value: m.repo_name,
          label: m.repo_url || m.repo_name,
        }));
      items.unshift({value: '', label: 'No repository; assign product only'});
      items.push({value: '__link__', label: 'No repository; link one'});
      return items;
    }

    function repoLabel(productId, value) {
      return (repoOptionItems(productId).find((item) => item.value === value) || repoOptionItems(productId)[0]).label;
    }

    function repoPickerHtml(productId, selectedRepo) {
      const selected = selectedRepo || '';
      const label = repoLabel(productId, selected);
      const options = repoOptionItems(productId).map((item) =>
        '<button class="repo-option' + (item.value === selected ? ' selected' : '') + '" type="button" data-value="' + escapeHtml(item.value) + '">' +
          '<span class="repo-option-check">' + (item.value === selected ? '✓' : '') + '</span>' +
          '<span class="repo-option-label">' + escapeHtml(item.label) + '</span>' +
        '</button>'
      ).join('');
      return '<div class="repo-picker">' +
        '<button class="repo-trigger" type="button">' +
          '<span class="repo-trigger-label">' + escapeHtml(label) + '</span>' +
          '<span class="repo-trigger-arrow">▾</span>' +
        '</button>' +
        '<div class="repo-menu hidden">' + options + '</div>' +
      '</div>';
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
      syncRepoPicker(row);
      updateTicketPickerState(row);
    }

    function updateTicketPickerState(row) {
      const picker = row.querySelector('.ticket-picker');
      if (!picker) return;
      const productSelected = Boolean(findProduct(row.querySelector('.product').value));
      picker.classList.toggle('disabled', !productSelected);
      picker.querySelector('.ticket-trigger').setAttribute('aria-disabled', String(!productSelected));
      picker.querySelector('.ticket-trigger').tabIndex = productSelected ? 0 : -1;
      picker.querySelectorAll('.ticket-option-cb, .ticket-add').forEach((input) => {
        input.disabled = !productSelected;
      });
      if (!productSelected) setTicketMenuOpen(picker, false);
    }

    function syncRepoPicker(row) {
      const repo = row.querySelector('.repo');
      const picker = row.querySelector('.repo-picker');
      const product = findProduct(row.querySelector('.product').value);
      if (!repo || !picker) return;
      const productId = product ? product.product_id : '';
      const selected = repo.value || '';
      const label = repoLabel(productId, selected);
      const trigger = picker.querySelector('.repo-trigger');
      trigger.disabled = repo.disabled;
      picker.querySelector('.repo-trigger-label').textContent = label;
      picker.querySelector('.repo-menu').innerHTML = repoOptionItems(productId).map((item) =>
        '<button class="repo-option' + (item.value === selected ? ' selected' : '') + '" type="button" data-value="' + escapeHtml(item.value) + '">' +
          '<span class="repo-option-check">' + (item.value === selected ? '✓' : '') + '</span>' +
          '<span class="repo-option-label">' + escapeHtml(item.label) + '</span>' +
        '</button>'
      ).join('');
    }

    function setRepoMenuOpen(picker, open) {
      picker.querySelector('.repo-menu').classList.toggle('hidden', !open);
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

    function sessionModels(session) {
      const models = Array.isArray(session.models) ? session.models : [];
      return [...new Set(models.filter(Boolean).map(String))];
    }

    function sessionModelsText(session) {
      const models = sessionModels(session);
      return [...new Set(models.filter(Boolean))].join(', ');
    }

    function modelIconKind(model) {
      const value = String(model || '').toLowerCase();
      if (value.includes('claude')) return 'claude';
      if (value.includes('gpt')) return 'gpt';
      if (value.includes('default') || value.includes('composer')) return 'cursor';
      return '';
    }

    function modelIcon(kind, title) {
      if (MODEL_ICON_PATHS[kind]) {
        return '<span class="model-icon" title="' + escapeHtml(title) + '"><img src="' + MODEL_ICON_PATHS[kind] + '?token=' + encodeURIComponent(token) + '" alt="' + escapeHtml(title) + '" /></span>';
      }
      return '';
    }

    function sessionModelsHtml(session) {
      const models = sessionModels(session);
      if (models.length === 0) return '<span class="muted">—</span>';
      return models.map((model) => {
        const kind = modelIconKind(model);
        return kind ? modelIcon(kind, model) : '<span>' + escapeHtml(model) + '</span>';
      }).join(' ');
    }

    function sessionTickets(session) {
      const displayIds = Array.isArray(session.ticket_display_ids) ? session.ticket_display_ids : [];
      return [...new Set(displayIds.filter(Boolean).map(String))];
    }

    function sessionTicketsText(session) {
      return sessionTickets(session).join(', ');
    }

    function allTicketDisplayIds() {
      const ids = reports.flatMap((entry) => {
        const sessions = Array.isArray(entry.report.sessions) ? entry.report.sessions : [];
        return sessions.flatMap((session) => Array.isArray(session.ticket_display_ids) ? session.ticket_display_ids : []);
      });
      return [...new Set(ids.filter(Boolean).map((item) => String(item).trim().toUpperCase()).filter(Boolean))].sort();
    }

    function ticketDisplayIdFromInput(value) {
      const trimmed = String(value || '').trim();
      const urlMatch = /https?:\\/\\/[^\\s/]+\\/issue\\/([A-Za-z]+-\\d+)/i.exec(trimmed);
      if (urlMatch && urlMatch[1]) return urlMatch[1].toUpperCase();
      const displayMatch = /^[A-Za-z][A-Za-z0-9]+-\\d+$/.exec(trimmed);
      return displayMatch ? trimmed.toUpperCase() : '';
    }

    function ticketOptionRows(session) {
      const selected = new Set(sessionTickets(session).map((item) => String(item).trim().toUpperCase()).filter(Boolean));
      const options = [...new Set([...allTicketDisplayIds(), ...selected])].sort();
      if (options.length === 0) return '<div class="ticket-empty">No tickets yet</div>';
      return options.map((ticket) =>
        '<label class="ticket-option">' +
          '<input class="ticket-option-cb" type="checkbox" value="' + escapeHtml(ticket) + '"' + (selected.has(ticket) ? ' checked' : '') + ' />' +
          '<span>' + escapeHtml(ticket) + '</span>' +
        '</label>'
      ).join('');
    }

    function ticketTagsHtml(session) {
      const tickets = sessionTickets(session);
      if (tickets.length === 0) return '<span class="ticket-placeholder">Select tickets</span>';
      return tickets.map((ticket) =>
        '<span class="ticket-tag" data-ticket="' + escapeHtml(ticket) + '">' +
          escapeHtml(ticket) +
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

    function selectedTicketDisplayIds(picker) {
      if (!picker) return [];
      return [...new Set(Array.from(picker.querySelectorAll('.ticket-option-cb:checked') || [])
        .map((option) => String(option.value || '').trim().toUpperCase())
        .filter(Boolean))];
    }

    function renderTicketTags(picker) {
      const selected = selectedTicketDisplayIds(picker);
      const trigger = picker.querySelector('.ticket-trigger');
      trigger.innerHTML = selected.length
        ? selected.map((ticket) =>
          '<span class="ticket-tag" data-ticket="' + escapeHtml(ticket) + '">' +
            escapeHtml(ticket) +
            '<button class="ticket-remove" type="button" data-ticket="' + escapeHtml(ticket) + '" aria-label="Remove ' + escapeHtml(ticket) + '">×</button>' +
          '</span>'
        ).join('')
        : '<span class="ticket-placeholder">Select tickets</span>';
    }

    function addTicketOption(picker, value) {
      const ticket = ticketDisplayIdFromInput(value);
      if (!ticket) return false;
      const existing = Array.from(picker.querySelectorAll('.ticket-option-cb') || []).find((option) => option.value === ticket);
      if (existing) {
        existing.checked = true;
        renderTicketTags(picker);
        return true;
      }
      const options = picker.querySelector('.ticket-options');
      const empty = options.querySelector('.ticket-empty');
      if (empty) empty.remove();
      const label = document.createElement('label');
      label.className = 'ticket-option';
      label.innerHTML = '<input class="ticket-option-cb" type="checkbox" value="' + escapeHtml(ticket) + '" checked />' +
        '<span>' + escapeHtml(ticket) + '</span>';
      options.appendChild(label);
      renderTicketTags(picker);
      return true;
    }

    function syncRowTickets(row) {
      const entry = entryForRow(row);
      const session = entry && entry.report.sessions.find((s) => s.session_id === row.dataset.sessionId);
      const picker = row.querySelector('.ticket-picker');
      if (session && picker) session.ticket_display_ids = selectedTicketDisplayIds(picker);
    }

    function addTicketFromRow(row) {
      const input = row.querySelector('.ticket-add');
      const picker = row.querySelector('.ticket-picker');
      if (!input || !picker) return;
      if (picker.classList.contains('disabled')) return;
      if (addTicketOption(picker, input.value)) {
        input.value = '';
        syncRowTickets(row);
      }
    }

    function setTicketMenuOpen(picker, open) {
      picker.querySelector('.ticket-menu').classList.toggle('hidden', !open);
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
      const product = products.find((p) => p.product_id === session.product_id);
      const productName = product ? product.product_name : (session.product_name || '');
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
          sessionTicketsText(session),
          sessionModelsText(session),
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
          const val = typeof costMap['$'] === 'number' ? costMap['$'] : Object.values(costMap).find((v) => typeof v === 'number');
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
          '<div class="kpi"><div class="kpi-lbl">Total Cost ($)</div><div class="kpi-val">$' + cost.toFixed(2) + '</div></div>' +
        '</div>' +
        (storageRows.length ? '<div class="storage-wrap">' + storageRows.join('') + '</div>' : '');
    }

    function populateFilters() {
      const allSessions = reports.flatMap((r) => Array.isArray(r.report.sessions) ? r.report.sessions.map((s) => ({report: r.report, session: s})) : []);
      const agents = [...new Set(allSessions.map(({session}) => session.agent).filter(Boolean))].sort();
      const mappedProducts = [...new Map(products.map((p) => [p.product_id, p])).values()]
        .sort((a, b) => a.product_name.localeCompare(b.product_name));
      document.getElementById('filter-agent').innerHTML = '<option value="">Agent</option>' + agents.map((a) => '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>').join('');
      document.getElementById('filter-product').innerHTML = '<option value="">Product</option>' + mappedProducts.map((p) => '<option value="' + escapeHtml(p.product_id) + '">' + escapeHtml(p.product_name) + '</option>').join('');
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
        const cwdTitle = ' title="cwd: &quot;' + escapeHtml(s.cwd || '') + '&quot;"';
        const currentProduct = products.find((p) => p.product_id === s.product_id);
        const productValue = currentProduct ? currentProduct.product_name : (s.product_name || '');
        const selectedRepo = selectedRepoForSession(s);
        return '<tr data-file="' + escapeHtml(file) + '" data-session-id="' + escapeHtml(s.session_id) + '">' +
          '<td><div class="session-title"' + cwdTitle + '>' + escapeHtml(title) + '</div></td>' +
          '<td class="input-cell">' + humanInputsHtml(report, s) + '</td>' +
          '<td class="lines-cell">' + sessionLinesText(s) + '</td>' +
          '<td class="num-cell">' + escapeHtml(s.files_changed ?? 0) + '</td>' +
          '<td class="agent-cell" title="' + escapeHtml(s.agent || '') + '">' + (s.agent ? escapeHtml(s.agent) : '<span class="muted">—</span>') + '</td>' +
          '<td class="models-cell" title="' + escapeHtml(sessionModelsText(s)) + '">' + sessionModelsHtml(s) + '</td>' +
          '<td><input class="product" list="product-list" value="' + escapeHtml(productValue) + '" placeholder="Search product" required />' +
          '<div class="product-error field-error"></div></td>' +
          '<td><div class="repo-field"><select class="repo">' + repoOptions(s.product_id, selectedRepo) + '</select>' +
          repoPickerHtml(s.product_id, selectedRepo) +
          '<input class="repo-url hidden" type="url" placeholder="https://github.com/owner/repo" pattern="https://github\\.com/[^/]+/[^/]+" /></div></td>' +
          '<td class="tickets-cell">' + ticketPickerHtml(s) + '</td>' +
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
      document.querySelectorAll('.repo-picker').forEach((picker) => {
        const row = picker.closest('tr');
        const repo = row.querySelector('.repo');
        picker.querySelector('.repo-trigger').addEventListener('click', () => {
          if (repo.disabled) return;
          setRepoMenuOpen(picker, picker.querySelector('.repo-menu').classList.contains('hidden'));
        });
        picker.querySelector('.repo-trigger').addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (repo.disabled) return;
          setRepoMenuOpen(picker, picker.querySelector('.repo-menu').classList.contains('hidden'));
        });
        picker.addEventListener('click', (event) => {
          const option = event.target.closest('.repo-option');
          if (!option) return;
          repo.value = option.dataset.value || '';
          updateRepoUrlInput(row);
          setRepoMenuOpen(picker, false);
        });
      });
      document.querySelectorAll('.ticket-picker').forEach((picker) => {
        picker.querySelector('.ticket-trigger').addEventListener('click', (event) => {
          if (picker.classList.contains('disabled')) return;
          if (event.target.closest('.ticket-remove')) return;
          setTicketMenuOpen(picker, picker.querySelector('.ticket-menu').classList.contains('hidden'));
        });
        picker.querySelector('.ticket-trigger').addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (picker.classList.contains('disabled')) return;
          setTicketMenuOpen(picker, picker.querySelector('.ticket-menu').classList.contains('hidden'));
        });
        picker.addEventListener('change', (event) => {
          if (picker.classList.contains('disabled')) return;
          if (!event.target.classList.contains('ticket-option-cb')) return;
          renderTicketTags(picker);
          syncRowTickets(picker.closest('tr'));
        });
        picker.addEventListener('click', (event) => {
          if (picker.classList.contains('disabled')) return;
          const remove = event.target.closest('.ticket-remove');
          if (!remove) return;
          event.stopPropagation();
          const ticket = remove.dataset.ticket;
          const checkbox = Array.from(picker.querySelectorAll('.ticket-option-cb')).find((option) => option.value === ticket);
          if (checkbox) checkbox.checked = false;
          renderTicketTags(picker);
          syncRowTickets(picker.closest('tr'));
        });
      });
      document.querySelectorAll('.ticket-add').forEach((el) => {
        el.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          addTicketFromRow(el.closest('tr'));
        });
        el.addEventListener('blur', () => addTicketFromRow(el.closest('tr')));
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
      showAssignedSessions = true;
      updateFilterUi();
      render();
      document.addEventListener('click', (event) => {
        document.querySelectorAll('.repo-picker').forEach((picker) => {
          if (!picker.contains(event.target)) setRepoMenuOpen(picker, false);
        });
        document.querySelectorAll('.ticket-picker').forEach((picker) => {
          if (!picker.contains(event.target)) setTicketMenuOpen(picker, false);
        });
      });
      document.getElementById('status').textContent = isMultiReport() ? 'Ready: ' + reports.length + ' report(s)' : 'Ready';
      document.getElementById('search-input').addEventListener('input', (e) => {
        searchQuery = String(e.target.value || '').trim().toLowerCase();
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
        addTicketFromRow(tr);
        assignments.push({
          file: tr.dataset.file,
          session_id: sessionId,
          product_id: product.product_id,
          product_name: product.product_name,
          repo_name: mapping ? mapping.repo_name : linkedRepoName,
          repo_url: repoUrl || (mapping ? mapping.repo_url : undefined),
          create_mapping: createMapping,
          ticket_display_ids: selectedTicketDisplayIds(tr.querySelector('.ticket-picker')),
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
        saveBtn.textContent = 'Saved ✓ Return to agent';
        saveBtn.classList.add('btn-saved');
        statusEl.textContent = 'Saved ' + result.assigned_sessions + ' session(s) to ' + fileList + '. Return to your agent to review and confirm upload.';
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
