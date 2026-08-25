const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const reportPath = process.argv[2] || path.join(__dirname, 'Dual_Trend_Pyramid_Fixed1_Report.htm');
const targetCapital = Number(process.argv[3] || 10000);
const outputPath = process.argv[4] || path.join(__dirname, 'Dual_Trend_Pyramid_Fixed1_Monthly_Withdrawal_Simulation.xlsx');
const html = fs.readFileSync(reportPath, 'utf8');

function stripHtml(value) {
  return value.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').trim();
}

function numberAfter(label) {
  const match = html.match(new RegExp(`<td>${label}<\\/td><td align=right>([-0-9.]+)`, 'i'));
  return match ? Number(match[1]) : null;
}

const periodMatch = html.match(/<td colspan=2>Period<\/td><td colspan=4>([\s\S]*?)<\/td>/i);
const parametersMatch = html.match(/<td colspan=2>Parameters<\/td><td colspan=4>([\s\S]*?)<\/td>/i);
const closeEvents = [];

for (const row of html.matchAll(/<tr(?:\s+[^>]*)?>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<td(?:\s+[^>]*)?>([\s\S]*?)<\/td>/gi)].map((item) => stripHtml(item[1]));
  if (cells.length !== 10 || !/^\d+$/.test(cells[0])) continue;
  const type = cells[2].toLowerCase();
  if (!['close', 's/l', 't/p', 'close at stop'].includes(type)) continue;
  closeEvents.push({
    row: Number(cells[0]),
    time: cells[1],
    month: cells[1].slice(0, 7),
    type,
    profit: Number(cells[8]),
    balance: Number(cells[9]),
  });
}

if (!closeEvents.length) throw new Error('No closing transactions found in report.');

const initialDeposit = numberAfter('Initial deposit');
const reportNetProfit = numberAfter('Total net profit');
const finalReportBalance = closeEvents[closeEvents.length - 1].balance;
const finalTestMonth = closeEvents[closeEvents.length - 1].month;
const monthEndBalance = new Map();
for (const event of closeEvents) monthEndBalance.set(event.month, event.balance);

let previousOriginalBalance = initialDeposit;
let virtualBalance = targetCapital;
let cumulativeWithdrawal = 0;
let lowestVirtualMonthEnd = virtualBalance;
let maximumRecoveryDeficit = 0;
let withdrawalMonths = 0;
const monthlyRows = [];

