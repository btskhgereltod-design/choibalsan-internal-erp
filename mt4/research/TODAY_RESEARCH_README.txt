GOLD EA RESEARCH ARCHIVE - 2026-08-17
=====================================

This folder contains the EA source files, compiled EX4 files, MT4 backtest
reports, Excel workbooks, parsed JSON/CSV data, and analysis scripts produced
during today's Gold EA research.

MAIN EA FILES
-------------
Gold_Dual_Trend_Pyramid_EA
  Base dual BUY/SELL price-stop pyramid.

Gold_Dual_Trend_Pyramid_AutoScale15_EA
  Lot multiplier 1.5 with optional balance scaling. Also used for fixed x1.

Gold_Dual_Trend_Pyramid_MoneyStop_EA
  Independent $20 software basket stop per BUY/SELL side.

Gold_Dual_Trend_Pyramid_MoneyStop100_EA
  Independent $100 software basket stop per BUY/SELL side.

Gold_Dual_Trend_Pyramid_DynamicMoneyStop_EA
  Level stops: $10, $30, $90, $270, $810 per side.

Gold_EMA_Trend_Pyramid_EA
  EMA-based trend pyramid variant.

Gold_H1_Breakout_Trend_Pyramid_EA
  H1 open breakout variant.

Gold_EMA_Recovery_EA
  Earlier EMA recovery-cycle research EA.

KEY FIXED-MULTIPLIER RESULTS
----------------------------
Fixed x1: net +$4,618.00, PF 1.03, relative DD 10.22%.
Fixed x2: net +$17,378.64, PF 1.07, relative DD 18.92%.
Fixed x3: net +$44,142.76, PF 1.09, relative DD 38.11%.

MONTHLY WITHDRAWAL SIMULATION
-----------------------------
Rule: retain $10,000 at each completed month-end and withdraw realized balance
above it. This is balance-only post-processing and does not include floating
equity at the calendar month-end.

Fixed x1: withdrawn $4,900.32, ending virtual balance $9,717.68.
AutoScale x1.5: withdrawn $13,272.70, ending virtual balance $7,260.53.
Fixed x2: withdrawn $21,407.89, ending virtual balance $5,970.75.

IMPORTANT LIMITS
----------------
The tests used MT4 90% modelling and Current spread. Profit factors are close
to 1. The results are research evidence only and are not sufficient for live
deployment. AutoScale x1.5 withdrawal results are post-processed from a test
that scaled using the unwithdrawn MT4 balance, so that column is not a clean
counterfactual withdrawal test.

FILES TO OPEN FIRST
-------------------
Dual_Trend_Pyramid_Fixed1_vs_2_vs_3_Comparison.xlsx
Dual_Fixed1_AutoScale15_Fixed2_Fixed3_Comparison.xlsx
Dual_Monthly_Withdrawal_x1_vs_Auto15_vs_x2_Comparison.xlsx
Dual_Trend_Pyramid_Fixed1_Monthly_Withdrawal_Simulation.xlsx
