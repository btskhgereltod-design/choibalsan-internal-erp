"use strict";

function safeCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(headers, rows) {
  return "\uFEFF" + [headers, ...rows].map(row => row.map(safeCell).join(",")).join("\r\n");
}

module.exports = { safeCell, toCsv };
