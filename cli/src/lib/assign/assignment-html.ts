export function assignmentHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CawPlan AI Session Assignment</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 24px; }
    h1 { margin-bottom: 8px; }
    .muted { color: #777; margin-top: 0; }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; table-layout: fixed; }
    col.session-col { width: 20%; }
    col.human-inputs-col { width: 30%; }
    col.product-col { width: 20%; }
    col.repo-col { width: 30%; }
    th, td { border-bottom: 1px solid #ddd; padding: 10px; text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: Canvas; }
    input, select, button { font: inherit; padding: 6px 8px; }
    input, select { width: 100%; box-sizing: border-box; }
    .session-title { font-weight: 600; }
    .session-meta { color: #777; font-size: 12px; margin-top: 4px; }
    .human-inputs { margin: 0; padding-left: 18px; color: #555; font-size: 12px; }
    .human-inputs li { margin-bottom: 4px; overflow-wrap: anywhere; }
    .repo-url { margin-top: 8px; }
    .required { color: #b42318; }
    .field-error { color: #b42318; font-size: 12px; margin-top: 4px; }
    tr.invalid-product input.product { border-color: #b42318; outline-color: #b42318; }
    .hidden { display: none; }
    .bulk-controls { margin-top: 16px; display: grid; grid-template-columns: minmax(240px, 360px) auto 1fr; gap: 8px; align-items: end; }
    .bulk-controls label { display: grid; gap: 4px; font-weight: 600; }
    .bulk-hint { color: #777; font-size: 12px; align-self: center; }
    .actions { margin-top: 16px; display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
    .status { color: #777; }
  </style>
</head>
<body>
  <h1>CawPlan AI Session Assignment</h1>
  <p class="muted">Assign each session to a product and optional repository, then save the updated daily report.</p>
  <datalist id="product-list"></datalist>
  <div class="bulk-controls">
    <label>Default product
      <input id="bulk-product" list="product-list" placeholder="Search product" />
    </label>
    <button id="apply-product" type="button">Apply to visible sessions</button>
    <span class="bulk-hint">Use this to assign the same product to all rows shown below. Repository remains optional.</span>
  </div>
  <table>
    <colgroup>
      <col class="session-col" />
      <col class="human-inputs-col" />
      <col class="product-col" />
      <col class="repo-col" />
    </colgroup>
    <thead>
      <tr><th>Session</th><th>Human Inputs</th><th>Product <span class="required">*</span></th><th>Repo</th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="actions">
    <span id="status" class="status">Loading...</span>
    <button id="save">Save assignments</button>
    <button id="close">Close</button>
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
      repo.innerHTML = product ? repoOptions(session.product_id, session.project) : repoOptions('', '');
      repo.value = '';
      updateRepoUrlInput(row);
      validateProductRow(row);
    }

    function applyBulkProduct() {
      const productInput = document.getElementById('bulk-product');
      const product = findProduct(productInput.value);
      if (!product) {
        productInput.setCustomValidity('Choose a product from the list.');
        productInput.reportValidity();
        return;
      }
      productInput.setCustomValidity('');
      const rows = Array.from(document.querySelectorAll('tbody tr')).filter((row) => row.querySelector('.product'));
      rows.forEach((row) => setRowProduct(row, product));
      document.getElementById('status').textContent = 'Applied ' + product.product_name + ' to ' + rows.length + ' visible session(s).';
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

    function humanInputsHtml(session) {
      const inputs = (Array.isArray(session.human_inputs) ? session.human_inputs : [])
        .map(humanInputContent)
        .filter(Boolean)
        .slice(0, 3);
      if (inputs.length === 0) return '<span class="muted">No human inputs</span>';
      return '<ol class="human-inputs">' + inputs.map((input) => '<li>' + escapeHtml(truncateHumanInput(input)) + '</li>').join('') + '</ol>';
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

    function rowEntries() {
      return reports.flatMap((entry) => {
        const sessions = [...entry.report.sessions].sort((a, b) => sessionStartMs(a) - sessionStartMs(b));
        return sessions
          .filter((session) => !batch || !session.product_id)
          .map((session) => ({...entry, session}));
      });
    }

    function entryForRow(row) {
      return reports.find((entry) => entry.file === row.dataset.file);
    }

    function render() {
      const productList = document.getElementById('product-list');
      productList.innerHTML = products.map((p) => '<option value="' + escapeHtml(p.product_name) + '"></option>').join('');
      const tbody = document.getElementById('rows');
      const entries = rowEntries();
      if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4"><span class="muted">No sessions need product assignment.</span></td></tr>';
      } else {
      tbody.innerHTML = entries.map(({file, date, report, session: s}) => {
        const title = s.session_title || s.session_name || s.session_id;
        const currentProduct = products.find((p) => p.product_id === s.product_id);
        const productValue = currentProduct ? currentProduct.product_name : (s.product_name || '');
        const selectedRepo = selectedRepoForSession(s);
        return '<tr data-file="' + escapeHtml(file) + '" data-session-id="' + escapeHtml(s.session_id) + '">' +
          '<td><div class="session-title">' + escapeHtml(title) + '</div>' +
          '<div class="session-meta">' + escapeHtml([batch ? date : '', s.agent, s.time_range && s.time_range.display, sessionCostText(s), s.project].filter(Boolean).join(' | ')) + '</div></td>' +
          '<td>' + humanInputsHtml(s) + '</td>' +
          '<td><input class="product" list="product-list" value="' + escapeHtml(productValue) + '" placeholder="Search product" required />' +
          '<div class="product-error field-error"></div></td>' +
          '<td><select class="repo">' + repoOptions(s.product_id, selectedRepo) + '</select>' +
          '<input class="repo-url hidden" type="url" placeholder="https://github.com/owner/repo" pattern="https://github\\.com/[^/]+/[^/]+" /></td>' +
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
      render();
      document.getElementById('status').textContent = batch ? 'Ready: ' + reports.length + ' report(s)' : 'Ready';
    }

    async function save() {
      validateProducts();
      const assignments = [];
      const pendingMappingsToCreate = new Set();
      for (const tr of document.querySelectorAll('tbody tr')) {
        const sessionId = tr.dataset.sessionId;
        const product = findProduct(tr.querySelector('.product').value);
        if (!product) {
          const title = tr.querySelector('.session-title').textContent || sessionId;
          throw new Error('Product is required for session: ' + title);
        }
        const repoValue = tr.querySelector('.repo').value;
        let repoUrl;
        let linkedRepoName;
        if (repoValue === '__link__') {
          repoUrl = tr.querySelector('.repo-url').value.trim();
          if (!repoUrl) {
            throw new Error('GitHub repository URL is required when linking a repository.');
          }
          linkedRepoName = parseRepoNameFromGitHubUrl(repoUrl);
          if (!linkedRepoName) {
            throw new Error('GitHub repository URL must be in the format https://github.com/owner/repo.');
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
      document.getElementById('status').textContent = 'Saving...';
      const result = await api('/api/assignments', {method: 'POST', body: JSON.stringify({assignments})});
      document.getElementById('status').textContent = 'Saved ' + result.assigned_sessions + ' session(s). Closing server...';
      alert('Saved assignments to ' + (result.files || [result.file]).join(', '));
      await api('/api/close', {method: 'POST'});
      window.close();
    }

    document.getElementById('save').addEventListener('click', () => save().catch((e) => alert(e.message)));
    document.getElementById('apply-product').addEventListener('click', () => applyBulkProduct());
    document.getElementById('close').addEventListener('click', () => api('/api/close', {method: 'POST'}).then(() => window.close()).catch((e) => alert(e.message)));
    load().catch((e) => document.getElementById('status').textContent = e.message);
  </script>
</body>
</html>`;
}
