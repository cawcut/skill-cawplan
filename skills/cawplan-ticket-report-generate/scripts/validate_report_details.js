#!/usr/bin/env node
'use strict';
/*
 * A7 报告 details 发布前校验 · validate_report_details.js
 *
 * 职责(且仅此职责):
 *   1. HTML 紧凑 — 块级标签之间不得 pretty-print（\n/空白 between ></），避免 Portal 富文本多空行
 *   2. Issue 链接 — details 内 href 含 /issue/ 的 <a> 文案须为「display_id — title」，禁止纯 CAWP-\d+
 *
 * 纯 Node 内置,零第三方依赖。Agent Step 5 落库组装后、Step 6 正文预览闸之前 MUST 跑本脚本;
 * 失败则退回补全,禁止带不合规 details 进入预览/落库（对齐 A2 review-checklist 强制自审思路）。
 *
 * 用法:
 *   node scripts/validate_report_details.js --body-file report-body.json
 *   node scripts/validate_report_details.js --body-file report-body.json --minify -o report-body.json
 *   node scripts/validate_report_details.js --details '<html...>'
 *
 * 失败时 stderr 人类可读 + 旁路写 <body-file>.validate-errors.json（结构化 errors[]）。
 */

const fs = require('fs');
const path = require('path');

const DISPLAY_ID_ONLY = /^[A-Za-z][A-Za-z0-9]+-\d+$/;
const DISPLAY_ID_WITH_TITLE = /^[A-Za-z][A-Za-z0-9]+-\d+\s+[—–-]\s+.+/;

