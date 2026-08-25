const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const variants = [
  ['Lot multiplier x2', 'Dual_Trend_Pyramid_Multiplier2_analysis.json'],
  ['Lot multiplier x3', 'Dual_Trend_Pyramid_analysis.json'],
].map(([name, file]) => ({ name, data: JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8')).analysis }));

function addSheet(workbook, name, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

function directionValue(data, direction, field) {
  return data.byDirection.find((row) => row.direction === direction)?.[field] || 0;
}

const workbook = XLSX.utils.book_new();
workbook.Props = { Title: 'Dual Trend Pyramid x2 vs x3', Author: 'Codex', CreatedDate: new Date() };
const metrics = [
  ['Initial deposit', (d) => d.report.initialDeposit],
  ['Net profit', (d) => d.report.totalNetProfit],
  ['Ending balance', (d) => d.report.initialDeposit + d.report.totalNetProfit],
  ['Profit factor', (d) => d.report.profitFactor],
  ['Expected payoff / trade', (d) => d.report.expectedPayoff],
  ['Absolute drawdown', (d) => d.report.absoluteDrawdown],
  ['Maximal drawdown', (d) => d.report.maximalDrawdown],
  ['Relative drawdown', (d) => d.report.relativeDrawdown],
  ['Closed positions', (d) => d.report.totalTrades],
  ['Completed baskets', (d) => d.completed.baskets],
  ['Profitable baskets', (d) => d.completed.wins],
  ['Basket win rate', (d) => d.completed.winRatePct / 100],
  ['Final targets', (d) => d.completed.finalTargets],
  ['Average profit / basket', (d) => d.completed.averageProfit],
  ['BUY net profit', (d) => directionValue(d, 'buy', 'profit')],
  ['SELL net profit', (d) => directionValue(d, 'sell', 'profit')],
  ['Positive years', (d) => d.yearly.filter((row) => row.profit > 0).length],
  ['Negative years', (d) => d.yearly.filter((row) => row.profit < 0).length],
  ['Positive months', (d) => d.monthly.filter((row) => row.profit > 0).length],
  ['Negative months', (d) => d.monthly.filter((row) => row.profit < 0).length],
];

const summary = addSheet(workbook, 'Comparison', [
  ['Metric', ...variants.map((item) => item.name), 'x2 minus x3'],
  ...metrics.map(([label, getter]) => {
    const values = variants.map((item) => getter(item.data));
    return [label, ...values, typeof values[0] === 'number' && typeof values[1] === 'number' ? values[0] - values[1] : ''];
  }),
], [30, 24, 24, 24]);
for (const address of ['B13', 'C13']) if (summary[address]) summary[address].z = '0.00%';

const years = [...new Set(variants.flatMap((item) => item.data.yearly.map((row) => row.year)))].sort();
addSheet(workbook, 'Yearly_Net', [
  ['Year', ...variants.map((item) => `${item.name} net`), 'x2 minus x3'],
  ...years.map((year) => {
    const values = variants.map((item) => item.data.yearly.find((row) => row.year === year)?.profit || 0);
    return [Number(year), ...values, values[0] - values[1]];
  }),
], [10, 22, 22, 22]);

addSheet(workbook, 'Level_Results', [
  ['Variant', 'Level', 'Reached', 'Ended', 'Wins', 'Losses', 'Net profit', 'Average / basket'],
  ...variants.flatMap((item) => item.data.byLevel.map((row) => [
    item.name, row.level, row.reached, row.baskets, row.wins, row.losses, row.profit, row.averageProfit,
  ])),
], [22, 10, 14, 14, 12, 12, 18, 18]);

const months = [...new Set(variants.flatMap((item) => item.data.monthly.map((row) => row.month)))].sort();
addSheet(workbook, 'Monthly_Net', [
  ['Month', ...variants.map((item) => `${item.name} net`), 'x2 minus x3'],
  ...months.map((month) => {
    const values = variants.map((item) => item.data.monthly.find((row) => row.month === month)?.profit || 0);
    return [month, ...values, values[0] - values[1]];
  }),
], [14, 22, 22, 22]);

addSheet(workbook, 'Interpretation', [
  ['Finding', 'Meaning'],
  ['Same market paths', 'Both tests have the same trade, basket, level-reach, and final-target counts. The multiplier changes money exposure, not entry timing.'],
  ['x2 risk', 'x2 materially lowers maximal and relative drawdown and reduces maximum open lots from 1.21 to 0.31 per side.'],
  ['x2 return', 'x2 gives up substantial net profit and expected payoff compared with x3.'],
  ['Level behavior', 'With the common stop 10 below the latest entry, theoretical x2 basket exits are -10, -10, +10, +70, +210 at levels 1-5.'],
  ['Robustness', 'Profit factor remains close to 1. Backtests use Current spread and 90% MT4 modelling, so live profitability is not proven.'],
], [26, 115]);

const outputPath = path.join(baseDir, 'Dual_Trend_Pyramid_Multiplier2_vs_3_Comparison.xlsx');
XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
