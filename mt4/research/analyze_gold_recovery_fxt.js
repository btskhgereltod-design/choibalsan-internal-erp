'use strict';

const fs = require('fs');
const path = require('path');

const HST_HEADER = 148;
const HST_RECORD = 60;
const FXT_HEADER = 728;
const FXT_RECORD = 56;
const TP = 10;
const STEP = 20;
const MULTIPLIER = 3;
const MAX_LEVEL = 5;
const SPREAD = 0.24;
const CONTRACT = 100;

const terminalRoot = process.argv[2];
const outputPath = process.argv[3] || path.join(__dirname, 'fxt-summary.json');
if (!terminalRoot) throw new Error('Terminal data root is required');

const h1Path = path.join(terminalRoot, 'history', 'MGLForexFinancial-Demo', 'XAUUSD60.hst');
const fxtPath = path.join(terminalRoot, 'tester', 'history', 'XAUUSD60_0.fxt');

function buildSignals() {
  const data = fs.readFileSync(h1Path);
  const bars = [];
  let fast = null;
  let slow = null;
  for (let offset = HST_HEADER; offset + HST_RECORD <= data.length; offset += HST_RECORD) {
    const time = Number(data.readBigInt64LE(offset));
    const close = data.readDoubleLE(offset + 32);
    fast = fast === null ? close : (2 / 11) * close + (9 / 11) * fast;
    slow = slow === null ? close : (2 / 21) * close + (19 / 21) * slow;
    bars.push({ time, signal: fast > slow ? 1 : fast < slow ? -1 : 0 });
  }
  const signals = new Map();
  for (let i = 21; i < bars.length; i++) signals.set(bars[i].time, bars[i - 1].signal);
  return signals;
}

function makeScenario(name, startBalance, autoScale) {
  return {
    name,
    startBalance,
    balance: startBalance,
    peak: startBalance,
    maxDrawdown: 0,
    autoScale,
    active: null,
    cycle: null,
    trades: 0,
    wins: 0,
    losses: 0,
    grossProfit: 0,
    grossLoss: 0,
    cycles: 0,
    cycleWins: 0,
    cycleLosses: 0,
    terminalCounts: {},
    yearly: {},
  };
}

function normalizeLot(value, mode = 'ceil') {
  const units = mode === 'ceil'
    ? Math.ceil(value / 0.01 - 1e-7)
    : Math.floor(value / 0.01 + 1e-7);
  return Math.max(0.01, units * 0.01);
}

function openOrder(s, direction, level, bid, time) {
  if (!s.cycle) {
    const raw = s.autoScale ? 0.01 * s.balance / 10000 : 0.01;
    s.cycle = { baseLot: normalizeLot(raw, s.autoScale ? 'ceil' : 'floor'), pnl: 0, startTime: time };
  }
  const lot = normalizeLot(s.cycle.baseLot * Math.pow(MULTIPLIER, level - 1));
  s.active = {
    direction,
    level,
    lot,
    entry: direction > 0 ? bid + SPREAD : bid,
  };
}

function closeActive(s, won, time) {
  const order = s.active;
  const pnl = (won ? TP : -STEP) * CONTRACT * order.lot;
  s.balance += pnl;
  s.peak = Math.max(s.peak, s.balance);
  s.maxDrawdown = Math.max(s.maxDrawdown, s.peak - s.balance);
  s.trades++;
  s.cycle.pnl += pnl;
  if (won) {
    s.wins++;
    s.grossProfit += pnl;
  } else {
    s.losses++;
    s.grossLoss += pnl;
  }

  const level = order.level;
  const direction = order.direction;
  s.active = null;
  if (!won && level < MAX_LEVEL) return { recoveryDirection: -direction, recoveryLevel: level + 1 };

  s.cycles++;
  s.cycleWins += won ? 1 : 0;
  s.cycleLosses += won ? 0 : 1;
  const key = `${won ? 'WIN' : 'LOSS'}_L${level}`;
  s.terminalCounts[key] = (s.terminalCounts[key] || 0) + 1;
  const year = new Date(time * 1000).getUTCFullYear();
  s.yearly[year] ||= { cycles: 0, wins: 0, losses: 0, pnl: 0 };
  s.yearly[year].cycles++;
  s.yearly[year].wins += won ? 1 : 0;
  s.yearly[year].losses += won ? 0 : 1;
  s.yearly[year].pnl += s.cycle.pnl;
  s.cycle = null;
  return null;
}

