const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const reportPath = process.argv[2] || path.join(__dirname, 'Dual_Trend_Pyramid_Report.htm');
const html = fs.readFileSync(reportPath, 'utf8');
const outputStem = process.argv[3] || path.basename(reportPath, path.extname(reportPath));
const outputJson = path.join(__dirname, `${outputStem}_analysis.json`);
const outputXlsx = path.join(__dirname, `${outputStem}_Analysis.xlsx`);

function stripHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

function numberAfter(label) {
  const match = html.match(new RegExp(`<td>${label}<\\/td><td align=right>([-0-9.]+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function textAfter(label) {
  const match = html.match(new RegExp(`<td>${label}<\\/td><td align=right>([^<]+)`, 'i'));
  return match ? match[1].trim() : '';
}

const parametersMatch = html.match(/<td colspan=2>Parameters<\/td><td colspan=4>([\s\S]*?)<\/td>/i);
const periodMatch = html.match(/<td colspan=2>Period<\/td><td colspan=4>([\s\S]*?)<\/td>/i);
const titleMatch = html.match(/<div style="font: 16pt Times New Roman"><b>([^<]+)<\/b><\/div>/i);
const events = [];

for (const row of html.matchAll(/<tr(?:\s+[^>]*)?>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<td(?:\s+[^>]*)?>([\s\S]*?)<\/td>/gi)].map((item) => stripHtml(item[1]));
  if ((cells.length !== 9 && cells.length !== 10) || !/^\d+$/.test(cells[0])) continue;
  const type = cells[2].toLowerCase();
  if (!['buy', 'sell', 'modify', 's/l', 't/p', 'close', 'close at stop'].includes(type)) continue;
  events.push({
    row: Number(cells[0]),
    time: cells[1],
    type,
    order: Number(cells[3]),
    size: Number(cells[4]),
    price: Number(cells[5]),
    sl: Number(cells[6]),
    tp: Number(cells[7]),
    profit: cells.length === 10 && cells[8] !== '' ? Number(cells[8]) : null,
    balance: cells.length === 10 && cells[9] !== '' ? Number(cells[9]) : null,
  });
}

const activeOrders = new Map();
const baskets = [];
const currentBaskets = { buy: null, sell: null };
const activeCounts = { buy: 0, sell: 0 };
let nextBasketId = 1;

function beginBasket(event, direction) {
  return {
    id: nextBasketId++,
    startTime: event.time,
    endTime: null,
    direction,
    maxLevel: 0,
    exitType: null,
    profit: 0,
    endingBalance: null,
    trades: [],
  };
}

for (const event of events) {
  if (event.type === 'modify') continue;

  if (event.type === 'buy' || event.type === 'sell') {
    const direction = event.type;
    if (!currentBaskets[direction]) currentBaskets[direction] = beginBasket(event, direction);
    const basket = currentBaskets[direction];
    const level = basket.trades.length + 1;
    const trade = {
      basketId: basket.id,
      level,
      order: event.order,
      direction: event.type,
      size: event.size,
      openTime: event.time,
      closeTime: null,
      openPrice: event.price,
      closePrice: null,
      closeType: null,
      profit: null,
      balance: null,
    };
    basket.trades.push(trade);
    basket.maxLevel = Math.max(basket.maxLevel, level);
    activeOrders.set(event.order, trade);
    activeCounts[direction] += 1;
    continue;
  }

  const trade = activeOrders.get(event.order);
  if (!trade) continue;
  const direction = trade.direction;
  const basket = currentBaskets[direction];
  if (!basket) continue;
  trade.closeTime = event.time;
  trade.closePrice = event.price;
  trade.closeType = event.type;
  trade.profit = event.profit;
  trade.balance = event.balance;
  basket.profit += event.profit;
  basket.endingBalance = event.balance;
  activeOrders.delete(event.order);
  activeCounts[direction] -= 1;

  if (activeCounts[direction] === 0) {
    basket.endTime = event.time;
    const closeTypes = new Set(basket.trades.map((item) => item.closeType));
    if (closeTypes.has('t/p')) basket.exitType = 'final_target';
    else if (closeTypes.has('close at stop')) basket.exitType = 'test_end';
    else if (closeTypes.has('close')) basket.exitType = 'manual_or_ea_close';
    else basket.exitType = 'basket_stop';
    basket.profit = Number(basket.profit.toFixed(2));
    baskets.push(basket);
    currentBaskets[direction] = null;
  }
}

function group(items, keyFn) {
  const result = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(item);
  }
  return [...result.entries()].sort(([left], [right]) => String(left).localeCompare(String(right)));
}

function summarize(items) {
  const profit = items.reduce((sum, item) => sum + item.profit, 0);
  const wins = items.filter((item) => item.profit > 0).length;
  const losses = items.filter((item) => item.profit < 0).length;
  return {
    baskets: items.length,
    wins,
    losses,
    winRatePct: items.length ? 100 * wins / items.length : 0,
    finalTargets: items.filter((item) => item.exitType === 'final_target').length,
    basketStops: items.filter((item) => item.exitType === 'basket_stop').length,
    profit: Number(profit.toFixed(2)),
    averageProfit: items.length ? Number((profit / items.length).toFixed(4)) : 0,
  };
}

const completedBaskets = baskets.filter((item) => item.exitType !== 'test_end');
const byLevel = group(completedBaskets, (item) => item.maxLevel).map(([level, items]) => ({
  level: Number(level),
  ...summarize(items),
  reached: completedBaskets.filter((item) => item.maxLevel >= Number(level)).length,
}));
const byDirection = group(completedBaskets, (item) => item.direction).map(([direction, items]) => ({ direction, ...summarize(items) }));
const yearly = group(completedBaskets, (item) => item.startTime.slice(0, 4)).map(([year, items]) => ({ year, ...summarize(items) }));
const monthly = group(completedBaskets, (item) => item.startTime.slice(0, 7)).map(([month, items]) => ({ month, ...summarize(items) }));

const analysis = {
  report: {
    title: titleMatch ? titleMatch[1].trim() : '',
    period: periodMatch ? stripHtml(periodMatch[1]) : '',
    parameters: parametersMatch ? stripHtml(parametersMatch[1]) : '',
    initialDeposit: numberAfter('Initial deposit'),
    totalNetProfit: numberAfter('Total net profit'),
    profitFactor: numberAfter('Profit factor'),
    expectedPayoff: numberAfter('Expected payoff'),
    absoluteDrawdown: numberAfter('Absolute drawdown'),
    maximalDrawdown: textAfter('Maximal drawdown'),
    relativeDrawdown: textAfter('Relative drawdown'),
    spread: textAfter('Spread'),
    totalTrades: numberAfter('Total trades'),
  },
  parsedTrades: baskets.reduce((sum, item) => sum + item.trades.length, 0),
  unfinishedOpenOrders: activeOrders.size,
  completed: summarize(completedBaskets),
  testEndBaskets: baskets.filter((item) => item.exitType === 'test_end').length,
  byLevel,
  byDirection,
  yearly,
  monthly,
  bestBaskets: [...completedBaskets].sort((a, b) => b.profit - a.profit).slice(0, 25).map(compactBasket),
  worstBaskets: [...completedBaskets].sort((a, b) => a.profit - b.profit).slice(0, 25).map(compactBasket),
};

function compactBasket(item) {
  return {
    id: item.id,
    startTime: item.startTime,
    endTime: item.endTime,
    direction: item.direction,
    maxLevel: item.maxLevel,
    exitType: item.exitType,
    profit: item.profit,
    endingBalance: item.endingBalance,
  };
}

fs.writeFileSync(outputJson, JSON.stringify({ analysis, baskets }, null, 2));

function addSheet(workbook, name, rows, widths, autoFilter = true) {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  if (autoFilter && rows.length > 1) sheet['!autofilter'] = { ref: sheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, sheet, name);
  return sheet;
}

const workbook = XLSX.utils.book_new();
workbook.Props = {
  Title: 'Gold EMA Trend Pyramid Backtest Analysis',
  Subject: 'Basket-level MT4 report analysis',
  Author: 'Codex',
  CreatedDate: new Date(),
};

addSheet(workbook, 'Summary', [
  ['Metric', 'Value'],
  ['EA', analysis.report.title],
  ['Period', analysis.report.period],
  ['Parameters', analysis.report.parameters],
  ['Initial deposit', analysis.report.initialDeposit],
  ['MT4 net profit', analysis.report.totalNetProfit],
  ['MT4 profit factor', analysis.report.profitFactor],
  ['MT4 expected payoff / trade', analysis.report.expectedPayoff],
  ['MT4 absolute drawdown', analysis.report.absoluteDrawdown],
  ['MT4 maximal drawdown', analysis.report.maximalDrawdown],
  ['MT4 relative drawdown', analysis.report.relativeDrawdown],
  ['Tester spread', analysis.report.spread],
  ['Closed positions', analysis.report.totalTrades],
  ['Completed baskets', analysis.completed.baskets],
  ['Profitable baskets', analysis.completed.wins],
  ['Losing baskets', analysis.completed.losses],
  ['Basket win rate', analysis.completed.winRatePct / 100],
  ['Final target baskets', analysis.completed.finalTargets],
  ['Basket stop baskets', analysis.completed.basketStops],
  ['Average profit / basket', analysis.completed.averageProfit],
], [32, 115], false);

addSheet(workbook, 'Level_Distribution', [
  ['Max level', 'Reached level', 'Ended at level', 'Winning baskets', 'Losing baskets', 'Final targets', 'Basket stops', 'Net profit', 'Average / basket'],
  ...byLevel.map((item) => [item.level, item.reached, item.baskets, item.wins, item.losses, item.finalTargets, item.basketStops, item.profit, item.averageProfit]),
], [12, 16, 16, 18, 18, 16, 16, 16, 18]);

addSheet(workbook, 'Direction', [
  ['Direction', 'Baskets', 'Wins', 'Losses', 'Win rate', 'Final targets', 'Basket stops', 'Net profit', 'Average / basket'],
  ...byDirection.map((item) => [item.direction.toUpperCase(), item.baskets, item.wins, item.losses, item.winRatePct / 100, item.finalTargets, item.basketStops, item.profit, item.averageProfit]),
], [14, 14, 12, 12, 14, 16, 16, 16, 18]);

addSheet(workbook, 'Yearly', [
  ['Year', 'Baskets', 'Wins', 'Losses', 'Win rate', 'Final targets', 'Basket stops', 'Net profit', 'Average / basket'],
  ...yearly.map((item) => [Number(item.year), item.baskets, item.wins, item.losses, item.winRatePct / 100, item.finalTargets, item.basketStops, item.profit, item.averageProfit]),
], [10, 14, 12, 12, 14, 16, 16, 16, 18]);

addSheet(workbook, 'Monthly', [
  ['Month', 'Baskets', 'Wins', 'Losses', 'Win rate', 'Final targets', 'Basket stops', 'Net profit', 'Average / basket'],
  ...monthly.map((item) => [item.month, item.baskets, item.wins, item.losses, item.winRatePct / 100, item.finalTargets, item.basketStops, item.profit, item.averageProfit]),
], [12, 14, 12, 12, 14, 16, 16, 16, 18]);

const basketHeader = ['Basket', 'Start time', 'End time', 'Direction', 'Max level', 'Exit type', 'Profit', 'Ending balance'];
const basketRow = (item) => [item.id, item.startTime, item.endTime, item.direction.toUpperCase(), item.maxLevel, item.exitType, item.profit, item.endingBalance];
addSheet(workbook, 'All_Baskets', [basketHeader, ...baskets.map(basketRow)], [10, 20, 20, 14, 12, 20, 16, 18]);
addSheet(workbook, 'Best_Baskets', [basketHeader, ...analysis.bestBaskets.map(basketRow)], [10, 20, 20, 14, 12, 20, 16, 18]);
addSheet(workbook, 'Worst_Baskets', [basketHeader, ...analysis.worstBaskets.map(basketRow)], [10, 20, 20, 14, 12, 20, 16, 18]);

const tradeRows = [['Basket', 'Level', 'Order', 'Direction', 'Lot', 'Open time', 'Close time', 'Open price', 'Close price', 'Close type', 'Profit', 'Balance']];
for (const basket of baskets) {
  for (const trade of basket.trades) {
    tradeRows.push([basket.id, trade.level, trade.order, trade.direction.toUpperCase(), trade.size, trade.openTime, trade.closeTime, trade.openPrice, trade.closePrice, trade.closeType, trade.profit, trade.balance]);
  }
}
addSheet(workbook, 'All_Trades', tradeRows, [10, 10, 10, 12, 10, 20, 20, 14, 14, 16, 14, 16]);

for (const sheetName of ['Summary', 'Direction', 'Yearly', 'Monthly']) {
  const sheet = workbook.Sheets[sheetName];
  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let row = 1; row <= range.e.r; row += 1) {
    for (let col = 0; col <= range.e.c; col += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      if (!cell) continue;
      if ((sheetName === 'Summary' && row === 16 && col === 1) ||
          (sheetName !== 'Summary' && col === 4)) cell.z = '0.00%';
    }
  }
}

XLSX.writeFile(workbook, outputXlsx, { compression: true });
console.log(JSON.stringify(analysis, null, 2));
console.log(outputXlsx);
