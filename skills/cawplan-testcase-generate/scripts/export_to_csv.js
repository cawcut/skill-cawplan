#!/usr/bin/env node
'use strict';
/*
 * A3 测试用例导出 · export_to_csv.js
 *
 * 职责(且仅此职责):把 AI 已定稿的结构化用例数据(JSON),按团队 12 列模板
 * 写成 CSV。脚本只"摆格子",不生成、不补全、不改写任何内容 —— 红线 0 在导出层
 * 的硬墙:凡具体值(文案/阈值/次数)必须已由上游 AI 依据测试点/五字段填好,原样落盘。
 *
 * 纯 Node 内置能力,零第三方依赖(无需 npm install):只用 fs / path / process。
 * 与项目 Node 栈一致;agent 或用户 `node export_to_csv.js <json> -o <dir>` 直接可跑。
 *
 * 列结构写死(稳字优先)。模板列若变,同步改:
 *   1) 本文件 HEADERS
 *   2) references/csv-template-mapping.md
 *   3) assets/testcase-template.csv
 *
 * CSV 硬约束:UTF-8 无 BOM(fs 默认)、行尾 \r\n、RFC4180 转义(手写,见 csvEscape)。
 */

const fs = require('fs');
const path = require('path');

// ── 12 列表头(与团队模板逐字一致,顺序固定)──────────────────────
const HEADERS = [
  'CaseId',
  'Title',
  'Priority',
  'Tag',
  'Group',
  'TestPointTitle',
  'Preconditions',
  'Step description',
  'Expected Result',
  'moduleTreeNodeId',
  'RequirementId',
  'TestPointId',
];

const PRIORITY_MAP = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low' };
const PRIORITY_PASSTHROUGH = new Set(['Critical', 'High', 'Medium', 'Low']);

// P0–P3 → 英文四档;已英文档则原样;其它值原样(不猜、不改)
function mapPriority(value) {
  if (value === null || value === undefined) return '';
  const v = String(value).trim();
  if (PRIORITY_MAP[v]) return PRIORITY_MAP[v];
  return v; // 英文档 / 非法值都原样落盘,由 review 兜
}

// list → 换行连接;string → 原样;空 → ''
function joinMultiline(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join('\n');
  return String(value);
}

// Tag 多值:数组用 '/' 连接;字符串原样;空 → ''
function joinTag(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join('/');
  return String(value);
}

// RFC4180 转义:含逗号/双引号/换行 → 整体双引号包裹,内部 " → ""
function csvEscape(field) {
  const s = String(field === null || field === undefined ? '' : field);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsvLine(cells) {
  return cells.map(csvEscape).join(',');
}

// 一条用例 → CSV 行数组(每行是 12 元素数组)
function rowsForCase(caseObj, caseId) {
  const steps = caseObj.steps || [];
  const expected = caseObj.expected || [];

  if (steps.length !== expected.length) {
    throw new Error(
      `CaseId=${caseId} steps(${steps.length}) 与 expected(${expected.length}) 长度不等;` +
      `脚本不自行补齐(红线:不编造)。请上游对齐后重导。`
    );
  }

  // 必填三件套非空校验(SPEC §6.2,已归档主干):
  //   testPointId 空 → 孤儿用例(破溯源契约);requirementId 空 → 整份溯源断裂;
  //   title 空 → 无标题残次用例。三者任一空即 fail,脚本不放行脏数据、不编造补齐。
  //
  // 【未来记号】若日后支持"全程不归档草稿快通道"(需求/测试点均不入库):
  //   RequirementId / moduleTreeNodeId 允许空(未归档本就无库 id);
  //   testPointId 的校验应从"库 id 非空"改为"父测试点锚存在(库 id 或会话内临时锚)"——
  //   闸门语义(不许孤儿)不变,只是锚的形态变。改此处前须先在 proposal 层拍定该旁路(SPEC 待决策项)。
  const required = { testPointId: '孤儿用例:缺父测试点溯源', requirementId: '溯源断裂:缺需求 id', title: '残次用例:缺标题' };
  for (const [k, why] of Object.entries(required)) {
    if (!String(caseObj[k] == null ? '' : caseObj[k]).trim()) {
      throw new Error(
        `CaseId=${caseId} 的 ${k} 为空(${why})—— 必填字段不可空,脚本不放行、不自造。` +
        (k === 'testPointId' ? ' 缺面应回 A2 补测试点后重展开。' : '')
      );
    }
  }

  const s = (k) => String(caseObj[k] == null ? '' : caseObj[k]);
  const title = s('title');
  const priority = mapPriority(caseObj.priority);
  const tag = joinTag(caseObj.tag);
  const group = s('group');
  const tpTitle = s('testPointTitle');
  const precond = joinMultiline(caseObj.preconditions);
  const nodeId = s('moduleTreeNodeId');
  const reqId = s('requirementId');
  const tpId = s('testPointId');

  const n = steps.length;

  // 仅标题态:详情三列(含 Preconditions)空(SPEC §1.2:Preconditions 属详情级)
  if (n === 0) {
    return [[
      String(caseId), title, priority, tag, group, tpTitle,
      '', '', '',
      nodeId, reqId, tpId,
    ]];
  }

  const rows = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      rows.push([
        String(caseId), title, priority, tag, group, tpTitle,
        precond, String(steps[0]), String(expected[0]),
        nodeId, reqId, tpId,
      ]);
    } else {
      // 续行:仅 Step + Expected,其余 10 列空
      rows.push([
        '', '', '', '', '', '',
        '', String(steps[i]), String(expected[i]),
        '', '', '',
      ]);
    }
  }
  return rows;
}

