/**
 * Support Ops -> CawPlan metrics JSON exporter.
 *
 * Add this file to the same bound Apps Script project as the Support Ops
 * spreadsheet. It reads person sheets and creates a JSON file in Google Drive.
 * It never calls CawPlan and never changes spreadsheet data.
 */

var CAWPLAN_SUPPORT_CONFIG = {
  spreadsheetId: '1FyQ4v9sKM6hg9g3xsFC6OCa9uiuOvpSTLi2eS1NBerY',
  timezone: 'Asia/Taipei',

  // Inclusive local dates. Set these before every export.
  startDate: 'YYYY-MM-DD',
  endDate: 'YYYY-MM-DD',

  // Leave empty to create the JSON file in My Drive root.
  outputFolderId: '',

  // The weekly report currently includes only these person sheets.
  assignees: ['Clark', 'Calla', 'Fiona'],

  // Replace every value with the exact CawPlan product unique_id.
  products: {
    access: '0197e3c7-1717-7d07-8059-10dd9d95b26d',
    uid: '01983f50-20f6-72b4-8486-fdc44f2a4146',
    protect: '01992714-41ea-70e2-ac70-39073720571d'
  },

  // Run cawplanSupportInspectSource(), review the output, then copy the exact
  // approved header text for every mapped column here.
  approvedHeaders: {
    B: 'Zendesk UA New',
    C: 'Zendesk UID New',
    E: 'Community UA New',
    F: 'Community UID New',
    H: 'UniFi Endpoint Feedback',
    I: 'Community Protect New'
  },

  // One-based source columns verified from the existing dashboard and report.
  sources: [
    {
      key: 'ua_zendesk',
      productKey: 'access',
      productLine: 'access',
      channel: 'zendesk',
      columns: [2]
    },
    {
      key: 'ua_community',
      productKey: 'access',
      productLine: 'access',
      channel: 'community',
      columns: [5]
    },
    {
      key: 'uid_zendesk_and_endpoint_feedback',
      productKey: 'uid',
      productLine: 'uid',
      channel: 'zendesk',
      columns: [3, 8]
    },
    {
      key: 'uid_community',
      productKey: 'uid',
      productLine: 'uid',
      channel: 'community',
      columns: [6]
    },
    {
      key: 'protect_community',
      productKey: 'protect',
      productLine: 'protect',
      channel: 'community',
      columns: [9]
    }
  ]
};

/**
 * Read-only diagnostic. Run this first and review the logged headers.
 */
