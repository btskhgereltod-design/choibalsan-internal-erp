'use strict';

const fs = require('fs');
const path = require('path');

const HEADER_SIZE = 148;
const RECORD_SIZE = 60;
const CONTRACT_SIZE = 100;
const TP = 10.0;
const STEP = 20.0;
const MULTIPLIER = 3.0;
const MAX_LEVEL = 5;
const LOT_STEP = 0.01;
const REFERENCE_BALANCE = 10000;
const REFERENCE_LOT = 0.01;
const FIXED_SPREAD = 0.24;
const PATH_MODEL = process.env.PATH_MODEL || 'common';
const START_TIME = process.env.START_TIME ? Math.floor(Date.parse(process.env.START_TIME) / 1000) : -Infinity;
const END_TIME = process.env.END_TIME ? Math.floor(Date.parse(process.env.END_TIME) / 1000) : Infinity;

const terminalRoot = process.argv[2];
const outputDir = process.argv[3] || path.join(__dirname, 'output');
if (!terminalRoot) {
  throw new Error('Usage: node analyze_gold_recovery.js <terminal-data-root> [output-dir]');
}

const historyDir = path.join(terminalRoot, 'history', 'MGLForexFinancial-Demo');
const h1Path = path.join(historyDir, 'XAUUSD60.hst');
const m1Path = path.join(historyDir, 'XAUUSD1.hst');
fs.mkdirSync(outputDir, { recursive: true });

function readRecords(filePath) {
  const buffer = fs.readFileSync(filePath);
  const records = [];
  for (let offset = HEADER_SIZE; offset + RECORD_SIZE <= buffer.length; offset += RECORD_SIZE) {
    records.push({
      time: Number(buffer.readBigInt64LE(offset)),
      open: buffer.readDoubleLE(offset + 8),
      high: buffer.readDoubleLE(offset + 16),
      low: buffer.readDoubleLE(offset + 24),
      close: buffer.readDoubleLE(offset + 32),
      spreadPoints: buffer.readInt32LE(offset + 48),
    });
  }
  return records;
}

function calculateEmaSignals(h1Bars) {
  const alphaFast = 2 / 11;
  const alphaSlow = 2 / 21;
  let fast = null;
  let slow = null;
  return h1Bars.map((bar) => {
    fast = fast === null ? bar.close : alphaFast * bar.close + (1 - alphaFast) * fast;
    slow = slow === null ? bar.close : alphaSlow * bar.close + (1 - alphaSlow) * slow;
    return fast > slow ? 1 : fast < slow ? -1 : 0;
  });
}

function roundLot(value, mode) {
  const scaled = value / LOT_STEP;
  const units = mode === 'ceil'
    ? Math.ceil(scaled - 1e-7)
    : mode === 'floor'
      ? Math.floor(scaled + 1e-7)
      : Math.round(scaled);
  return Math.max(LOT_STEP, Number((units * LOT_STEP).toFixed(2)));
}

function makeScenario(name, startBalance, lotMode, autoScale, signalMode = 'ema') {
  return {
    name,
    startBalance,
    balance: startBalance,
    peakBalance: startBalance,
    maxBalanceDrawdown: 0,
    lotMode,
    autoScale,
    signalMode,
    active: null,
    cycle: null,
    cycles: [],
    trades: 0,
    wins: 0,
    losses: 0,
    grossProfit: 0,
    grossLoss: 0,
  };
}

function baseLotForCycle(scenario) {
  if (!scenario.autoScale) return REFERENCE_LOT;
  return roundLot(REFERENCE_LOT * scenario.balance / REFERENCE_BALANCE, scenario.lotMode);
}

function openOrder(scenario, direction, level, bid, time, signal) {
  if (!scenario.cycle) {
    scenario.cycle = {
      startTime: time,
      startDirection: signal,
      baseLot: baseLotForCycle(scenario),
      pnl: 0,
      trades: 0,
    };
  }
  const lot = roundLot(scenario.cycle.baseLot * Math.pow(MULTIPLIER, level - 1), 'ceil');
  const entry = direction > 0 ? bid + FIXED_SPREAD : bid;
  scenario.active = { direction, level, lot, entry, openTime: time };
  scenario.cycle.trades += 1;
}

