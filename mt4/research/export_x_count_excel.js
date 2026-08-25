const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const baseDir = __dirname;
const summary = JSON.parse(fs.readFileSync(path.join(baseDir, 'mt4-report-analysis.json'), 'utf8'));
const cycles = JSON.parse(fs.readFileSync(path.join(baseDir, 'mt4-report-cycles.json'), 'utf8'));
const outputPath = path.join(baseDir, 'Gold_EMA_X_Count_Analysis.xlsx');

function addSheet(workbook, name, rows, widths, autoFilter = true) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (autoFilter && rows.length > 1) {
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: rows[0].length - 1 } }) };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, name);
}

const workbook = XLSX.utils.book_new();
workbook.Props = {
  Title: 'Gold EMA Recovery - BUY(x) SELL(x) Analysis',
  Subject: 'MT4 backtest cycle analysis',
  Author: 'Codex',
  CreatedDate: new Date(),
};

addSheet(workbook, 'Summary', [
  ['Metric', 'Value'],
  ['Test period', '2020.01.02 06:00 - 2026.08.14 23:00'],
  ['Symbol / timeframe', 'XAUUSD / H1'],
  ['Model', 'Every tick, 90.00% modelling quality'],
  ['Start lot', 0.01],
  ['Lot multiplier', 1],
  ['Configured max trades', summary.configuredMaxTrades],
  ['Completed cycles', summary.overall.cycles],
  ['Total closed trades', summary.tradeCount],
  ['Maximum observed cycle level', summary.maximumObservedLevel],
  ['Maximum BUY(x)', 'BUY5'],
  ['Maximum SELL(x)', 'SELL5'],
  ['Final unfinished cycle', 1],
  ['MT4 total net profit', 132.8],
  ['MT4 profit factor', 1.0],
  ['MT4 maximal drawdown', 1423.6],
  ['MT4 relative drawdown', '13.94%'],
  ['', ''],
  ['Important', 'This x1 test measures sequence depth. It does not prove the x3 recovery system is profitable.'],
], [34, 82], false);

addSheet(workbook, 'BUY_SELL_X', [
  ['Trade label', 'Opened', 'TP', 'SL', 'Forced close', 'TP rate'],
  ...summary.tradeLabelDistribution.map((item) => [
    item.label,
    item.opened,
    item.tp,
    item.sl,
    item.forcedClose,
    item.opened ? item.tp / item.opened : 0,
  ]),
], [16, 12, 12, 12, 16, 14]);

addSheet(workbook, 'Cycle_Level', [
  ['Terminal level', 'Completed cycles', 'Percent of completed cycles'],
  ...summary.byLevel.map((item) => [
    item.level,
    item.wins,
    item.wins / summary.overall.cycles,
  ]),
], [18, 20, 30]);

addSheet(workbook, 'Level_Reach', [
  ['Level', 'Reached', 'Failed this level', 'Conditional failure rate'],
  ...summary.conditionalFailureByLevel.map((item) => [
    item.level,
    item.reached,
    item.failed,
    item.failureRatePct / 100,
  ]),
], [12, 14, 20, 28]);

addSheet(workbook, 'Yearly', [
  ['Year', 'Cycles', 'Wins', 'Full losses', 'Full loss rate', 'Net at fixed 0.01'],
  ...summary.yearly.map((item) => [
    Number(item.year), item.cycles, item.wins, item.fullLosses, item.fullLossRatePct / 100, item.net,
  ]),
], [10, 12, 12, 14, 18, 22]);

addSheet(workbook, 'All_Cycles', [
  ['Cycle', 'Start time', 'End time', 'Start direction', 'Levels', 'Terminal', 'Fixed-lot profit', 'Ending balance'],
  ...cycles.map((cycle) => [
    cycle.id,
    cycle.startTime,
    cycle.endTime,
    cycle.startDirection.toUpperCase(),
    cycle.levels,
    cycle.terminal,
    cycle.profit,
    cycle.endingBalance,
  ]),
], [10, 20, 20, 18, 10, 16, 18, 18]);

addSheet(workbook, 'Long_Cycles', [
  ['Cycle', 'Start time', 'End time', 'Start direction', 'Levels', 'Terminal', 'Fixed-lot profit', 'Ending balance'],
  ...cycles.filter((cycle) => cycle.levels >= 5).map((cycle) => [
    cycle.id,
    cycle.startTime,
    cycle.endTime,
    cycle.startDirection.toUpperCase(),
    cycle.levels,
    cycle.terminal,
    cycle.profit,
    cycle.endingBalance,
  ]),
], [10, 20, 20, 18, 10, 16, 18, 18]);

const tradeRows = [['Cycle', 'Trade label', 'Open time', 'Close time', 'Direction', 'Lot', 'Close type', 'Profit', 'Balance']];
for (const cycle of cycles) {
  const counts = { buy: 0, sell: 0 };
  for (const trade of cycle.trades) {
    counts[trade.direction] += 1;
    tradeRows.push([
      cycle.id,
      `${trade.direction.toUpperCase()}${counts[trade.direction]}`,
      trade.openTime,
      trade.closeTime,
      trade.direction.toUpperCase(),
      trade.size,
      trade.closeType,
      trade.profit,
      trade.balance,
    ]);
  }
}
addSheet(workbook, 'All_Trades', tradeRows, [10, 14, 20, 20, 12, 10, 14, 14, 16]);

for (const sheetName of ['BUY_SELL_X', 'Cycle_Level', 'Level_Reach', 'Yearly']) {
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let row = 1; row <= range.e.r; row += 1) {
    for (let col = 0; col <= range.e.c; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (!cell) continue;
      if ((sheetName === 'BUY_SELL_X' && col === 5) ||
          (sheetName === 'Cycle_Level' && col === 2) ||
          (sheetName === 'Level_Reach' && col === 3) ||
          (sheetName === 'Yearly' && col === 4)) {
        cell.z = '0.000%';
      }
    }
  }
}

XLSX.writeFile(workbook, outputPath, { compression: true });
console.log(outputPath);