function cawplanSupportInspectSource() {
  var ss = cawplanSupportOpenSpreadsheet_();
  var mappedColumns = [1].concat(cawplanSupportMappedColumns_());
  var result = {
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    spreadsheetTimezone: ss.getSpreadsheetTimeZone(),
    configuredTimezone: CAWPLAN_SUPPORT_CONFIG.timezone,
    assignees: []
  };

  for (var i = 0; i < CAWPLAN_SUPPORT_CONFIG.assignees.length; i++) {
    var name = CAWPLAN_SUPPORT_CONFIG.assignees[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      result.assignees.push({ name: name, error: 'Sheet not found' });
      continue;
    }

    var lastColumn = sheet.getLastColumn();
    var headers = lastColumn > 0
      ? sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
      : [];

    var headerSnapshot = mappedColumns.map(function (column) {
      return {
        column: cawplanSupportColumnLetter_(column),
        header: String(headers[column - 1] || '').trim()
      };
    });
    var totalColumn = '';
    for (var h = 0; h < headers.length; h++) {
      if (cawplanSupportNormalizeHeader_(headers[h]) === 'total') {
        totalColumn = cawplanSupportColumnLetter_(h + 1);
        break;
      }
    }

    result.assignees.push({
      name: name,
      lastRow: sheet.getLastRow(),
      lastColumn: lastColumn,
      mappedHeaders: headerSnapshot,
      totalColumn: totalColumn
    });
  }

  try {
    var sourceState = cawplanSupportValidateHeaders_(ss);
    var mappedSet = cawplanSupportArrayToSet_(mappedColumns);
    result.validation = 'PASS';
    result.resolvedSources = sourceState.mapping;
    result.excludedHeaders = sourceState.headers.map(function (header, index) {
      return {
        column: cawplanSupportColumnLetter_(index + 1),
        header: String(header || '').trim()
      };
    }).filter(function (entry, index) {
      return entry.header &&
        !mappedSet[index + 1] &&
        cawplanSupportNormalizeHeader_(entry.header) !== 'total';
    });
  } catch (error) {
    result.validation = 'FAILED';
    result.error = error.message;
  }

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Validate the configured range, read the person sheets, and create JSON.
 */
function cawplanSupportExportMetrics() {
  cawplanSupportValidateConfig_();

  var ss = cawplanSupportOpenSpreadsheet_();
  var sourceState = cawplanSupportValidateHeaders_(ss);
  var expectedDates = cawplanSupportWeekdays_(
    CAWPLAN_SUPPORT_CONFIG.startDate,
    CAWPLAN_SUPPORT_CONFIG.endDate
  );
  var expectedDateSet = cawplanSupportArrayToSet_(expectedDates);
  var items = [];
  var seenIdentities = {};

  for (var i = 0; i < CAWPLAN_SUPPORT_CONFIG.assignees.length; i++) {
    var assigneeName = CAWPLAN_SUPPORT_CONFIG.assignees[i];
    var sheet = ss.getSheetByName(assigneeName);
    var rows = cawplanSupportReadRows_(sheet, expectedDateSet);
    var presentDates = {};

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (presentDates[row.date]) {
        throw new Error('Duplicate date ' + row.date + ' in sheet ' + assigneeName);
      }
      presentDates[row.date] = true;

      for (var s = 0; s < CAWPLAN_SUPPORT_CONFIG.sources.length; s++) {
        var source = CAWPLAN_SUPPORT_CONFIG.sources[s];
        var value = 0;

        for (var c = 0; c < source.columns.length; c++) {
          var column = source.columns[c];
          value += cawplanSupportReadCount_(
            row.values[column - 1],
            assigneeName,
            row.date,
            sourceState.headers[column - 1]
          );
        }

        if (value === 0) continue;

        var item = {
          domain: 'cawplan_csm',
          metric: 'ticket_created',
          value: value,
          dimensions: {
            product: CAWPLAN_SUPPORT_CONFIG.products[source.productKey]
          },
          tags: {
            product_line: source.productLine,
            channel: source.channel,
            assignee: cawplanSupportSlug_(assigneeName),
            source_system: 'support_ops_sheet'
          },
          timestamp: row.date + 'T12:00:00+08:00'
        };

        var identity = cawplanSupportIdentity_(item);
        if (seenIdentities[identity]) {
          throw new Error('Duplicate metric identity: ' + identity);
        }
        seenIdentities[identity] = true;
        items.push(item);
      }
    }

    var missing = expectedDates.filter(function (date) {
      return !presentDates[date];
    });
    if (missing.length) {
      throw new Error(
        'Sheet ' + assigneeName + ' is missing weekday rows: ' + missing.join(', ')
      );
    }
  }

  if (!items.length) {
    throw new Error('The configured range produced no non-zero metric items');
  }

  items.sort(cawplanSupportCompareItems_);

  var envelope = {
    schema_version: 'cawplan.support_metrics.v1',
    timezone: CAWPLAN_SUPPORT_CONFIG.timezone,
    generated_at: cawplanSupportRfc3339Now_(),
    range: {
      start: CAWPLAN_SUPPORT_CONFIG.startDate,
      end: CAWPLAN_SUPPORT_CONFIG.endDate
    },
    source: {
      system: 'support_ops_sheet',
      spreadsheet_id: ss.getId(),
      spreadsheet_name: ss.getName(),
      spreadsheet_timezone: ss.getSpreadsheetTimeZone(),
      assignees: CAWPLAN_SUPPORT_CONFIG.assignees.slice(),
      header_mapping: sourceState.mapping
    },
    items: items
  };

  var json = JSON.stringify(envelope, null, 2);
  var checksum = cawplanSupportSha256_(json);
  var fileName = 'cawplan-support-metrics-' +
    CAWPLAN_SUPPORT_CONFIG.startDate + '-to-' +
    CAWPLAN_SUPPORT_CONFIG.endDate + '.json';
  var blob = Utilities.newBlob(json, 'application/json', fileName);
  var file = CAWPLAN_SUPPORT_CONFIG.outputFolderId
    ? DriveApp.getFolderById(CAWPLAN_SUPPORT_CONFIG.outputFolderId).createFile(blob)
    : DriveApp.createFile(blob);

  var summary = {
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' +
      encodeURIComponent(file.getId()),
    sha256: checksum,
    range: envelope.range,
    itemCount: items.length,
    valueTotal: items.reduce(function (sum, item) {
      return sum + item.value;
    }, 0),
    headerMapping: sourceState.mapping
  };

  Logger.log(summary.downloadUrl);
  // Logger.log(JSON.stringify(summary, null, 2));
  return summary;
}

