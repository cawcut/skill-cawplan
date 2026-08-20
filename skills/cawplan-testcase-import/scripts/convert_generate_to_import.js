#!/usr/bin/env node
'use strict';
/*
 * A1 生成态转导入体 · convert_generate_to_import.js
 *
 * 职责(且仅此职责):把 A3(cawplan-testcase-generate)的 interim JSON(camelCase,
 * 与 export_to_csv.js 同源、见 cawplan-testcase-generate/references/csv-template-mapping.md)
 * 转成 A1 testrail import preview 需要的 INLINE body(snake_case)。
 * 脚本只做字段搬运/改名/校验,不生成、不补全、不臆造任何内容值 —— 红线 0
 * 在这一层的硬墙:标题/步骤/预期/优先级等具体值必须已由上游 A3 定稿,原样搬运。
 *
 * 纯 Node 内置能力,零第三方依赖(无需 npm install):只用 fs / path / process。
 * agent 或用户 `node convert_generate_to_import.js <json> --suite-id <n> [-o out.json]` 直接可跑。
 *
 * 输入契约(不与 A3 协商、照抄其既有导出格式):
 *   { requirementTitle?, cases: [{
 *       title, priority, tag, group, testPointTitle, testPointId, requirementId,
 *       moduleTreeNodeId, preconditions, steps[], expected[]
 *   }] }
 *
 * 输出契约(见 references/import-rules.md §body / §字段):
 *   { source: {type:"INLINE"}, suite_id, version_name?, parent_section_id?, cases: [{
 *       title, test_point_id, requirement_id, group, source_case_key,
 *       tags?, preconditions?, priority?, version_name?, steps?: [{content, expected}]
 *   }] }
 *
 * parent_section_id(可选,2026-08 新增):框 3.5 用户确认"导入到已有 Section 下"时,
 * Agent 把该 Section id 原样透传;脚本只搬运,不做任何 TestRail 校验(校验交给 BE
 * import/preview,见 import-rules.md §Section)。缺省(新建顶级 Section)时不写该字段。
 *
 * 优先级策略(SQA 已确认,2026-08):无法识别的 priority → 整批中断,不猜测、不放行。
 * tags[] 策略(SQA 已确认,2026-08):即便 BE 尚未实现 label 落地,仍保留 tags 字段做
 * 前向兼容 —— 见 import-rules.md §字段 "tags | — | 不写 label（BE 未实现）"。
 *
 * 失败诊断(2026-08 新增,红线不变——仍是整批中断,不放宽校验):
 * 失败时除了 stderr 人类可读文本(steps/expected 内容截断至 `PREVIEW_MAX_LEN` 字符),
 * 还会在输出路径旁写一份 `<out>.errors.json`(结构化 { index, title, test_point_id,
 * reason, message, ... }[]),供 Agent 精确定位坏用例、原样摘除后重跑,不用回头解析
 * stderr 文本猜是第几条 —— 见 import-rules.md §Convert「摘除坏用例」恢复流程。
 */

const fs = require('fs');
const path = require('path');

// 诊断预览截断长度:错误信息里附带的 steps/expected 原文按此截断,避免刷屏。
const PREVIEW_MAX_LEN = 100;
function truncate(value, max = PREVIEW_MAX_LEN) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// P0–P3 → TestRail 四档;已是四档(任意大小写)→ 大写直通;P4+/Pn(n>3) → LOW。
// 无法识别 → 记入 errors,调用方据此整批中断(不猜测)。
const PRIORITY_MAP = { P0: 'CRITICAL', P1: 'HIGH', P2: 'MEDIUM', P3: 'LOW' };
const PRIORITY_KNOWN = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

