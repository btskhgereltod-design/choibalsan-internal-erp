const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const variants = [
  ['EMA start', 'EMA_Trend_Pyramid_analysis.json'],
  ['H1 breakout', 'H1_Breakout_Pyramid_analysis.json'],
  ['Dual BUY+SELL', 'Dual_Trend_Pyramid_analysis.json'],
].map(([name, file]) => ({ name, data: JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8')).analysis }));
const outputPath = path.join(baseDir, 'All_Trend_Pyramid_Variants_Comparison.xlsx');

function directionValue(data, direction, field) {
  const item = data.byDirection.find((row) => row.direction === direction);
  return item ? item[field] : 0;
}

function addSheet(workbook, name, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

const workbook = XLSX.utils.book_new();
workbook.Props = { Title: 'All Trend Pyramid Variants', Author: 'Codex', CreatedDate: new Date() };
const metrics = [
  ['Initial deposit', (d) => d.report.initialDeposit],
  ['Net profit', (d) => d.report.totalNetProfit],
  ['Profit factor', (d) => d.report.profitFactor],
  ['Expected payoff / trade', (d) => d.report.expectedPayoff],
  ['Maximal drawdown', (d) => d.report.maximalDrawdown],
  ['Relative drawdown', (d) => d.report.relativeDrawdown],
  ['Tester spread', (d) => d.report.spread],
  ['Closed positions', (d) => d.report.totalTrades],
  ['Completed baskets', (d) => d.completed.baskets],
  ['Profitable baskets', (d) => d.completed.wins],
  ['Basket win rate', (d) => d.completed.winRatePct / 100],
  ['Final targets', (d) => d.completed.finalTargets],
  ['Basket stops', (d) => d.completed.basketStops],
  ['Average profit / basket', (d) => d.completed.averageProfit],
  ['BUY net profit', (d) => directionValue(d, 'buy', 'profit')],
  ['SELL net profit', (d) => directionValue(d, 'sell', 'profit')],
];
const summary = addSheet(workbook, 'Comparison', [
  ['Metric', ...variants.map((item) => item.name)],
  ...metrics.map(([label, getter]) => [label, ...variants.map((item) => getter(item.data))]),
  ['Caution', 'Spread 24', 'Spread 21', 'Spread 21'],
], [30, 22, 22, 22]);
for (const address of ['B12', 'C12', 'D12']) if (summary[address]) summary[address].z = '0.00%';

const years = [...new Set(variants.flatMap((item) => item.data.yearly.map((row) => row.year)))].sort();
addSheet(workbook, 'Yearly_Net', [
  ['Year', ...variants.map((item) => `${item.name} net`)],
  ...years.map((year) => [Number(year), ...variants.map((item) => {
    const row = item.data.yearly.find((entry) => entry.year === year);
    return row ? row.profit : 0;
  })]),
], [10, 20, 20, 20]);

addSheet(workbook, 'Level_Reach', [
  ['Variant', 'Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'],
  ...variants.map((item) => [item.name, ...[1, 2, 3, 4, 5].map((level) => {
    const row = item.data.byLevel.find((entry) => entry.level === level);
    return row ? row.reached : 0;
  })]),
], [22, 14, 14, 14, 14, 14]);

XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