function cawplanSupportOpenSpreadsheet_() {
  if (CAWPLAN_SUPPORT_CONFIG.spreadsheetId) {
    return SpreadsheetApp.openById(CAWPLAN_SUPPORT_CONFIG.spreadsheetId);
  }
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('No spreadsheet is available');
  return active;
}

function cawplanSupportValidateConfig_() {
  if (CAWPLAN_SUPPORT_CONFIG.timezone !== 'Asia/Taipei') {
    throw new Error('timezone must be Asia/Taipei');
  }

  cawplanSupportParseIsoDate_(CAWPLAN_SUPPORT_CONFIG.startDate, 'startDate');
  cawplanSupportParseIsoDate_(CAWPLAN_SUPPORT_CONFIG.endDate, 'endDate');
  if (CAWPLAN_SUPPORT_CONFIG.startDate > CAWPLAN_SUPPORT_CONFIG.endDate) {
    throw new Error('startDate must not be later than endDate');
  }

  if (!CAWPLAN_SUPPORT_CONFIG.assignees.length) {
    throw new Error('At least one assignee is required');
  }

  var assigneeSet = {};
  for (var i = 0; i < CAWPLAN_SUPPORT_CONFIG.assignees.length; i++) {
    var assignee = String(CAWPLAN_SUPPORT_CONFIG.assignees[i] || '').trim();
    if (!assignee) throw new Error('Assignee names must not be empty');
    var slug = cawplanSupportSlug_(assignee);
    if (assigneeSet[slug]) throw new Error('Duplicate assignee slug: ' + slug);
    assigneeSet[slug] = true;
  }

  var productKeys = ['access', 'uid', 'protect'];
  for (var p = 0; p < productKeys.length; p++) {
    var key = productKeys[p];
    var product = String(CAWPLAN_SUPPORT_CONFIG.products[key] || '').trim();
    if (!product || product.indexOf('REPLACE_WITH_') === 0) {
      throw new Error('Set the exact CawPlan product unique_id for ' + key);
    }
  }

  var requiredColumns = cawplanSupportMappedColumns_();
  for (var c = 0; c < requiredColumns.length; c++) {
    var letter = cawplanSupportColumnLetter_(requiredColumns[c]);
    var approved = String(CAWPLAN_SUPPORT_CONFIG.approvedHeaders[letter] || '').trim();
    if (!approved || approved.indexOf('REPLACE_WITH_') === 0) {
      throw new Error(
        'Set the approved source header for column ' + letter +
        ' after running cawplanSupportInspectSource()'
      );
    }
  }
}