// 核心:cases[] → CSV 文本(纯函数,可单测)
function buildCsvText(cases, startCaseId = 1) {
  if (!Array.isArray(cases)) throw new TypeError('cases 必须是用例数组');

  const lines = [toCsvLine(HEADERS)];
  let caseId = startCaseId;
  for (const c of cases) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      throw new TypeError('每条用例须为对象');
    }
    for (const row of rowsForCase(c, caseId)) {
      if (row.length !== HEADERS.length) {
        throw new Error(`行列数 ${row.length} ≠ ${HEADERS.length},跨行逻辑有 bug`);
      }
      lines.push(toCsvLine(row));
    }
    caseId += 1;
  }
  // 行尾 CRLF;末尾补一个 CRLF(与标准 csv 输出一致)
  return lines.join('\r\n') + '\r\n';
}

const FNAME_BAD = /[\\/:*?"<>|\r\n\t]+/g;
function safeFilename(name) {
  const s = String(name == null ? '' : name).replace(FNAME_BAD, '_').trim().replace(/^\.+|\.+$/g, '');
  return s || 'testcases';
}

function timestamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 落盘入口。payload = {requirementTitle, cases:[...]} 或直接 [...]
function exportToCsv(payload, outDir) {
  let cases, reqTitle;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    cases = payload.cases || [];
    reqTitle = payload.requirementTitle || 'testcases';
  } else {
    cases = payload;
    reqTitle = 'testcases';
  }

  const text = buildCsvText(cases);
  fs.mkdirSync(outDir, { recursive: true });
  const fname = `${safeFilename(reqTitle)}_${timestamp()}.csv`;
  const outPath = path.join(outDir, fname);
  // 'utf8' 默认不带 BOM
  fs.writeFileSync(outPath, text, 'utf8');
  return path.resolve(outPath);
}

// ── CLI ─────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  let jsonPath = null;
  let outDir = 'testcases';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--out-dir') {
      outDir = args[++i];
    } else if (!jsonPath) {
      jsonPath = args[i];
    }
  }
  if (!jsonPath) {
    console.error('用法: node export_to_csv.js <json_path> [-o out_dir]');
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const out = exportToCsv(payload, outDir);
  console.log(`已导出: ${out}`);
}

if (require.main === module) main();

module.exports = { HEADERS, mapPriority, joinTag, joinMultiline, csvEscape, buildCsvText, exportToCsv, safeFilename };
