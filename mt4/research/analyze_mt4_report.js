const fs = require('fs');
const path = require('path');

const reportPath = process.argv[2] || path.join(__dirname, 'Gold_EMA_Recovery_Report.htm');
const html = fs.readFileSync(reportPath, 'utf8');
const maxTradesMatch = html.match(/MaxTradesPerCycle=(\d+)/);
const configuredMaxTrades = maxTradesMatch ? Number(maxTradesMatch[1]) : 5;

function textOf(cell) {
  return cell
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

const events = [];
for (const row of html.matchAll(/<tr(?:\s+[^>]*)?>([\s\S]*?)<\/tr>/gi)) {
  const cells = [...row[1].matchAll(/<td(?:\s+[^>]*)?>([\s\S]*?)<\/td>/gi)].map((m) => textOf(m[1]));
  if ((cells.length !== 9 && cells.length !== 10) || !/^\d+$/.test(cells[0])) continue;
  const type = cells[2].toLowerCase();
  if (!['buy', 'sell', 't/p', 's/l', 'close', 'close at stop'].includes(type)) continue;
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

const opens = new Map();
const trades = [];
for (const event of events) {
  if (event.type === 'buy' || event.type === 'sell') {
    opens.set(event.order, event);
    continue;
  }
  const open = opens.get(event.order);
  if (!open) continue;
  trades.push({
    order: event.order,
    openTime: open.time,
    closeTime: event.time,
    direction: open.type,
    size: open.size,
    openPrice: open.price,
    closePrice: event.price,
    closeType: event.type,
    profit: event.profit,
    balance: event.balance,
  });
  opens.delete(event.order);
}

const cycles = [];
let current = [];
for (const trade of trades) {
  current.push(trade);
  if (trade.profit > 0 || current.length === configuredMaxTrades || trade.closeType === 'close' || trade.closeType === 'close at stop') {
    cycles.push({
      id: cycles.length + 1,
      startTime: current[0].openTime,
      endTime: trade.closeTime,
      startDirection: current[0].direction,
      levels: current.length,
      terminal: trade.profit > 0 ? 'win' : trade.closeType === 'close at stop' ? 'forced_close' : current.length === configuredMaxTrades ? 'full_loss' : 'forced_close',
      profit: Number(current.reduce((sum, item) => sum + item.profit, 0).toFixed(2)),
      endingBalance: trade.balance,
      trades: current,
    });
    current = [];
  }
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return [...map.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function summarize(items) {
  const completed = items.filter((c) => c.terminal !== 'forced_close' && c.terminal !== 'stop_out');
  const fullLosses = completed.filter((c) => c.terminal === 'full_loss');
  const net = completed.reduce((sum, c) => sum + c.profit, 0);
  return {
    cycles: completed.length,
    wins: completed.length - fullLosses.length,
    fullLosses: fullLosses.length,
    fullLossRatePct: completed.length ? (100 * fullLosses.length / completed.length) : 0,
    net: Number(net.toFixed(2)),
  };
}

function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return [0, 0];
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator;
  return [100 * (center - margin), 100 * (center + margin)];
}

function binomialUpperTail(k, n, p) {
  let probability = Math.pow(1 - p, n);
  let lowerTail = probability;
  for (let i = 1; i < k; i += 1) {
    probability *= ((n - i + 1) / i) * (p / (1 - p));
    lowerTail += probability;
  }
  return 1 - lowerTail;
}

const maximumObservedLevel = Math.max(...cycles.map((c) => c.levels));
const byLevel = Array.from({ length: maximumObservedLevel }, (_, index) => index + 1).map((level) => ({
  level,
  count: cycles.filter((c) => c.levels === level).length,
  wins: cycles.filter((c) => c.levels === level && c.terminal === 'win').length,
  fullLosses: cycles.filter((c) => c.levels === level && c.terminal === 'full_loss').length,
  net: Number(cycles.filter((c) => c.levels === level).reduce((sum, c) => sum + c.profit, 0).toFixed(2)),
}));

const yearly = groupBy(cycles, (c) => c.startTime.slice(0, 4)).map(([year, items]) => ({ year, ...summarize(items) }));
const monthly = groupBy(cycles, (c) => c.startTime.slice(0, 7)).map(([month, items]) => ({ month, ...summarize(items) }));
const direction = groupBy(cycles, (c) => c.startDirection).map(([startDirection, items]) => ({ startDirection, ...summarize(items) }));
const tradeLabelStats = new Map();
for (const cycle of cycles) {
  const directionCounts = { buy: 0, sell: 0 };
  for (const trade of cycle.trades) {
    directionCounts[trade.direction] += 1;
    const label = `${trade.direction.toUpperCase()}${directionCounts[trade.direction]}`;
    const stat = tradeLabelStats.get(label) || { label, opened: 0, tp: 0, sl: 0, forcedClose: 0 };
    stat.opened += 1;
    if (trade.closeType === 't/p') stat.tp += 1;
    else if (trade.closeType === 's/l') stat.sl += 1;
    else stat.forcedClose += 1;
    tradeLabelStats.set(label, stat);
  }
}
const tradeLabelDistribution = [...tradeLabelStats.values()].sort((a, b) => {
  const numberDifference = Number(a.label.slice(3)) - Number(b.label.slice(3));
  return numberDifference || a.label.localeCompare(b.label);
});
const completedCycles = cycles.filter((c) => c.terminal !== 'forced_close' && c.terminal !== 'stop_out');
const completedFullLosses = completedCycles.filter((c) => c.terminal === 'full_loss').length;
const practicalFailures = cycles.filter((c) => c.terminal === 'full_loss' || c.terminal === 'stop_out').length;
const conditionalFailureByLevel = Array.from({ length: maximumObservedLevel }, (_, index) => index + 1).map((level) => {
  const reached = cycles.filter((c) => c.levels >= level).length;
  const failed = cycles.filter((c) => c.levels > level || ((c.terminal === 'full_loss' || c.terminal === 'stop_out') && c.levels === level)).length;
  return { level, reached, failed, failureRatePct: reached ? 100 * failed / reached : 0 };
});

let peak = 20000;
let maxBalanceDrawdown = 0;
let maxBalanceDrawdownPct = 0;
for (const trade of trades) {
  peak = Math.max(peak, trade.balance);
  const drawdown = peak - trade.balance;
  maxBalanceDrawdown = Math.max(maxBalanceDrawdown, drawdown);
  maxBalanceDrawdownPct = Math.max(maxBalanceDrawdownPct, 100 * drawdown / peak);
}

const summary = {
  reportPath,
  configuredMaxTrades,
  maximumObservedLevel,
  tradeCount: trades.length,
  unmatchedOpenOrders: opens.size,
  unfinishedCycleTrades: current.length,
  overall: summarize(cycles),
  stopOutCycles: cycles.filter((c) => c.terminal === 'stop_out').length,
  practicalTerminalFailures: practicalFailures,
  practicalTerminalFailureRatePct: 100 * practicalFailures / cycles.length,
  completedFullLossWilson95Pct: wilson(completedFullLosses, completedCycles.length),
  practicalFailureWilson95Pct: wilson(practicalFailures, cycles.length),
  binomialPValueObservedOrWorseVsGrossBreakEven: binomialUpperTail(completedFullLosses, completedCycles.length, 1 / 243),
  grossBreakEvenFullLossRatePct: 100 / 243,
  conditionalFailureByLevel,
  tradeLabelDistribution,
  byLevel,
  direction,
  yearly,
  worstFullLossCycles: cycles
    .filter((c) => c.terminal === 'full_loss' || c.terminal === 'stop_out')
    .sort((a, b) => a.profit - b.profit)
    .map((c) => ({ id: c.id, startTime: c.startTime, endTime: c.endTime, startDirection: c.startDirection, profit: c.profit, endingBalance: c.endingBalance })),
  maxBalanceDrawdown: Number(maxBalanceDrawdown.toFixed(2)),
  maxBalanceDrawdownPct: Number(maxBalanceDrawdownPct.toFixed(4)),
  finalBalance: trades.length ? trades[trades.length - 1].balance : null,
};

fs.writeFileSync(path.join(__dirname, 'mt4-report-analysis.json'), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(__dirname, 'mt4-report-cycles.json'), JSON.stringify(cycles, null, 2));
fs.writeFileSync(
  path.join(__dirname, 'mt4-report-cycles.csv'),
  ['id,startTime,endTime,startDirection,levels,terminal,profit,endingBalance']
    .concat(cycles.map((c) => [c.id, c.startTime, c.endTime, c.startDirection, c.levels, c.terminal, c.profit, c.endingBalance].join(',')))
    .join('\n')
);

console.log(JSON.stringify(summary, null, 2));