function cawplanSupportValidateHeaders_(ss) {
  var baselineHeaders = null;
  var maxColumn = cawplanSupportMaxSourceColumn_();

  for (var i = 0; i < CAWPLAN_SUPPORT_CONFIG.assignees.length; i++) {
    var name = CAWPLAN_SUPPORT_CONFIG.assignees[i];
    var sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('Missing person sheet: ' + name);
    if (sheet.getLastColumn() < maxColumn) {
      throw new Error(
        'Sheet ' + name + ' has only ' + sheet.getLastColumn() +
        ' columns; source mapping requires column ' +
        cawplanSupportColumnLetter_(maxColumn)
      );
    }

    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .getDisplayValues()[0]
      .map(function (value) { return String(value || '').trim(); });

    if (cawplanSupportNormalizeHeader_(headers[0]) !== 'date') {
      throw new Error('Sheet ' + name + ' column A must be Date');
    }

    for (var s = 0; s < CAWPLAN_SUPPORT_CONFIG.sources.length; s++) {
      var columns = CAWPLAN_SUPPORT_CONFIG.sources[s].columns;
      for (var c = 0; c < columns.length; c++) {
        var column = columns[c];
        var header = headers[column - 1];
        if (!header) {
          throw new Error(
            'Sheet ' + name + ' has an empty source header at ' +
            cawplanSupportColumnLetter_(column)
          );
        }
        if (cawplanSupportNormalizeHeader_(header) === 'total') {
          throw new Error(
            'Source mapping points to Total in sheet ' + name + ' column ' +
            cawplanSupportColumnLetter_(column)
          );
        }
      }
    }

    if (baselineHeaders === null) {
      baselineHeaders = headers;
    } else {
      cawplanSupportAssertMappedHeadersMatch_(baselineHeaders, headers, name);
    }
  }

  cawplanSupportAssertApprovedHeaders_(baselineHeaders);

  return {
    headers: baselineHeaders,
    mapping: cawplanSupportDescribeSources_(baselineHeaders)
  };
}

function cawplanSupportAssertApprovedHeaders_(headers) {
  var columns = cawplanSupportMappedColumns_();
  for (var i = 0; i < columns.length; i++) {
    var column = columns[i];
    var letter = cawplanSupportColumnLetter_(column);
    var approved = CAWPLAN_SUPPORT_CONFIG.approvedHeaders[letter];
    var actual = headers[column - 1];
    if (cawplanSupportNormalizeHeader_(approved) !== cawplanSupportNormalizeHeader_(actual)) {
      throw new Error(
        'Approved header mismatch at column ' + letter + ': expected "' +
        approved + '", got "' + actual + '"'
      );
    }
  }
}

function cawplanSupportAssertMappedHeadersMatch_(expected, actual, sheetName) {
  var checked = { 1: true };
  for (var s = 0; s < CAWPLAN_SUPPORT_CONFIG.sources.length; s++) {
    var columns = CAWPLAN_SUPPORT_CONFIG.sources[s].columns;
    for (var c = 0; c < columns.length; c++) checked[columns[c]] = true;
  }

  var columnNumbers = Object.keys(checked);
  for (var i = 0; i < columnNumbers.length; i++) {
    var column = Number(columnNumbers[i]);
    var expectedHeader = cawplanSupportNormalizeHeader_(expected[column - 1]);
    var actualHeader = cawplanSupportNormalizeHeader_(actual[column - 1]);
    if (expectedHeader !== actualHeader) {
      throw new Error(
        'Header mismatch in sheet ' + sheetName + ' column ' +
        cawplanSupportColumnLetter_(column) + ': expected "' +
        expected[column - 1] + '", got "' + actual[column - 1] + '"'
      );
    }
  }
}

function cawplanSupportDescribeSources_(headers) {
  return CAWPLAN_SUPPORT_CONFIG.sources.map(function (source) {
    return {
      key: source.key,
      product_key: source.productKey,
      product_line: source.productLine,
      channel: source.channel,
      columns: source.columns.map(function (column) {
        return {
          column: cawplanSupportColumnLetter_(column),
          header: String(headers[column - 1] || '').trim()
        };
      })
    };
  });
}

function cawplanSupportReadRows_(sheet, expectedDateSet) {
  if (sheet.getLastRow() < 2) return [];

  var width = Math.max(sheet.getLastColumn(), cawplanSupportMaxSourceColumn_());
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues();
  var rows = [];

  for (var i = 0; i < values.length; i++) {
    var rawDate = values[i][0];
    if (cawplanSupportNormalizeHeader_(rawDate) === 'total') continue;

    var date = cawplanSupportSheetDate_(rawDate);
    if (!date) {
      if (cawplanSupportRowHasMappedValues_(values[i])) {
        throw new Error(
          'Sheet ' + sheet.getName() + ' row ' + (i + 2) +
          ' has source values but no valid Date'
        );
      }
      continue;
    }

    if (expectedDateSet[date]) rows.push({ date: date, values: values[i] });
  }

  return rows;
}

