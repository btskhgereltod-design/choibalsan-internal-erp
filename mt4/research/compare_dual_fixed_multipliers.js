const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const variants = [
  ['Fixed x1', 'Dual_Trend_Pyramid_Fixed1_analysis.json'],
  ['Fixed x2', 'Dual_Trend_Pyramid_Multiplier2_analysis.json'],
  ['Fixed x3', 'Dual_Trend_Pyramid_analysis.json'],
].map(([name, file]) => ({ name, data: JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8')).analysis }));

function addSheet(workbook, name, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

function directionValue(data, direction) {
  return data.byDirection.find((row) => row.direction === direction)?.profit || 0;
}

function maximalDrawdownMoney(data) {
  return Number(data.report.maximalDrawdown.split(' ')[0]);
}

const workbook = XLSX.utils.book_new();
workbook.Props = { Title: 'Dual Trend Pyramid Fixed Multipliers', Author: 'Codex', CreatedDate: new Date() };
const metrics = [
  ['Initial deposit', (d) => d.report.initialDeposit],
  ['Net profit', (d) => d.report.totalNetProfit],
  ['Ending balance', (d) => d.report.initialDeposit + d.report.totalNetProfit],
  ['Profit factor', (d) => d.report.profitFactor],
  ['Expected payoff / trade', (d) => d.report.expectedPayoff],
  ['Absolute drawdown', (d) => d.report.absoluteDrawdown],
  ['Maximal drawdown', (d) => d.report.maximalDrawdown],
  ['Relative drawdown', (d) => d.report.relativeDrawdown],
  ['Net profit / max DD', (d) => d.report.totalNetProfit / maximalDrawdownMoney(d)],
  ['Total trades', (d) => d.report.totalTrades],
  ['Completed baskets', (d) => d.completed.baskets],
  ['Profitable baskets', (d) => d.completed.wins],
  ['Basket win rate', (d) => d.completed.winRatePct / 100],
  ['Final targets', (d) => d.completed.finalTargets],
  ['Average / basket', (d) => d.completed.averageProfit],
  ['BUY net', (d) => directionValue(d, 'buy')],
  ['SELL net', (d) => directionValue(d, 'sell')],
  ['Positive years', (d) => d.yearly.filter((row) => row.profit > 0).length],
  ['Negative years', (d) => d.yearly.filter((row) => row.profit < 0).length],
  ['Positive months', (d) => d.monthly.filter((row) => row.profit > 0).length],
  ['Negative months', (d) => d.monthly.filter((row) => row.profit < 0).length],
];

const summary = addSheet(workbook, 'Comparison', [
  ['Metric', ...variants.map((item) => item.name)],
  ...metrics.map(([label, getter]) => [label, ...variants.map((item) => getter(item.data))]),
], [30, 24, 24, 24]);
for (const address of ['B14', 'C14', 'D14']) if (summary[address]) summary[address].z = '0.00%';

const years = [...new Set(variants.flatMap((item) => item.data.yearly.map((row) => row.year)))].sort();
addSheet(workbook, 'Yearly_Net', [
  ['Year', ...variants.map((item) => `${item.name} net`)],
  ...years.map((year) => [Number(year), ...variants.map((item) => item.data.yearly.find((row) => row.year === year)?.profit || 0)]),
], [10, 22, 22, 22]);

const months = [...new Set(variants.flatMap((item) => item.data.monthly.map((row) => row.month)))].sort();
addSheet(workbook, 'Monthly_Net', [
  ['Month', ...variants.map((item) => `${item.name} net`)],
  ...months.map((month) => [month, ...variants.map((item) => item.data.monthly.find((row) => row.month === month)?.profit || 0)]),
], [14, 22, 22, 22]);

addSheet(workbook, 'Level_Results', [
  ['Variant', 'Level', 'Reached', 'Ended', 'Wins', 'Losses', 'Net profit', 'Average / basket'],
  ...variants.flatMap((item) => item.data.byLevel.map((row) => [
    item.name, row.level, row.reached, row.baskets, row.wins, row.losses, row.profit, row.averageProfit,
  ])),
], [18, 10, 14, 14, 12, 12, 18, 18]);

addSheet(workbook, 'Interpretation', [
  ['Finding', 'Meaning'],
  ['Same paths', 'All three tests have identical trade, basket, level-reach, and final-target counts. This is a clean multiplier comparison.'],
  ['Fixed x1', 'Lowest return and weakest profit factor, but lowest drawdown, most positive months, and best net-profit-to-max-drawdown ratio.'],
  ['Fixed x2', 'Middle return and risk; strongest count of positive years in this sample.'],
  ['Fixed x3', 'Highest raw profit, but exposure and drawdown rise much faster than profit.'],
  ['SELL side', 'Fixed x1 SELL is negative over the full sample. Removing it requires a separate test because simultaneous-side behavior may change.'],
  ['Validation', 'Profit factors remain close to 1 and tests use Current spread with 90% MT4 modelling. None is live-ready.'],
], [26, 115]);

const outputPath = path.join(baseDir, 'Dual_Trend_Pyramid_Fixed1_vs_2_vs_3_Comparison.xlsx');
XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
