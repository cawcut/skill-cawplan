# A7 压缩 HTML 完整示例（ticket-qa-report.1 · PROGRESS）

> Agent **必须**按此排版密度生成 `details`：**标签之间无换行/无空白**（单行 compact），**禁止** pretty-print。落库前用 `scripts/validate_report_details.js` 校验；可用 `--minify` 压紧标签间换行（**不**自动补全链接文案）。

下文示例为 **PROGRESS**、scope 含 D1–D3 子单与 1 条 relation；链接文案均为 `display_id — title`。复制时保持 **一行连续 HTML**（源码区仅为可读性未拆行；实际 `details` 字符串应无 `></` 间 `\n`）。

## 可读展开（仅供人读，勿照此落库）

```html
<!-- cawplan-ticket-report-meta {"template_spec_version":"ticket-qa-report.1","report_mode":"PROGRESS","template_payload":{...}} -->
<h2>Test Summary</h2>
<p><strong>Phase: In Progress</strong></p>
<p><strong>Coverage: </strong>42%</p>
<p><strong>Result: </strong>pass_with_issues</p>
<p><strong>Readiness: </strong>中</p>
<p><strong>Objective: </strong>验证用户可在设置页完成通知偏好保存与回显。</p>
<p><strong>Critical Risks: </strong>模块 B 存在 2 条未关闭 High BugFix。</p>
<h2>Test Approach</h2>
<p>核心场景：首次进入设置页修改通知开关并保存，刷新后状态保持。<br>基本核对：边界账号、离线恢复后偏好不回滚。</p>
<h2>Issue Summary</h2>
<h5>Type Overview</h5>
<ul><li>BugFix 5（未关闭 2）· Feature 3 · 其他 1</li></ul>
<h5>Module Fragility</h5>
<ul><li>通知设置：3 条 BugFix，含 1 条 Reopen，建议优先回归保存链路。</li></ul>
<h5>Collaboration Hotspots</h5>
<ul>
  <li><strong>Development</strong><ul><li>设置页保存接口近 7 日 2 次返工，建议结对走查 API 契约。</li></ul></li>
  <li><strong>QA</strong><ul><li>同模块 3 条用例连续 Failed，建议集中复测后再扩面。</li></ul></li>
</ul>
<h5>Recommendations</h5>
<ul><li>优先关闭 CAWP-12001 阻塞项后再扩 COMPLETION 范围。</li><li>对通知模块执行一次 targeted regression。</li></ul>
<h2>Verification Status</h2>
<ol>
  <li><strong>❌ Verified & Failed</strong><ul><li><strong>Critical(1)</strong><ul><li><strong>BugFix(1)</strong><ol><li><a href="https://app.cawplan.com/issue/CAWP-12001">CAWP-12001 — 保存后通知开关未持久化</a></li></ol></li></ul></li></ul></li>
  <li><strong>🔍 Under Active Testing</strong><ul><li><strong>High(2)</strong><ul><li><strong>Feature(2)</strong><ol><li><a href="https://app.cawplan.com/issue/CAWP-12010">CAWP-12010 — 设置页加载性能优化</a></li></ol></li></ul></li></ul></li>
</ol>
<h2>Related Links</h2>
<ul><li><a href="https://testrail.example.com/index.php?/runs/view/99">TestRail Run #99</a></li></ul>
<h2>Environment & Dependencies</h2>
<p>Staging · build 2026.08.27 · 依赖 CAWP-11990 已合入</p>
<h2>Notes</h2>
<p>父单：<a href="https://app.cawplan.com/issue/CAWP-11900">CAWP-11900 — Epic 通知中心改造</a></p>
```

## 落库用 compact 单行（`details` 字符串应与此等价）

```
<!-- cawplan-ticket-report-meta {"template_spec_version":"ticket-qa-report.1","report_mode":"PROGRESS","template_payload":{"issue_summary":{"type_overview":{"bugfix":5,"feature":3},"fragile_modules":["通知设置"],"dev_hotspots":["设置页保存接口近7日2次返工"],"qa_hotspots":["同模块3条用例连续Failed"],"recommendations":["优先关闭CAWP-12001","通知模块targeted regression"]},"verification":{"verified_failed":{"critical":{"bugfix":["uuid-1"]}},"under_active_testing":{"high":{"feature":["uuid-2"]}}}}} --><h2>Test Summary</h2><p><strong>Phase: In Progress</strong></p><p><strong>Coverage: </strong>42%</p><p><strong>Result: </strong>pass_with_issues</p><p><strong>Readiness: </strong>中</p><p><strong>Objective: </strong>验证用户可在设置页完成通知偏好保存与回显。</p><p><strong>Critical Risks: </strong>模块 B 存在 2 条未关闭 High BugFix。</p><h2>Test Approach</h2><p>核心场景：首次进入设置页修改通知开关并保存，刷新后状态保持。<br>基本核对：边界账号、离线恢复后偏好不回滚。</p><h2>Issue Summary</h2><h5>Type Overview</h5><ul><li>BugFix 5（未关闭 2）· Feature 3 · 其他 1</li></ul><h5>Module Fragility</h5><ul><li>通知设置：3 条 BugFix，含 1 条 Reopen，建议优先回归保存链路。</li></ul><h5>Collaboration Hotspots</h5><ul><li><strong>Development</strong><ul><li>设置页保存接口近 7 日 2 次返工，建议结对走查 API 契约。</li></ul></li><li><strong>QA</strong><ul><li>同模块 3 条用例连续 Failed，建议集中复测后再扩面。</li></ul></li></ul><h5>Recommendations</h5><ul><li>优先关闭 CAWP-12001 阻塞项后再扩 COMPLETION 范围。</li><li>对通知模块执行一次 targeted regression。</li></ul><h2>Verification Status</h2><ol><li><strong>❌ Verified & Failed</strong><ul><li><strong>Critical(1)</strong><ul><li><strong>BugFix(1)</strong><ol><li><a href="https://app.cawplan.com/issue/CAWP-12001">CAWP-12001 — 保存后通知开关未持久化</a></li></ol></li></ul></li></ul></li><li><strong>🔍 Under Active Testing</strong><ul><li><strong>High(2)</strong><ul><li><strong>Feature(2)</strong><ol><li><a href="https://app.cawplan.com/issue/CAWP-12010">CAWP-12010 — 设置页加载性能优化</a></li></ol></li></ul></li></ul></li></ol><h2>Related Links</h2><ul><li><a href="https://testrail.example.com/index.php?/runs/view/99">TestRail Run #99</a></li></ul><h2>Environment & Dependencies</h2><p>Staging · build 2026.08.27 · 依赖 CAWP-11990 已合入</p><h2>Notes</h2><p>父单：<a href="https://app.cawplan.com/issue/CAWP-11900">CAWP-11900 — Epic 通知中心改造</a></p>
```

## 反例（禁止）

| 问题 | 片段 |
|------|------|
| pretty-print 空行 | `</h2>\n\n<p>Phase` |
| Test Summary 拼一行 | `<p>Phase: … · Coverage: … · Result: …</p>` |
| Test Summary 无 strong 分层 | `<p>Objective: 验证…</p>`（缺 `<strong>Objective: </strong>`） |
| 纯工单号链接 | `<a href=".../issue/CAWP-12001">CAWP-12001</a>` |
| Test Approach 脚注 | `注：覆盖率为近似值…` |
| Issue 子标题 h3 | `<h3>Module Fragility</h3>` |
| Hotspots 括号标题 | `<h5>Collaboration Hotspots (QA)</h5>` |

校验：`node scripts/validate_report_details.js --body-file report-body.json`
