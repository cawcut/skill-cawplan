#!/usr/bin/env node
'use strict';
/*
 * Refs / caseIdentity helpers for A3 CSV export (T2-A8 link Workflow A).
 *
 * Mirrors BE qa_testrail_import.go: buildRefs, resolveCaseIdentity, computeContentHash.
 * Zero third-party deps (crypto only).
 */

const crypto = require('crypto');

function toTagsArray(tagValue, tagsValue) {
  const v = tagsValue !== undefined && tagsValue !== null ? tagsValue : tagValue;
  if (v === null || v === undefined || v === '') return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function joinMultilineForHash(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(String).join('\n');
  return String(value);
}

function stepsForHash(steps, expected) {
  const s = steps || [];
  const e = expected || [];
  return s.map((content, i) => ({
    content: String(content),
    expected: String(e[i] ?? ''),
  }));
}

function computeContentHash(title, steps, expected, preconditions, tag, tags) {
  const stepObjs = stepsForHash(steps, expected);
  const stepsRaw = JSON.stringify(stepObjs);
  const tagStr = toTagsArray(tag, tags).join(',');
  const norm =
    String(title ?? '').trim().toLowerCase() +
    '|' +
    stepsRaw +
    '|' +
    joinMultilineForHash(preconditions).trim().toLowerCase() +
    '|' +
    tagStr;
  const sum = crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
  return 'sha256:' + sum;
}

function resolveCaseIdentity(caseObj) {
  const key = caseObj.sourceCaseKey ?? caseObj.source_case_key;
  if (key != null && String(key).trim() !== '') {
    return String(key).trim();
  }
  const explicit =
    caseObj.contentHash ?? caseObj.content_hash;
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit).trim();
  }
  return computeContentHash(
    caseObj.title,
    caseObj.steps,
    caseObj.expected,
    caseObj.preconditions,
    caseObj.tag,
    caseObj.tags,
  );
}

function buildRefs(reqId, tpId, caseIdentity) {
  const parts = [];
  if (reqId) parts.push('cawplan:' + reqId);
  if (tpId) parts.push('cawplan:' + tpId);
  if (caseIdentity) parts.push('cawplan:case_' + caseIdentity);
  return parts.join(';');
}

function buildRefsForCase(caseObj) {
  const reqId = String(caseObj.requirementId ?? '');
  const tpId = String(caseObj.testPointId ?? '');
  return buildRefs(reqId, tpId, resolveCaseIdentity(caseObj));
}

module.exports = {
  buildRefs,
  buildRefsForCase,
  resolveCaseIdentity,
  computeContentHash,
  toTagsArray,
};
