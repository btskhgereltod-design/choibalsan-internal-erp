const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const variants = [
  ['Price stop 10', 'Dual_Trend_Pyramid_analysis.json'],
  ['Money stop $20', 'Dual_Trend_Pyramid_MoneyStop20_analysis.json'],
].map(([name, file]) => {
  const source = JSON.parse(fs.readFileSync(path.join(baseDir, file), 'utf8'));
  return { name, data: source.analysis, baskets: source.baskets.filter((item) => item.exitType !== 'test_end') };
});

function addSheet(workbook, name, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

function directionValue(data, direction, field) {
  const item = data.byDirection.find((row) => row.direction === direction);
  return item ? item[field] : 0;
}

function lossStats(item) {
  const values = item.baskets.filter((basket) => basket.profit < 0).map((basket) => basket.profit).sort((a, b) => a - b);
  return {
    count: values.length,
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    median: values[Math.floor(values.length / 2)],
    worst: values[0],
    atOrBelow25: values.filter((value) => value <= -25).length,
  };
}

const workbook = XLSX.utils.book_new();
workbook.Props = {
  Title: 'Dual Pyramid Price Stop vs Money Stop 20',
  Author: 'Codex',
  CreatedDate: new Date(),
};

const metrics = [
  ['Initial deposit', (item) => item.data.report.initialDeposit],
  ['Net profit', (item) => item.data.report.totalNetProfit],
  ['Ending balance', (item) => item.data.report.initialDeposit + item.data.report.totalNetProfit],
  ['Profit factor', (item) => item.data.report.profitFactor],
  ['Expected payoff / trade', (item) => item.data.report.expectedPayoff],
  ['Absolute drawdown', (item) => item.data.report.absoluteDrawdown],
  ['Maximal drawdown', (item) => item.data.report.maximalDrawdown],
  ['Relative drawdown', (item) => item.data.report.relativeDrawdown],
  ['Tester spread', (item) => item.data.report.spread],
  ['Closed positions', (item) => item.data.report.totalTrades],
  ['Completed baskets', (item) => item.data.completed.baskets],
  ['Profitable baskets', (item) => item.data.completed.wins],
  ['Losing baskets', (item) => item.data.completed.losses],
  ['Basket win rate', (item) => item.data.completed.winRatePct / 100],
  ['Final targets', (item) => item.data.completed.finalTargets],
  ['Average profit / basket', (item) => item.data.completed.averageProfit],
  ['BUY net profit', (item) => directionValue(item.data, 'buy', 'profit')],
  ['SELL net profit', (item) => directionValue(item.data, 'sell', 'profit')],
  ['Average losing basket', (item) => lossStats(item).average],
  ['Median losing basket', (item) => lossStats(item).median],
  ['Worst basket', (item) => lossStats(item).worst],
  ['Losses <= -$25', (item) => lossStats(item).atOrBelow25],
];

const summary = addSheet(workbook, 'Comparison', [
  ['Metric', ...variants.map((item) => item.name), 'Money stop change'],
  ...metrics.map(([label, getter]) => {
    const values = variants.map(getter);
    const change = typeof values[0] === 'number' && typeof values[1] === 'number' ? values[1] - values[0] : '';
    return [label, ...values, change];
  }),
], [30, 24, 24, 24]);
for (const address of ['B15', 'C15']) if (summary[address]) summary[address].z = '0.00%';

const years = [...new Set(variants.flatMap((item) => item.data.yearly.map((row) => row.year)))].sort();
addSheet(workbook, 'Yearly_Net', [
  ['Year', ...variants.map((item) => `${item.name} net`), 'Money stop difference'],
  ...years.map((year) => {
    const values = variants.map((item) => item.data.yearly.find((row) => row.year === year)?.profit || 0);
    return [Number(year), ...values, values[1] - values[0]];
  }),
], [10, 22, 22, 22]);

addSheet(workbook, 'Level_Distribution', [
  ['Variant', 'Level', 'Reached', 'Ended', 'Wins', 'Losses', 'Net profit', 'Average / basket'],
  ...variants.flatMap((item) => item.data.byLevel.map((row) => [
    item.name, row.level, row.reached, row.baskets, row.wins, row.losses, row.profit, row.averageProfit,
  ])),
], [22, 10, 14, 14, 12, 12, 18, 18]);

addSheet(workbook, 'Direction', [
  ['Variant', 'Direction', 'Baskets', 'Wins', 'Losses', 'Net profit', 'Average / basket'],
  ...variants.flatMap((item) => item.data.byDirection.map((row) => [
    item.name, row.direction.toUpperCase(), row.baskets, row.wins, row.losses, row.profit, row.averageProfit,
  ])),
], [22, 12, 14, 12, 12, 18, 18]);

addSheet(workbook, 'Interpretation', [
  ['Finding', 'Meaning'],
  ['Money stop enforcement', 'Median losing basket is close to -$20. Some closes exceed it because of spread, slippage, gaps, or the broker emergency stop.'],
  ['Profit', 'Money stop remains profitable in this test, but produces less total net profit than price stop 10.'],
  ['Drawdown', 'Maximal dollar drawdown falls, but relative drawdown remains severe. Repeated small losses can accumulate before a rare level-5 target.'],
  ['Robustness', 'Both tests use Current spread and 90% MT4 modelling. This is research evidence, not proof of live profitability.'],
  ['Parser note', 'Software EA closes appear as close events, so MT4 close labels alone do not identify every money-stop exit. Profit distribution is the reliable check.'],
], [28, 115]);

const outputPath = path.join(baseDir, 'Dual_PriceStop10_vs_MoneyStop20_Comparison.xlsx');
XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