function mapPriority(value, index, title, errors) {
  if (value === null || value === undefined || value === '') return undefined;
  const raw = String(value).trim();
  const upper = raw.toUpperCase();
  if (PRIORITY_MAP[raw]) return PRIORITY_MAP[raw];
  if (/^P[4-9]$/.test(raw) || /^P\d{2,}$/.test(raw)) return 'LOW';
  if (PRIORITY_KNOWN.has(upper)) return upper;
  errors.push({
    index,
    title: title ?? '',
    reason: 'UNRECOGNIZED_PRIORITY',
    priority: value,
    message:
      `第 ${index + 1} 条 "${title ?? ''}": 无法识别的 priority "${value}"` +
      `(不是 P0-P3 也不是 CRITICAL/HIGH/MEDIUM/LOW)，需先向 SQA 确认，脚本不猜测`,
  });
  return undefined;
}

// tag(单值或数组)/ tags(数组,预留) → tags[]。为兼容未来 BE 落地,统一保留。
function toTagsArray(tagValue, tagsValue) {
  const v = tagsValue !== undefined && tagsValue !== null ? tagsValue : tagValue;
  if (v === null || v === undefined || v === '') return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

// preconditions:数组 → 换行连接;字符串 → 原样;空 → undefined(不发空字段)。
function joinMultiline(value) {
  if (value === null || value === undefined) return undefined;
  const s = Array.isArray(value) ? value.map(String).join('\n') : String(value);
  return s.trim() ? s : undefined;
}

/**
 * 单条用例转换。任何必填缺失 / steps-expected 长度不等,把原因(结构化对象,含
 * index/title/reason/message,供 Agent 精确定位)推入 errors 并返回 null;调用方
 * 汇总全部 errors 后统一抛出,整批中断(不做"转一部分、跳过坏的"这种部分放行——
 * 摘除坏用例是 Agent 征得用户同意后编辑 interim JSON 重跑,不是脚本自己跳过)。
 */
function convertCase(raw, index, seqByTestPoint, errors) {
  const label = `第 ${index + 1} 条 "${raw.title ?? ''}"`;
  const localErrors = [];

  const required = { title: '标题', testPointId: '父测试点 id', requirementId: '需求 id' };
  for (const [k, name] of Object.entries(required)) {
    if (!String(raw[k] ?? '').trim()) {
      localErrors.push({
        index,
        title: raw.title ?? '',
        test_point_id: raw.testPointId,
        reason: 'MISSING_REQUIRED_FIELD',
        field: k,
        message: `${label}: 缺少必填字段 ${name}(${k})，脚本不放行、不自造`,
      });
    }
  }

  const steps = raw.steps || [];
  const expected = raw.expected || [];
  if (steps.length !== expected.length) {
    const stepsPreview = steps.map((s) => truncate(s));
    const expectedPreview = expected.map((e) => truncate(e));
    localErrors.push({
      index,
      title: raw.title ?? '',
      test_point_id: raw.testPointId,
      reason: 'STEPS_EXPECTED_LENGTH_MISMATCH',
      steps_count: steps.length,
      expected_count: expected.length,
      steps_preview: stepsPreview,
      expected_preview: expectedPreview,
      message:
        `${label}: steps(${steps.length}) 与 expected(${expected.length}) 长度不等，脚本不自行补齐\n` +
        `      steps: ${JSON.stringify(stepsPreview)}\n` +
        `      expected: ${JSON.stringify(expectedPreview)}`,
    });
  }

  const priority = mapPriority(raw.priority, index, raw.title, localErrors);

  if (localErrors.length) {
    errors.push(...localErrors);
    return null;
  }

  const tpId = raw.testPointId;
  const seq = (seqByTestPoint.get(tpId) ?? 0) + 1;
  seqByTestPoint.set(tpId, seq);
  // 确定性生成:同一 testPointId 按 cases[] 中首次出现顺序编号,不随机 —— 保证
  // 同一份 interim JSON 重复运行本脚本得到相同 source_case_key,配合 A1 的
  // refs 幂等(cawplan:case_* 完整命中才 SKIP)不会把同一批用例重复建单。
  // 若上游已显式给出 sourceCaseKey/source_case_key,尊重之而非覆盖。
  const sourceCaseKey = raw.sourceCaseKey || raw.source_case_key || `${tpId}-case-${String(seq).padStart(2, '0')}`;

  const out = {
    title: raw.title,
    test_point_id: tpId,
    requirement_id: raw.requirementId,
    group: raw.group,
    source_case_key: sourceCaseKey,
  };

  const tags = toTagsArray(raw.tag, raw.tags);
  if (tags.length) out.tags = tags;

  const precond = joinMultiline(raw.preconditions);
  if (precond !== undefined) out.preconditions = precond;

  if (priority) out.priority = priority;

  // moduleTreeNodeId 不进入 import body(不属于 §字段 支持字段),按 import-rules.md
  // 确认过 —— 有意丢弃,不是遗漏。

  if (steps.length) {
    out.steps = steps.map((content, i) => ({ content: String(content), expected: String(expected[i]) }));
  }

  return out;
}

/**
 * cases[] → INLINE body(纯函数,可单测)。errors 非空时抛出,整批中断。
 */
function convert(payload, { suiteId, versionName, parentSectionId }) {
  if (!suiteId) throw new Error('缺少 --suite-id');
  const cases = Array.isArray(payload) ? payload : (payload && payload.cases) || [];
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error('输入不含任何用例(cases 为空)');
  }

  const errors = [];
  const seqByTestPoint = new Map();
  const outCases = [];

  cases.forEach((raw, i) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push({ index: i, title: '', reason: 'NOT_AN_OBJECT', message: `第 ${i + 1} 条: 用例须为对象` });
      return;
    }
    const converted = convertCase(raw, i, seqByTestPoint, errors);
    if (converted) outCases.push(converted);
  });

  if (errors.length) {
    const err = new Error(
      '转换失败，以下用例需先修正后再重新转换：\n' + errors.map((e) => '  - ' + e.message).join('\n'),
    );
    err.details = errors;
    throw err;
  }

  const body = { source: { type: 'INLINE' }, suite_id: suiteId, cases: outCases };
  if (versionName) {
    body.version_name = versionName;
    outCases.forEach((c) => { c.version_name = versionName; });
  }
  if (parentSectionId) body.parent_section_id = parentSectionId;
  return body;
}