function closeOrder(scenario, bid, time, isProfit) {
  const order = scenario.active;
  const closePrice = order.direction > 0 ? bid : bid + FIXED_SPREAD;
  const pnl = order.direction > 0
    ? (closePrice - order.entry) * CONTRACT_SIZE * order.lot
    : (order.entry - closePrice) * CONTRACT_SIZE * order.lot;

  scenario.balance += pnl;
  scenario.peakBalance = Math.max(scenario.peakBalance, scenario.balance);
  scenario.maxBalanceDrawdown = Math.max(
    scenario.maxBalanceDrawdown,
    scenario.peakBalance - scenario.balance,
  );
  scenario.trades += 1;
  scenario.cycle.pnl += pnl;
  if (pnl >= 0) {
    scenario.wins += 1;
    scenario.grossProfit += pnl;
  } else {
    scenario.losses += 1;
    scenario.grossLoss += pnl;
  }

  const closedLevel = order.level;
  const closedDirection = order.direction;
  scenario.active = null;

  if (isProfit) {
    finishCycle(scenario, time, closedLevel, true);
  } else if (closedLevel >= MAX_LEVEL) {
    finishCycle(scenario, time, closedLevel, false);
  } else {
    openOrder(scenario, -closedDirection, closedLevel + 1, bid, time, 0);
  }
}

function finishCycle(scenario, time, terminalLevel, won) {
  const cycle = scenario.cycle;
  scenario.cycles.push({
    startTime: cycle.startTime,
    endTime: time,
    startDirection: cycle.startDirection,
    baseLot: cycle.baseLot,
    terminalLevel,
    won,
    pnl: cycle.pnl,
    trades: cycle.trades,
    endBalance: scenario.balance,
  });
  scenario.cycle = null;
  scenario.active = null;
}

function nextBarrierBid(order) {
  if (order.direction > 0) {
    return {
      profit: order.entry + TP,
      loss: order.entry - STEP,
    };
  }
  return {
    profit: order.entry - TP - FIXED_SPREAD,
    loss: order.entry + STEP - FIXED_SPREAD,
  };
}

function processSegment(scenario, fromBid, toBid, time, signal) {
  let cursor = fromBid;
  let guard = 0;
  while (guard++ < 1000) {
    if (!scenario.active) {
      let startSignal = signal;
      if (scenario.signalMode === 'inverse') startSignal = -signal;
      if (scenario.signalMode === 'buy') startSignal = 1;
      if (scenario.signalMode === 'sell') startSignal = -1;
      if (startSignal === 0) return;
      openOrder(scenario, startSignal, 1, cursor, time, startSignal);
    }

    const barrier = nextBarrierBid(scenario.active);
    let hit = null;
    if (toBid >= cursor) {
      const candidates = [];
      if (barrier.profit >= cursor && barrier.profit <= toBid) candidates.push({ price: barrier.profit, profit: true });
      if (barrier.loss >= cursor && barrier.loss <= toBid) candidates.push({ price: barrier.loss, profit: false });
      candidates.sort((a, b) => a.price - b.price);
      hit = candidates[0] || null;
    } else {
      const candidates = [];
      if (barrier.profit <= cursor && barrier.profit >= toBid) candidates.push({ price: barrier.profit, profit: true });
      if (barrier.loss <= cursor && barrier.loss >= toBid) candidates.push({ price: barrier.loss, profit: false });
      candidates.sort((a, b) => b.price - a.price);
      hit = candidates[0] || null;
    }

    if (!hit) return;
    cursor = hit.price;
    closeOrder(scenario, cursor, time, hit.profit);
  }
  throw new Error(`Segment processing guard exceeded at ${time}`);
}

function csvEscape(value) {
  return String(value).includes(',') ? `"${String(value).replaceAll('"', '""')}"` : String(value);
}

function summarize(scenario) {
  const cycles = scenario.cycles;
  const cycleWins = cycles.filter((cycle) => cycle.won).length;
  const terminalCounts = {};
  const yearStats = {};
  for (const cycle of cycles) {
    const key = `${cycle.won ? 'WIN' : 'LOSS'}_L${cycle.terminalLevel}`;
    terminalCounts[key] = (terminalCounts[key] || 0) + 1;
    const year = new Date(cycle.endTime * 1000).getUTCFullYear();
    yearStats[year] ||= { cycles: 0, wins: 0, losses: 0, pnl: 0 };
    yearStats[year].cycles++;
    yearStats[year].wins += cycle.won ? 1 : 0;
    yearStats[year].losses += cycle.won ? 0 : 1;
    yearStats[year].pnl += cycle.pnl;
  }
  return {
    scenario: scenario.name,
    startBalance: scenario.startBalance,
    endBalance: scenario.balance,
    netProfit: scenario.balance - scenario.startBalance,
    grossProfit: scenario.grossProfit,
    grossLoss: scenario.grossLoss,
    profitFactor: scenario.grossLoss === 0 ? null : scenario.grossProfit / -scenario.grossLoss,
    trades: scenario.trades,
    tradeWinRate: scenario.trades ? scenario.wins / scenario.trades : null,
    cycles: cycles.length,
    cycleWins,
    cycleLosses: cycles.length - cycleWins,
    cycleWinRate: cycles.length ? cycleWins / cycles.length : null,
    maxBalanceDrawdown: scenario.maxBalanceDrawdown,
    terminalCounts,
    yearStats,
  };
}

