const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const sources = [
  ['Fixed x1', 'Dual_Trend_Pyramid_Fixed1_analysis.json'],
  ['AutoScale x1.5', 'Dual_Trend_Pyramid_AutoScale15_analysis.json'],
  ['Fixed x2', 'Dual_Trend_Pyramid_Multiplier2_analysis.json'],
  ['Fixed x3', 'Dual_Trend_Pyramid_analysis.json'],
].map(([name, file]) => ({ name, source: JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8')) }));

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

const workbook = XLSX.utils.book_new();
workbook.Props = { Title: 'AutoScale x1.5 vs Fixed Multipliers', Author: 'Codex', CreatedDate: new Date() };
const metrics = [
  ['Initial deposit', (d) => d.report.initialDeposit],
  ['Net profit', (d) => d.report.totalNetProfit],
  ['Ending balance', (d) => d.report.initialDeposit + d.report.totalNetProfit],
  ['Profit factor', (d) => d.report.profitFactor],
  ['Expected payoff / trade', (d) => d.report.expectedPayoff],
  ['Absolute drawdown', (d) => d.report.absoluteDrawdown],
  ['Maximal drawdown', (d) => d.report.maximalDrawdown],
  ['Relative drawdown', (d) => d.report.relativeDrawdown],
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
  ['Metric', ...sources.map((item) => item.name)],
  ...metrics.map(([label, getter]) => [label, ...sources.map((item) => getter(item.source.analysis))]),
], [30, 24, 24, 24, 24]);
for (const address of ['B13', 'C13', 'D13', 'E13']) if (summary[address]) summary[address].z = '0.00%';

const auto = sources[1].source;
const baseGroups = new Map();
for (const basket of auto.baskets.filter((item) => item.exitType !== 'test_end')) {
  const baseLot = basket.trades[0]?.size || 0;
  if (!baseGroups.has(baseLot)) baseGroups.set(baseLot, []);
  baseGroups.get(baseLot).push(basket);
}
addSheet(workbook, 'AutoScale_Base_Lots', [
  ['Base lot', 'Baskets', 'Wins', 'Final targets', 'Net profit', 'Average / basket', 'First basket', 'Last basket'],
  ...[...baseGroups.entries()].sort((a, b) => a[0] - b[0]).map(([baseLot, baskets]) => {
    const profit = baskets.reduce((sum, item) => sum + item.profit, 0);
    return [baseLot, baskets.length, baskets.filter((item) => item.profit > 0).length,
      baskets.filter((item) => item.exitType === 'final_target').length,
      Number(profit.toFixed(2)), Number((profit / baskets.length).toFixed(4)),
      baskets[0].startTime, baskets[baskets.length - 1].startTime];
  }),
], [12, 14, 12, 16, 18, 18, 20, 20]);

const years = [...new Set(sources.flatMap((item) => item.source.analysis.yearly.map((row) => row.year)))].sort();
addSheet(workbook, 'Yearly_Net', [
  ['Year', ...sources.map((item) => `${item.name} net`)],
  ...years.map((year) => [Number(year), ...sources.map((item) => item.source.analysis.yearly.find((row) => row.year === year)?.profit || 0)]),
], [10, 22, 22, 22, 22]);

addSheet(workbook, 'Level_Results', [
  ['Variant', 'Level', 'Reached', 'Ended', 'Wins', 'Losses', 'Net profit', 'Average / basket'],
  ...sources.flatMap((item) => item.source.analysis.byLevel.map((row) => [
    item.name, row.level, row.reached, row.baskets, row.wins, row.losses, row.profit, row.averageProfit,
  ])),
], [22, 10, 14, 14, 12, 12, 18, 18]);

addSheet(workbook, 'Interpretation', [
  ['Finding', 'Meaning'],
  ['AutoScale worked', 'Base lot advanced from 0.01 to 0.02 after capital crossed the 20,000 tier. Each basket retained its starting base lot.'],
  ['Weak scaled segment', 'The 0.02-base baskets added little net profit in this sample. Scaling exposure did not create a stronger edge.'],
  ['Fixed x1', 'Fixed x1 has the lowest raw return, but the lowest drawdown and best net-profit-to-max-drawdown ratio.'],
  ['Risk', 'AutoScale x1.5 has the lowest drawdown of the three, but its profit factor is also the weakest and close to break-even.'],
  ['Comparison caveat', 'x1.5 uses changing base lots while x2 and x3 use fixed 0.01. The comparison measures complete configurations, not multiplier alone.'],
  ['Validation', 'Current-spread, 90% MT4 modelling is insufficient for live deployment. Use independent tick data and out-of-sample periods next.'],
], [28, 115]);

const outputPath = path.join(baseDir, 'Dual_Fixed1_AutoScale15_Fixed2_Fixed3_Comparison.xlsx');
XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
