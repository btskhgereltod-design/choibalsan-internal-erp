"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { safeCell, toCsv } = require("../src/utils/csv");

test("CSV cells escape quotes and spreadsheet formulas", () => {
  assert.equal(safeCell('a"b'), '"a""b"');
  assert.equal(safeCell("=1+1"), '"\'=1+1"');
  assert.equal(safeCell("-10"), '"\'-10"');
});

test("CSV export includes a UTF-8 BOM for Excel", () => {
  assert.equal(toCsv(["Нэр"], [["Тест"]]).startsWith("\uFEFF"), true);
});