const h1Bars = readRecords(h1Path);
const h1Signals = calculateEmaSignals(h1Bars);
const scenarios = [
  makeScenario('current_ceil_auto_20k', 20000, 'ceil', true),
  makeScenario('floor_auto_20k', 20000, 'floor', true),
  makeScenario('fixed_001_10k', 10000, 'floor', false),
  makeScenario('fixed_001_inverse_ema', 10000, 'floor', false, 'inverse'),
  makeScenario('fixed_001_always_buy', 10000, 'floor', false, 'buy'),
  makeScenario('fixed_001_always_sell', 10000, 'floor', false, 'sell'),
];

let h1Index = 0;
let carry = Buffer.alloc(0);
let bytesRead = 0;
let lastM1Time = null;
let lastM1Close = null;
const m1Segments = [];
const stream = fs.createReadStream(m1Path, { start: HEADER_SIZE, highWaterMark: 4 * 1024 * 1024 });

stream.on('data', (chunk) => {
  const buffer = carry.length ? Buffer.concat([carry, chunk]) : chunk;
  let offset = 0;
  while (offset + RECORD_SIZE <= buffer.length) {
    const time = Number(buffer.readBigInt64LE(offset));
    const open = buffer.readDoubleLE(offset + 8);
    const high = buffer.readDoubleLE(offset + 16);
    const low = buffer.readDoubleLE(offset + 24);
    const close = buffer.readDoubleLE(offset + 32);
    offset += RECORD_SIZE;
    bytesRead += RECORD_SIZE;

    if (lastM1Time === null || time - lastM1Time > 7 * 24 * 60 * 60) {
      m1Segments.push({ start: time, end: time, bars: 0 });
    }
    m1Segments.at(-1).end = time;
    m1Segments.at(-1).bars++;
    lastM1Time = time;

    while (h1Index + 1 < h1Bars.length && h1Bars[h1Index + 1].time <= time) h1Index++;
    if (time < START_TIME || time >= END_TIME) {
      lastM1Close = null;
      continue;
    }
    const signalIndex = h1Index - 1;
    const signal = signalIndex >= 20 ? h1Signals[signalIndex] : 0;
    if (signal === 0) continue;

    // This is MT4's common deterministic M1 path approximation. Running a
    // second opposite-path pass is planned for ambiguity sensitivity.
    const commonPath = close >= open ? [open, low, high, close] : [open, high, low, close];
    const reversePath = close >= open ? [open, high, low, close] : [open, low, high, close];
    const points = PATH_MODEL === 'reverse' ? reversePath : commonPath;
    for (const scenario of scenarios) {
      if (lastM1Close !== null) {
        processSegment(scenario, lastM1Close, open, time, signal);
      }
      for (let i = 1; i < points.length; i++) {
        processSegment(scenario, points[i - 1], points[i], time, signal);
      }
    }
    lastM1Close = close;
  }
  carry = buffer.subarray(offset);
});

stream.on('end', () => {
  const summaries = scenarios.map(summarize);
  fs.writeFileSync(path.join(outputDir, 'summary.json'), JSON.stringify({
    assumptions: {
      tpPriceDistance: TP,
      stepPriceDistance: STEP,
      multiplier: MULTIPLIER,
      maxLevel: MAX_LEVEL,
      fixedSpread: FIXED_SPREAD,
      contractSize: CONTRACT_SIZE,
      pathModel: PATH_MODEL === 'reverse'
        ? 'bullish O-H-L-C, bearish O-L-H-C'
        : 'bullish O-L-H-C, bearish O-H-L-C',
      bytesRead,
    },
    history: {
      h1Start: new Date(h1Bars[0].time * 1000).toISOString(),
      h1End: new Date(h1Bars.at(-1).time * 1000).toISOString(),
      h1Bars: h1Bars.length,
      m1Segments: m1Segments.map((segment) => ({
        start: new Date(segment.start * 1000).toISOString(),
        end: new Date(segment.end * 1000).toISOString(),
        bars: segment.bars,
      })),
    },
    summaries,
  }, null, 2));

  for (const scenario of scenarios) {
    const header = ['start_time','end_time','start_direction','base_lot','terminal_level','won','pnl','trades','end_balance'];
    const rows = scenario.cycles.map((cycle) => [
      new Date(cycle.startTime * 1000).toISOString(),
      new Date(cycle.endTime * 1000).toISOString(),
      cycle.startDirection > 0 ? 'BUY' : 'SELL',
      cycle.baseLot.toFixed(2),
      cycle.terminalLevel,
      cycle.won ? 1 : 0,
      cycle.pnl.toFixed(2),
      cycle.trades,
      cycle.endBalance.toFixed(2),
    ].map(csvEscape).join(','));
    fs.writeFileSync(path.join(outputDir, `${scenario.name}_cycles.csv`), [header.join(','), ...rows].join('\n'));
  }

  process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
});

stream.on('error', (error) => {
  throw error;
});