function cawplanSupportReadCount_(raw, sheetName, date, header) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  var value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!isFinite(value) || Math.floor(value) !== value || value < 0) {
    throw new Error(
      'Invalid count in sheet ' + sheetName + ', date ' + date +
      ', header "' + header + '": ' + raw
    );
  }
  return value;
}

function cawplanSupportRowHasMappedValues_(row) {
  for (var s = 0; s < CAWPLAN_SUPPORT_CONFIG.sources.length; s++) {
    var columns = CAWPLAN_SUPPORT_CONFIG.sources[s].columns;
    for (var c = 0; c < columns.length; c++) {
      var value = row[columns[c] - 1];
      if (value !== '' && value !== null && value !== undefined) return true;
    }
  }
  return false;
}

function cawplanSupportWeekdays_(startDate, endDate) {
  var start = cawplanSupportParseIsoDate_(startDate, 'startDate');
  var end = cawplanSupportParseIsoDate_(endDate, 'endDate');
  var dates = [];
  for (var cursor = start; cursor.getTime() <= end.getTime(); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    var day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(Utilities.formatDate(cursor, 'UTC', 'yyyy-MM-dd'));
    }
  }
  return dates;
}

function cawplanSupportParseIsoDate_(value, label) {
  var text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(label + ' must use YYYY-MM-DD');
  }
  var parts = text.split('-');
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  if (Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd') !== text) {
    throw new Error(label + ' is not a valid calendar date');
  }
  return date;
}

function cawplanSupportSheetDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CAWPLAN_SUPPORT_CONFIG.timezone, 'yyyy-MM-dd');
  }
  var text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    cawplanSupportParseIsoDate_(text, 'sheet date');
    return text;
  }
  return '';
}

function cawplanSupportIdentity_(item) {
  return [
    item.domain,
    item.metric,
    item.timestamp,
    item.dimensions.product,
    item.tags.product_line,
    item.tags.channel,
    item.tags.assignee,
    item.tags.source_system
  ].join('|');
}

function cawplanSupportCompareItems_(a, b) {
  var left = [
    a.timestamp,
    a.dimensions.product,
    a.tags.product_line,
    a.tags.channel,
    a.tags.assignee
  ].join('|');
  var right = [
    b.timestamp,
    b.dimensions.product,
    b.tags.product_line,
    b.tags.channel,
    b.tags.assignee
  ].join('|');
  return left < right ? -1 : left > right ? 1 : 0;
}

function cawplanSupportRfc3339Now_() {
  var compact = Utilities.formatDate(
    new Date(),
    CAWPLAN_SUPPORT_CONFIG.timezone,
    "yyyy-MM-dd'T'HH:mm:ssZ"
  );
  return compact.slice(0, compact.length - 2) + ':' + compact.slice(-2);
}

function cawplanSupportSha256_(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function cawplanSupportNormalizeHeader_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cawplanSupportSlug_(value) {
  var slug = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) throw new Error('Cannot create assignee slug from: ' + value);
  return slug;
}

function cawplanSupportArrayToSet_(values) {
  var out = {};
  for (var i = 0; i < values.length; i++) out[values[i]] = true;
  return out;
}

function cawplanSupportMaxSourceColumn_() {
  var max = 1;
  for (var s = 0; s < CAWPLAN_SUPPORT_CONFIG.sources.length; s++) {
    var columns = CAWPLAN_SUPPORT_CONFIG.sources[s].columns;
    for (var c = 0; c < columns.length; c++) {
      if (columns[c] > max) max = columns[c];
    }
  }
  return max;
}

function cawplanSupportMappedColumns_() {
  var seen = {};
  var columns = [];
  for (var s = 0; s < CAWPLAN_SUPPORT_CONFIG.sources.length; s++) {
    var sourceColumns = CAWPLAN_SUPPORT_CONFIG.sources[s].columns;
    for (var c = 0; c < sourceColumns.length; c++) {
      var column = sourceColumns[c];
      if (!seen[column]) {
        seen[column] = true;
        columns.push(column);
      }
    }
  }
  columns.sort(function (a, b) { return a - b; });
  return columns;
}

function cawplanSupportColumnLetter_(column) {
  var value = '';
  while (column > 0) {
    var remainder = (column - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    column = Math.floor((column - 1) / 26);
  }
  return value;
}