function truncate(value, max = 120) {
  const s = String(value ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 去掉标签之间的换行与空白（不落库 pretty-print） */
function minifyHtml(html) {
  let out = String(html ?? '');
  // 重复压紧直到稳定（嵌套空白）
  for (let i = 0; i < 8; i++) {
    const next = out
      .replace(/>\s*\n+\s*</g, '><')
      .replace(/<p>\s*<\/p>/gi, '')
      .replace(/<p>\s+<\/p>/gi, '')
      .replace(/(<br\s*\/?>\s*){2,}/gi, '<br>')
      .replace(/\n{2,}/g, '\n');
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

function extractDetailsFromBody(body) {
  if (typeof body === 'string') return body;
  if (body && typeof body.details === 'string') return body.details;
  return null;
}

function findIssueAnchorIssues(html) {
  const errors = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']*\/issue\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const inner = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!inner) {
      errors.push({
        code: 'ISSUE_LINK_EMPTY_TEXT',
        href,
        text: inner,
        message: `Issue 链接文案为空: href=${truncate(href)}`,
      });
      continue;
    }
    if (DISPLAY_ID_ONLY.test(inner)) {
      errors.push({
        code: 'ISSUE_LINK_INCOMPLETE',
        href,
        text: inner,
        message:
          `Issue 链接文案仅含工单号「${inner}」,缺少「 — 标题」: 须为「${inner} — {title}」(≤80字)`,
      });
      continue;
    }
    if (!DISPLAY_ID_WITH_TITLE.test(inner)) {
      errors.push({
        code: 'ISSUE_LINK_FORMAT',
        href,
        text: inner,
        message:
          `Issue 链接文案格式不合规「${truncate(inner)}」: 须 display_id — title（em dash / hyphen 分隔标题）`,
      });
    }
  }
  return errors;
}

function extractTestSummarySection(html) {
  const re = /<h2>\s*Test Summary\s*<\/h2>/i;
  const m = re.exec(String(html ?? ''));
  if (!m) return null;
  const rest = html.slice(m.index + m[0].length);
  const endMatch = rest.match(/<h2>/i);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

function findTestSummaryFormatIssues(html) {
  const errors = [];
  const section = extractTestSummarySection(html);
  if (!section) return errors;

  if (/<p[^>]*>[^<]*Phase:[^<]*·/i.test(section)) {
    errors.push({
      code: 'TEST_SUMMARY_FLAT_LINE',
      message:
        'Test Summary 禁止用 · 将 Phase/Coverage/Result/Readiness 拼成一行；每项须独立 <p> 并用 <strong> 标标签（见 publish §Template）',
    });
  }

  if (!/<p><strong>Phase:\s*[^<]+<\/strong><\/p>/i.test(section)) {
    errors.push({
      code: 'TEST_SUMMARY_PHASE_FORMAT',
      message:
        'Test Summary 须含 <p><strong>Phase: {值}</strong></p>（Phase 标签与值同在 strong 内）',
    });
  }

  if (!/<p><strong>Coverage:\s*<\/strong>/i.test(section)) {
    errors.push({
      code: 'TEST_SUMMARY_COVERAGE_FORMAT',
      message:
        'Test Summary 须含 <p><strong>Coverage: </strong>{百分比}</p>（标签在 strong 内、值在 strong 外）',
    });
  }

  if (!/<p><strong>Result:\s*<\/strong>/i.test(section)) {
    errors.push({
      code: 'TEST_SUMMARY_RESULT_FORMAT',
      message:
        'Test Summary 须含 <p><strong>Result: </strong>{值}</p>',
    });
  }

  if (!/<p><strong>Readiness:\s*<\/strong>/i.test(section)) {
    errors.push({
      code: 'TEST_SUMMARY_READINESS_FORMAT',
      message:
        'Test Summary 须含 <p><strong>Readiness: </strong>{值}</p>',
    });
  }

  if (!/<p><strong>Objective:\s*<\/strong>/i.test(section)) {
    errors.push({
      code: 'TEST_SUMMARY_OBJECTIVE_FORMAT',
      message:
        'Test Summary 须含 <p><strong>Objective: </strong>{anchor 一句}</p>',
    });
  }

  if (
    /<p>\s*Critical Risks:/i.test(section) &&
    !/<p><strong>Critical Risks:\s*<\/strong>/i.test(section)
  ) {
    errors.push({
      code: 'TEST_SUMMARY_RISKS_FORMAT',
      message:
        'Test Summary Critical Risks 须为 <p><strong>Critical Risks: </strong>{内容}</p>',
    });
  }

  if (
    /<p>\s*Overall Conclusion:/i.test(section) &&
    !/<p><strong>Overall Conclusion:\s*<\/strong>/i.test(section)
  ) {
    errors.push({
      code: 'TEST_SUMMARY_CONCLUSION_FORMAT',
      message:
        'Test Summary Overall Conclusion 须为 <p><strong>Overall Conclusion: </strong>{结论}</p>',
    });
  }

  return errors;
}

function findHtmlCompactIssues(html) {
  const errors = [];
  const src = String(html ?? '');

  if (/>\s*\n\s*\n\s*</.test(src)) {
    errors.push({
      code: 'HTML_DOUBLE_NEWLINE',
      message:
        'details 存在标签间连续空行（\\n\\n between ></）; Portal 会渲染成空白段落。须 compact 单行或 --minify',
    });
  }

  if (/>\s*\n\s*</.test(src)) {
    errors.push({
      code: 'HTML_TAG_NEWLINE',
      message:
        'details 存在标签间换行（\\n between ></）; 禁止 pretty-print。须去除标签间换行/空白后重试',
    });
  }

  if (/<p>\s*<\/p>/i.test(src) || /<p>\s+<\/p>/i.test(src)) {
    errors.push({
      code: 'HTML_EMPTY_P',
      message: 'details 含空 <p></p> 或仅空白 <p>; 须删除',
    });
  }

  if (/(<br\s*\/?>\s*){2,}/i.test(src)) {
    errors.push({
      code: 'HTML_DOUBLE_BR',
      message: 'details 含连续 <br> 或 <br><br>; 改用单 <br> 或 <li>',
    });
  }

  return errors;
}

function validateDetails(details) {
  if (!details || typeof details !== 'string') {
    return [{ code: 'DETAILS_MISSING', message: 'details 须为非空字符串' }];
  }
  return [
    ...findHtmlCompactIssues(details),
    ...findIssueAnchorIssues(details),
    ...findTestSummaryFormatIssues(details),
  ];
}

function writeErrors(errorsPath, errors) {
  fs.writeFileSync(errorsPath, JSON.stringify(errors, null, 2), 'utf8');
}

function loadBodyFile(bodyFile) {
  const raw = fs.readFileSync(bodyFile, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const args = process.argv.slice(2);
  let bodyFile = null;
  let outPath = null;
  let detailsArg = null;
  let minify = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--body-file') bodyFile = args[++i];
    else if (a === '-o' || a === '--out') outPath = args[++i];
    else if (a === '--details') detailsArg = args[++i];
    else if (a === '--minify') minify = true;
    else if (a === '--help' || a === '-h') {
      console.log(
        '用法: node validate_report_details.js --body-file <json> [--minify] [-o <out.json>]\n' +
          '      node validate_report_details.js --details \'<html>\''
      );
      process.exit(0);
    }
  }

  if (!bodyFile && !detailsArg) {
    console.error('须指定 --body-file 或 --details');
    process.exit(1);
  }

  let body = null;
  let details = detailsArg;

  if (bodyFile) {
    try {
      body = loadBodyFile(bodyFile);
      details = extractDetailsFromBody(body);
    } catch (e) {
      console.error(`读取/解析 body 失败: ${e.message}`);
      process.exit(1);
    }
  }

  if (minify && details) {
    details = minifyHtml(details);
    if (body) body.details = details;
  }

  const errors = validateDetails(details);
  if (errors.length) {
    const lines = errors.map((e) => `  - [${e.code}] ${e.message}`);
    console.error('details 校验失败，禁止进入 Step 6 预览/落库:\n' + lines.join('\n'));
    if (bodyFile) {
      const errorsPath = bodyFile.replace(/\.json$/i, '') + '.validate-errors.json';
      writeErrors(errorsPath, errors);
      console.error(`结构化错误: ${path.resolve(errorsPath)}`);
      if (minify) {
        console.error('已尝试 --minify 仍失败; 请手工补全 Issue 链接文案后重跑');
      } else {
        console.error('可尝试: node scripts/validate_report_details.js --body-file ... --minify -o ...');
      }
    }
    process.exit(1);
  }

  if (bodyFile && (minify || outPath)) {
    const target = outPath || bodyFile;
    fs.writeFileSync(target, JSON.stringify(body, null, 2), 'utf8');
    console.log(`✓ details 校验通过; 已写入: ${path.resolve(target)}`);
  } else {
    console.log('✓ details 校验通过');
  }
}

if (require.main === module) main();

module.exports = {
  minifyHtml,
  validateDetails,
  findHtmlCompactIssues,
  findIssueAnchorIssues,
  findTestSummaryFormatIssues,
  extractTestSummarySection,
};
