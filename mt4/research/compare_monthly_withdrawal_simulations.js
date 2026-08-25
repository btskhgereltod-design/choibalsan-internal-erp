const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const variants = [
  ['Fixed x1', 'Dual_Trend_Pyramid_Fixed1_Monthly_Withdrawal_Simulation.xlsx'],
  ['AutoScale x1.5', 'Dual_Trend_Pyramid_AutoScale15_Monthly_Withdrawal_Simulation.xlsx'],
  ['Fixed x2', 'Dual_Trend_Pyramid_Multiplier2_Monthly_Withdrawal_Simulation.xlsx'],
].map(([name, file]) => {
  const workbook = XLSX.readFile(path.join(baseDir, file));
  const summary = Object.fromEntries(XLSX.utils.sheet_to_json(workbook.Sheets.Summary, { header: 1 }).slice(1).map((row) => [row[0], row[1]]));
  const monthly = XLSX.utils.sheet_to_json(workbook.Sheets.Monthly);
  return { name, summary, monthly };
});

function addSheet(workbook, name, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

function largestWithdrawal(item) {
  return Math.max(0, ...item.monthly.map((row) => Number(row.Withdrawal) || 0));
}

function longestNoWithdrawalRun(item) {
  let longest = 0;
  let current = 0;
  for (const row of item.monthly) {
    if ((Number(row.Withdrawal) || 0) > 0) current = 0;
    else {
      current += 1;
      longest = Math.max(longest, current);
    }
  }
  return longest;
}

const workbook = XLSX.utils.book_new();
workbook.Props = { Title: 'Monthly Withdrawal Simulations', Author: 'Codex', CreatedDate: new Date() };
const fields = [
  ['Original net profit', 'Original net profit'],
  ['Original ending balance', 'Original ending balance'],
  ['Total simulated withdrawals', 'Total simulated withdrawals'],
  ['Months with withdrawal', 'Months with withdrawal'],
  ['Ending virtual balance', 'Ending virtual balance'],
  ['Lowest virtual month-end balance', 'Lowest virtual month-end balance'],
  ['Largest deficit below 10k', 'Largest month-end deficit below target'],
];
addSheet(workbook, 'Comparison', [
  ['Metric', ...variants.map((item) => item.name)],
  ...fields.map(([label, key]) => [label, ...variants.map((item) => item.summary[key])]),
  ['Largest single withdrawal', ...variants.map(largestWithdrawal)],
  ['Longest run without withdrawal (months)', ...variants.map(longestNoWithdrawalRun)],
  ['Ending capital ratio', ...variants.map((item) => Number(item.summary['Ending virtual balance']) / Number(item.summary['Target capital retained']))],
], [38, 24, 24, 24]);

const months = [...new Set(variants.flatMap((item) => item.monthly.map((row) => row.Month)))].sort();
addSheet(workbook, 'Monthly_Withdrawals', [
  ['Month', ...variants.map((item) => `${item.name} withdrawal`)],
  ...months.map((month) => [month, ...variants.map((item) => item.monthly.find((row) => row.Month === month)?.Withdrawal || 0)]),
], [14, 24, 24, 24]);

addSheet(workbook, 'Virtual_Balance', [
  ['Month', ...variants.map((item) => `${item.name} virtual balance`)],
  ...months.map((month) => [month, ...variants.map((item) => item.monthly.find((row) => row.Month === month)?.['Virtual after withdrawal'] || '')]),
], [14, 25, 25, 25]);

addSheet(workbook, 'Interpretation', [
  ['Finding', 'Meaning'],
  ['Withdraw-all rule', 'Taking every dollar above 10,000 removes the reserve created during profitable periods. Later losing periods can push the retained account materially below 10,000.'],
  ['Fixed x2', 'Produces the largest withdrawals, but also the lowest ending virtual capital and largest deficit in this comparison.'],
  ['AutoScale x1.5 caveat', 'This is post-processing of a test whose lot size scaled on the unwithdrawn MT4 balance. Real monthly withdrawals would have prevented some scaling, so this column overstates comparable withdrawals.'],
  ['Balance-only', 'Open floating equity at calendar month-end is not present in the MT4 HTML report and is not deducted here.'],
  ['Research only', 'The simulation does not alter historical margin availability or order acceptance.'],
], [28, 115]);

const outputPath = path.join(baseDir, 'Dual_Monthly_Withdrawal_x1_vs_Auto15_vs_x2_Comparison.xlsx');
XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
