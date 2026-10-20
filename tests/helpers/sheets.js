'use strict';
// Fills a tab of a fake spreadsheet with rows of text (header row included), kept as text.
function fillTab(ss, tabName, rows) {
  const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  if (!rows.length) return sheet;
  const width = Math.max(...rows.map((r) => r.length));
  const full = rows.map((r) => r.concat(Array(width - r.length).fill('')));
  if (full.length > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), full.length - sheet.getMaxRows());
  const range = sheet.getRange(1, 1, full.length, width);
  range.setNumberFormat('@');
  range.setValues(full);
  return sheet;
}

// The tab as rows of display text.
function readTab(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet || sheet.getLastRow() === 0) return [];
  return sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getDisplayValues();
}

module.exports = { fillTab, readTab };
