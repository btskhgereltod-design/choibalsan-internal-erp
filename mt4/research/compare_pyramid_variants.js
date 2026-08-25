const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const ema = JSON.parse(fs.readFileSync(path.join(baseDir, 'EMA_Trend_Pyramid_analysis.json'), 'utf8')).analysis;
const breakout = JSON.parse(fs.readFileSync(path.join(baseDir, 'H1_Breakout_Pyramid_analysis.json'), 'utf8')).analysis;
const outputPath = path.join(baseDir, 'EMA_vs_H1_Breakout_Pyramid_Comparison.xlsx');

function directionValue(analysis, direction, field) {
  const row = analysis.byDirection.find((item) => item.direction === direction);
  return row ? row[field] : 0;
}

function levelValue(analysis, level, field) {
  const row = analysis.byLevel.find((item) => item.level === level);
  return row ? row[field] : 0;
}

function addSheet(workbook, name, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

const workbook = XLSX.utils.book_new();
workbook.Props = {
  Title: 'EMA vs H1 Breakout Trend Pyramid Comparison',
  Author: 'Codex',
  CreatedDate: new Date(),
};

const summary = addSheet(workbook, 'Comparison', [
  ['Metric', 'EMA start', 'H1 open +/-10 breakout', 'Difference (Breakout - EMA)'],
  ['Initial deposit', ema.report.initialDeposit, breakout.report.initialDeposit, breakout.report.initialDeposit - ema.report.initialDeposit],
  ['Net profit', ema.report.totalNetProfit, breakout.report.totalNetProfit, breakout.report.totalNetProfit - ema.report.totalNetProfit],
  ['Profit factor', ema.report.profitFactor, breakout.report.profitFactor, breakout.report.profitFactor - ema.report.profitFactor],
  ['Expected payoff / trade', ema.report.expectedPayoff, breakout.report.expectedPayoff, breakout.report.expectedPayoff - ema.report.expectedPayoff],
  ['Maximal drawdown', ema.report.maximalDrawdown, breakout.report.maximalDrawdown, ''],
  ['Relative drawdown', ema.report.relativeDrawdown, breakout.report.relativeDrawdown, ''],
  ['Tester spread', ema.report.spread, breakout.report.spread, 'Not controlled'],
  ['Closed positions', ema.report.totalTrades, breakout.report.totalTrades, breakout.report.totalTrades - ema.report.totalTrades],
  ['Completed baskets', ema.completed.baskets, breakout.completed.baskets, breakout.completed.baskets - ema.completed.baskets],
  ['Profitable baskets', ema.completed.wins, breakout.completed.wins, breakout.completed.wins - ema.completed.wins],
  ['Basket win rate', ema.completed.winRatePct / 100, breakout.completed.winRatePct / 100, (breakout.completed.winRatePct - ema.completed.winRatePct) / 100],
  ['Final targets', ema.completed.finalTargets, breakout.completed.finalTargets, breakout.completed.finalTargets - ema.completed.finalTargets],
  ['Basket stops', ema.completed.basketStops, breakout.completed.basketStops, breakout.completed.basketStops - ema.completed.basketStops],
  ['Average profit / basket', ema.completed.averageProfit, breakout.completed.averageProfit, breakout.completed.averageProfit - ema.completed.averageProfit],
  ['BUY net profit', directionValue(ema, 'buy', 'profit'), directionValue(breakout, 'buy', 'profit'), directionValue(breakout, 'buy', 'profit') - directionValue(ema, 'buy', 'profit')],
  ['SELL net profit', directionValue(ema, 'sell', 'profit'), directionValue(breakout, 'sell', 'profit'), directionValue(breakout, 'sell', 'profit') - directionValue(ema, 'sell', 'profit')],
  ['', '', '', ''],
  ['Caution', 'Current spread 24', 'Current spread 21', 'Rerun both with the same fixed spread for a controlled comparison.'],
], [30, 24, 28, 48]);
for (const address of ['B12', 'C12', 'D12']) if (summary[address]) summary[address].z = '0.00%';

const years = [...new Set([...ema.yearly.map((item) => item.year), ...breakout.yearly.map((item) => item.year)])].sort();
addSheet(workbook, 'Yearly_Comparison', [
  ['Year', 'EMA net', 'Breakout net', 'Difference', 'EMA baskets', 'Breakout baskets', 'EMA targets', 'Breakout targets'],
  ...years.map((year) => {
    const left = ema.yearly.find((item) => item.year === year) || {};
    const right = breakout.yearly.find((item) => item.year === year) || {};
    return [Number(year), left.profit || 0, right.profit || 0, (right.profit || 0) - (left.profit || 0), left.baskets || 0, right.baskets || 0, left.finalTargets || 0, right.finalTargets || 0];
  }),
], [10, 16, 16, 16, 16, 18, 14, 18]);

addSheet(workbook, 'Level_Comparison', [
  ['Level', 'EMA reached', 'Breakout reached', 'EMA ended', 'Breakout ended', 'EMA net', 'Breakout net'],
  ...[1, 2, 3, 4, 5].map((level) => [
    level,
    levelValue(ema, level, 'reached'),
    levelValue(breakout, level, 'reached'),
    levelValue(ema, level, 'baskets'),
    levelValue(breakout, level, 'baskets'),
    levelValue(ema, level, 'profit'),
    levelValue(breakout, level, 'profit'),
  ]),
], [10, 16, 18, 14, 18, 16, 18]);

XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