for (const [month, originalBalance] of [...monthEndBalance.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const tradingProfit = originalBalance - previousOriginalBalance;
  previousOriginalBalance = originalBalance;
  virtualBalance += tradingProfit;
  const beforeWithdrawal = virtualBalance;
  const isCompleteMonth = month !== finalTestMonth;
  const withdrawal = isCompleteMonth && virtualBalance > targetCapital ? virtualBalance - targetCapital : 0;
  if (withdrawal > 0) {
    virtualBalance -= withdrawal;
    cumulativeWithdrawal += withdrawal;
    withdrawalMonths += 1;
  }
  lowestVirtualMonthEnd = Math.min(lowestVirtualMonthEnd, virtualBalance);
  maximumRecoveryDeficit = Math.max(maximumRecoveryDeficit, targetCapital - virtualBalance);
  monthlyRows.push({
    month,
    isCompleteMonth,
    originalBalance,
    tradingProfit,
    beforeWithdrawal,
    withdrawal,
    virtualBalance,
    cumulativeWithdrawal,
    deficit: Math.max(0, targetCapital - virtualBalance),
  });
}

const yearlyMap = new Map();
for (const row of monthlyRows) {
  const year = row.month.slice(0, 4);
  if (!yearlyMap.has(year)) yearlyMap.set(year, { profit: 0, withdrawal: 0, months: 0, withdrawalMonths: 0 });
  const item = yearlyMap.get(year);
  item.profit += row.tradingProfit;
  item.withdrawal += row.withdrawal;
  item.months += 1;
  if (row.withdrawal > 0) item.withdrawalMonths += 1;
}

function addSheet(workbook, name, rows, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

const workbook = XLSX.utils.book_new();
workbook.Props = { Title: 'Fixed x1 Monthly Withdrawal Simulation', Author: 'Codex', CreatedDate: new Date() };
addSheet(workbook, 'Summary', [
  ['Metric', 'Value'],
  ['Source report', path.basename(reportPath)],
  ['Period', periodMatch ? stripHtml(periodMatch[1]) : ''],
  ['Parameters', parametersMatch ? stripHtml(parametersMatch[1]) : ''],
  ['Original initial deposit', initialDeposit],
  ['Original net profit', reportNetProfit],
  ['Original ending balance', finalReportBalance],
  ['Target capital retained', targetCapital],
  ['Total simulated withdrawals', Number(cumulativeWithdrawal.toFixed(2))],
  ['Months with withdrawal', withdrawalMonths],
  ['Ending virtual balance', Number(virtualBalance.toFixed(2))],
  ['Withdrawals + ending virtual balance', Number((cumulativeWithdrawal + virtualBalance).toFixed(2))],
  ['Lowest virtual month-end balance', Number(lowestVirtualMonthEnd.toFixed(2))],
  ['Largest month-end deficit below target', Number(maximumRecoveryDeficit.toFixed(2))],
  ['Final partial month withdrawn?', 'No'],
  ['Simulation type', 'Balance-only, month-end realized balance; open floating equity is not deducted'],
], [38, 115]);

addSheet(workbook, 'Monthly', [
  ['Month', 'Complete month', 'Original month-end balance', 'Trading P/L', 'Virtual before withdrawal',
    'Withdrawal', 'Virtual after withdrawal', 'Cumulative withdrawal', 'Deficit below 10k'],
  ...monthlyRows.map((row) => [row.month, row.isCompleteMonth ? 'Yes' : 'No', row.originalBalance,
    Number(row.tradingProfit.toFixed(2)), Number(row.beforeWithdrawal.toFixed(2)), Number(row.withdrawal.toFixed(2)),
    Number(row.virtualBalance.toFixed(2)), Number(row.cumulativeWithdrawal.toFixed(2)), Number(row.deficit.toFixed(2))]),
], [14, 16, 26, 16, 25, 16, 24, 24, 20]);

addSheet(workbook, 'Yearly', [
  ['Year', 'Months in test', 'Trading P/L', 'Withdrawals', 'Withdrawal months'],
  ...[...yearlyMap.entries()].map(([year, row]) => [Number(year), row.months, Number(row.profit.toFixed(2)),
    Number(row.withdrawal.toFixed(2)), row.withdrawalMonths]),
], [10, 16, 18, 18, 20]);

addSheet(workbook, 'Rules_And_Limits', [
  ['Item', 'Detail'],
  ['Withdrawal rule', 'At the end of each completed calendar month, withdraw virtual balance above 10,000 and retain 10,000.'],
  ['Loss recovery', 'If virtual balance is below 10,000, no withdrawal occurs until later trading profits recover the deficit.'],
  ['Final partial month', 'The last test month is not treated as month-end and no withdrawal is made.'],
  ['Equity limitation', 'MT4 HTML reports do not contain floating equity at each calendar month-end. This sheet is balance-only.'],
  ['Execution limitation', 'Withdrawals are post-processed and do not change MT4 free margin or order acceptance during the original test.'],
  ['Use', 'Research simulation only. A live withdrawal must also preserve equity and free-margin buffers.'],
], [28, 115]);

XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(JSON.stringify({ outputPath, totalWithdrawals: Number(cumulativeWithdrawal.toFixed(2)), withdrawalMonths,
  endingVirtualBalance: Number(virtualBalance.toFixed(2)), lowestVirtualMonthEnd: Number(lowestVirtualMonthEnd.toFixed(2)),
  maximumRecoveryDeficit: Number(maximumRecoveryDeficit.toFixed(2)) }, null, 2));