// ── CLI ─────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  let jsonPath = null;
  let outPath = null;
  let suiteId = null;
  let versionName = null;
  let parentSectionId = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--suite-id') {
      suiteId = Number(args[++i]);
    } else if (args[i] === '--version-name') {
      versionName = args[++i];
    } else if (args[i] === '--parent-section-id') {
      parentSectionId = Number(args[++i]);
    } else if (args[i] === '-o' || args[i] === '--out') {
      outPath = args[++i];
    } else if (!jsonPath) {
      jsonPath = args[i];
    }
  }

  if (!jsonPath || !suiteId) {
    console.error(
      '用法: node convert_generate_to_import.js <interim_json_path> --suite-id <n> ' +
      '[--version-name "x.x.x"] [--parent-section-id <n>] [-o <output_path>]'
    );
    process.exit(1);
  }

  if (parentSectionId !== null && (!Number.isInteger(parentSectionId) || parentSectionId <= 0)) {
    console.error('--parent-section-id 须为正整数');
    process.exit(1);
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (e) {
    console.error(`读取/解析输入 JSON 失败: ${e.message}`);
    process.exit(1);
  }

  const out = outPath || jsonPath.replace(/\.json$/i, '') + '.import.json';

  let body;
  try {
    body = convert(payload, { suiteId, versionName, parentSectionId });
  } catch (e) {
    console.error(e.message);
    if (e.details) {
      const errorsPath = out.replace(/\.json$/i, '') + '.errors.json';
      fs.writeFileSync(errorsPath, JSON.stringify(e.details, null, 2), 'utf8');
      console.error(`结构化错误明细（供 Agent 精确定位、按用户确认摘除坏用例后重跑）: ${path.resolve(errorsPath)}`);
    }
    process.exit(1);
  }

  fs.writeFileSync(out, JSON.stringify(body, null, 2), 'utf8');
  console.log(`已转换: ${path.resolve(out)}`);
}

if (require.main === module) main();

module.exports = { convert, convertCase, mapPriority, toTagsArray, joinMultiline };