function onTick(s, bid, time, signal) {
  let next = null;
  if (s.active) {
    const o = s.active;
    let won = false;
    let lost = false;
    if (o.direction > 0) {
      won = bid >= o.entry + TP;
      lost = bid <= o.entry - STEP;
    } else {
      won = bid + SPREAD <= o.entry - TP;
      lost = bid + SPREAD >= o.entry + STEP;
    }
    if (!won && !lost) return;
    next = closeActive(s, won, time);
  }

  if (next) openOrder(s, next.recoveryDirection, next.recoveryLevel, bid, time);
  else if (!s.active && signal !== 0) openOrder(s, signal, 1, bid, time);
}

const signals = buildSignals();
const scenarios = [
  makeScenario('current_ceil_auto_20k', 20000, true),
  makeScenario('fixed_001_10k', 10000, false),
];

const fd = fs.openSync(fxtPath, 'r');
const fileSize = fs.fstatSync(fd).size;
const chunk = Buffer.allocUnsafe(FXT_RECORD * 250000);
let filePosition = FXT_HEADER;
let recordCount = 0;
let currentBarTime = null;
let currentSignal = 0;
let firstTickTime = null;
let lastTickTime = null;

while (filePosition < fileSize) {
  const bytesToRead = Math.min(chunk.length, fileSize - filePosition);
  const bytesRead = fs.readSync(fd, chunk, 0, bytesToRead, filePosition);
  if (bytesRead <= 0) break;
  const usable = bytesRead - (bytesRead % FXT_RECORD);
  for (let offset = 0; offset < usable; offset += FXT_RECORD) {
    const barTime = Number(chunk.readBigInt64LE(offset));
    const bid = chunk.readDoubleLE(offset + 32);
    const tickTime = chunk.readUInt32LE(offset + 48);
    if (barTime !== currentBarTime) {
      currentBarTime = barTime;
      currentSignal = signals.get(barTime) || 0;
    }
    if (firstTickTime === null) firstTickTime = tickTime;
    lastTickTime = tickTime;
    for (const scenario of scenarios) onTick(scenario, bid, tickTime, currentSignal);
    recordCount++;
  }
  filePosition += usable;
}
fs.closeSync(fd);

const result = {
  assumptions: { TP, STEP, MULTIPLIER, MAX_LEVEL, SPREAD, CONTRACT },
  fxt: {
    fileSize,
    recordCount,
    firstTickTime: new Date(firstTickTime * 1000).toISOString(),
    lastTickTime: new Date(lastTickTime * 1000).toISOString(),
  },
  scenarios: scenarios.map((s) => ({
    scenario: s.name,
    startBalance: s.startBalance,
    endBalance: s.balance,
    netProfit: s.balance - s.startBalance,
    grossProfit: s.grossProfit,
    grossLoss: s.grossLoss,
    profitFactor: s.grossProfit / -s.grossLoss,
    trades: s.trades,
    wins: s.wins,
    losses: s.losses,
    tradeWinRate: s.wins / s.trades,
    cycles: s.cycles,
    cycleWins: s.cycleWins,
    cycleLosses: s.cycleLosses,
    cycleLossRate: s.cycleLosses / s.cycles,
    maxBalanceDrawdown: s.maxDrawdown,
    terminalCounts: s.terminalCounts,
    yearly: s.yearly,
  })),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
