//+------------------------------------------------------------------+
//|                                         Gold_EMA_Recovery_EA.mq4 |
//|  EMA start direction with alternating 3x Gold recovery orders   |
//+------------------------------------------------------------------+
#property strict

enum RecoveryPhase
{
   PHASE_READY = 0,
   PHASE_ORDER_ACTIVE = 1,
   PHASE_RECOVERY_PENDING = 2,
   PHASE_HALTED = 3
};

input string SignalSettings = "--- EMA start signal ---";
input ENUM_TIMEFRAMES SignalTimeframe = PERIOD_CURRENT;
input int FastEmaPeriod = 10;
input int SlowEmaPeriod = 20;
input int SignalShift = 1;
input ENUM_APPLIED_PRICE AppliedPrice = PRICE_CLOSE;

input string RecoverySettings = "--- Recovery cycle ---";
input double StartLot = 0.01;
input bool AutoScaleStartLotByBalance = true;
input double ReferenceBalance = 10000.0;
input double TakeProfitPriceDistance = 10.0;
input double StepPriceDistance = 20.0;
input double LotMultiplier = 3.0;
input int MaxTradesPerCycle = 5;

input string ExecutionSettings = "--- Execution ---";
input double MaxSpreadPrice = 0.0;       // 0 = disabled
input int SlippagePoints = 50;
input int MagicNumber = 20260818;
input bool AllowNewOrders = true;
input bool ShowChartStatus = true;
input bool ResetSavedStateOnInit = false;

int      g_phase = PHASE_READY;
int      g_ticket = -1;
int      g_level = 0;
int      g_direction = 0;
double   g_entryPrice = 0.0;
double   g_cycleStartLot = 0.0;
datetime g_nextRetryTime = 0;
string   g_statePrefix;

//+------------------------------------------------------------------+
int OnInit()
{
   if(FastEmaPeriod < 1 || SlowEmaPeriod < 1 || SignalShift < 0 ||
      StartLot <= 0.0 || ReferenceBalance <= 0.0 || TakeProfitPriceDistance <= 0.0 ||
      StepPriceDistance <= 0.0 || LotMultiplier < 1.0 ||
      MaxTradesPerCycle < 1 || MaxSpreadPrice < 0.0)
   {
      Print("Invalid EA input value.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(!IsGoldSymbol())
   {
      Print("This EA works only on Gold (XAU/GOLD) symbols. Current symbol: ", Symbol());
      return(INIT_FAILED);
   }

   g_statePrefix = "GOLD_EMA_REC_" + IntegerToString(AccountNumber()) + "_" +
                   Symbol() + "_" + IntegerToString(MagicNumber) + "_";

   if(IsTesting())
      ResetState(false);
   else
      RestoreState();

   int openTicket = FindOpenMarketTicket();
   if(openTicket > 0)
      AdoptOpenOrder(openTicket);
   else if(ResetSavedStateOnInit || g_phase == PHASE_HALTED)
      ResetState(true);

   Print("Gold EMA Recovery EA loaded on ", Symbol());
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   SaveState();
   if(ShowChartStatus)
      Comment("");
   Print("Gold EMA Recovery EA stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(HasUnexpectedExtraOrders())
   {
      ShowStatus(GetSignalDirection(), "ERROR: more than one EA market order");
      return;
   }

   if(g_phase == PHASE_HALTED)
   {
      ShowStatus(GetSignalDirection(), "HALTED: broker lot limit or order-state error");
      return;
   }

   if(g_phase == PHASE_ORDER_ACTIVE)
   {
      // With SELECT_BY_TICKET MT4 ignores the pool argument, so CloseTime is
      // required to distinguish an open trade from an order in history.
      if(OrderSelect(g_ticket, SELECT_BY_TICKET) && OrderCloseTime() == 0)
      {
         ShowStatus(GetSignalDirection(), "order active");
         return;
      }

      ProcessClosedOrder();
   }

   if(!AllowNewOrders || TimeCurrent() < g_nextRetryTime || !SpreadAllowed())
   {
      ShowStatus(GetSignalDirection(), "waiting to open");
      return;
   }

   if(g_phase == PHASE_RECOVERY_PENDING)
   {
      OpenCycleOrder(g_direction, g_level);
      ShowStatus(GetSignalDirection(), "recovery entry");
      return;
   }

   if(g_phase == PHASE_READY)
   {
      int signal = GetSignalDirection();
      if(signal != 0)
         OpenCycleOrder(signal, 1);
      ShowStatus(signal, "new cycle");
   }
}

//+------------------------------------------------------------------+
void ProcessClosedOrder()
{
   if(!OrderSelect(g_ticket, SELECT_BY_TICKET) || OrderCloseTime() == 0)
   {
      Print("Cannot find closed order ticket ", g_ticket,
            ". State kept for retry. Error=", GetLastError());
      return;
   }

   double result = OrderProfit() + OrderSwap() + OrderCommission();
   Print("Level ", g_level, " closed. Ticket=", g_ticket,
         " net result=", DoubleToString(result, 2));

   if(result >= 0.0)
   {
      // Profitable close completes the cycle. Start again from 0.01 lot
      // using the current closed-candle EMA direction.
      ResetState(true);
      return;
   }

   if(g_level >= MaxTradesPerCycle)
   {
      Print("Maximum recovery level lost. Cycle reset; no larger lot will be opened.");
      ResetState(true);
      return;
   }

   g_level++;
   g_direction = -g_direction;
   g_ticket = -1;
   g_entryPrice = 0.0;
   g_phase = PHASE_RECOVERY_PENDING;
   SaveState();
}

//+------------------------------------------------------------------+
int OpenCycleOrder(const int direction, const int level)
{
   RefreshRates();
   int type = (direction > 0 ? OP_BUY : OP_SELL);
   double price = (direction > 0 ? Ask : Bid);
   double sl = price - direction * StepPriceDistance;
   double tp = price + direction * TakeProfitPriceDistance;

   double brokerMinimum = (MarketInfo(Symbol(), MODE_STOPLEVEL) + 1.0) * Point;
   if(StepPriceDistance < brokerMinimum || TakeProfitPriceDistance < brokerMinimum)
   {
      Print("Configured price distance is below broker StopLevel.");
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   if(level == 1 || g_cycleStartLot <= 0.0)
   {
      double scaledStart = StartLot;
      if(AutoScaleStartLotByBalance)
         scaledStart = StartLot * AccountBalance() / ReferenceBalance;
      g_cycleStartLot = NormalizeLots(scaledStart);
   }

   // Keep the starting lot fixed throughout one cycle. Realized recovery
   // losses must not reduce the base used by the next recovery level.
   double requestedLot = g_cycleStartLot * MathPow(LotMultiplier, level - 1);
   double lots = NormalizeLots(requestedLot);
   if(lots + 0.0000001 < requestedLot)
   {
      Print("Required lot ", DoubleToString(requestedLot, 2),
            " exceeds broker maximum. EA halted.");
      g_phase = PHASE_HALTED;
      SaveState();
      return(-1);
   }

   string comment = "GOLD_REC_L" + IntegerToString(level);
   ResetLastError();
   int ticket = OrderSend(Symbol(), type, lots, NormalizeDouble(price, Digits),
                          SlippagePoints, NormalizeDouble(sl, Digits),
                          NormalizeDouble(tp, Digits), comment, MagicNumber, 0,
                          (direction > 0 ? clrDodgerBlue : clrTomato));
   if(ticket < 0)
   {
      Print("OrderSend failed at level ", level, ". Error=", GetLastError());
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   g_phase = PHASE_ORDER_ACTIVE;
   g_ticket = ticket;
   g_level = level;
   g_direction = direction;
   g_entryPrice = price;
   SaveState();

   Print(direction > 0 ? "BUY" : "SELL", " opened. Level=", level,
         " lot=", DoubleToString(lots, 2), " ticket=", ticket,
         " entry=", DoubleToString(price, Digits),
         " SL=", DoubleToString(sl, Digits),
         " TP=", DoubleToString(tp, Digits));
   return(ticket);
}

//+------------------------------------------------------------------+
int GetSignalDirection()
{
   if(iBars(Symbol(), SignalTimeframe) <= SlowEmaPeriod + SignalShift)
      return(0);

   double fast = iMA(Symbol(), SignalTimeframe, FastEmaPeriod, 0, MODE_EMA,
                     AppliedPrice, SignalShift);
   double slow = iMA(Symbol(), SignalTimeframe, SlowEmaPeriod, 0, MODE_EMA,
                     AppliedPrice, SignalShift);
   if(fast > slow)
      return(1);
   if(fast < slow)
      return(-1);
   return(0);
}

//+------------------------------------------------------------------+
void AdoptOpenOrder(const int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES))
      return;

   g_phase = PHASE_ORDER_ACTIVE;
   g_ticket = ticket;
   g_direction = (OrderType() == OP_BUY ? 1 : -1);
   g_entryPrice = OrderOpenPrice();
   g_level = ParseLevel(OrderComment());
   if(g_level < 1)
      g_level = 1;
   g_cycleStartLot = OrderLots() / MathPow(LotMultiplier, g_level - 1);
   g_cycleStartLot = NormalizeLots(g_cycleStartLot);
   SaveState();
}

//+------------------------------------------------------------------+
int ParseLevel(const string comment)
{
   int marker = StringFind(comment, "GOLD_REC_L");
   if(marker < 0)
      return(1);
   return((int)StringToInteger(StringSubstr(comment, marker + 10)));
}

//+------------------------------------------------------------------+
int FindOpenMarketTicket()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsOurOrder() &&
         (OrderType() == OP_BUY || OrderType() == OP_SELL))
         return(OrderTicket());
   return(-1);
}

//+------------------------------------------------------------------+
bool HasUnexpectedExtraOrders()
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsOurOrder() &&
         (OrderType() == OP_BUY || OrderType() == OP_SELL))
         count++;
   return(count > 1);
}

//+------------------------------------------------------------------+
bool IsOurOrder()
{
   return(OrderSymbol() == Symbol() && OrderMagicNumber() == MagicNumber);
}

//+------------------------------------------------------------------+
bool IsGoldSymbol()
{
   string symbolName = Symbol();
   StringToUpper(symbolName);
   return(StringFind(symbolName, "XAU") >= 0 || StringFind(symbolName, "GOLD") >= 0);
}

//+------------------------------------------------------------------+
double NormalizeLots(const double requested)
{
   double minimum = MarketInfo(Symbol(), MODE_MINLOT);
   double maximum = MarketInfo(Symbol(), MODE_MAXLOT);
   double step = MarketInfo(Symbol(), MODE_LOTSTEP);
   if(step <= 0.0)
      step = 0.01;

   double lots = MathCeil(requested / step - 0.0000001) * step;
   lots = MathMax(minimum, MathMin(maximum, lots));
   int lotDigits = (step < 0.01 ? 3 : 2);
   return(NormalizeDouble(lots, lotDigits));
}

//+------------------------------------------------------------------+
bool SpreadAllowed()
{
   if(MaxSpreadPrice <= 0.0)
      return(true);
   RefreshRates();
   double spread = Ask - Bid;
   if(spread <= MaxSpreadPrice)
      return(true);

   g_nextRetryTime = TimeCurrent() + 5;
   Print("Entry delayed: spread price ", DoubleToString(spread, Digits),
         " exceeds MaxSpreadPrice.");
   return(false);
}

//+------------------------------------------------------------------+
void ResetState(const bool save)
{
   g_phase = PHASE_READY;
   g_ticket = -1;
   g_level = 0;
   g_direction = 0;
   g_entryPrice = 0.0;
   g_cycleStartLot = 0.0;
   if(save)
      SaveState();
}

//+------------------------------------------------------------------+
void SaveState()
{
   if(IsTesting() || StringLen(g_statePrefix) == 0)
      return;
   GlobalVariableSet(g_statePrefix + "PHASE", g_phase);
   GlobalVariableSet(g_statePrefix + "TICKET", g_ticket);
   GlobalVariableSet(g_statePrefix + "LEVEL", g_level);
   GlobalVariableSet(g_statePrefix + "DIR", g_direction);
   GlobalVariableSet(g_statePrefix + "ENTRY", g_entryPrice);
   GlobalVariableSet(g_statePrefix + "BASELOT", g_cycleStartLot);
}

//+------------------------------------------------------------------+
void RestoreState()
{
   if(!GlobalVariableCheck(g_statePrefix + "PHASE"))
   {
      ResetState(false);
      return;
   }

   g_phase = (int)GlobalVariableGet(g_statePrefix + "PHASE");
   g_ticket = (int)GlobalVariableGet(g_statePrefix + "TICKET");
   g_level = (int)GlobalVariableGet(g_statePrefix + "LEVEL");
   g_direction = (int)GlobalVariableGet(g_statePrefix + "DIR");
   g_entryPrice = GlobalVariableGet(g_statePrefix + "ENTRY");
   if(GlobalVariableCheck(g_statePrefix + "BASELOT"))
      g_cycleStartLot = GlobalVariableGet(g_statePrefix + "BASELOT");
   else
      g_cycleStartLot = 0.0;
}

//+------------------------------------------------------------------+
string PhaseText()
{
   if(g_phase == PHASE_READY) return("READY");
   if(g_phase == PHASE_ORDER_ACTIVE) return("ACTIVE");
   if(g_phase == PHASE_RECOVERY_PENDING) return("RECOVERY PENDING");
   return("HALTED");
}

//+------------------------------------------------------------------+
void ShowStatus(const int signal, const string detail)
{
   if(!ShowChartStatus)
      return;

   string signalText = (signal > 0 ? "BUY" : (signal < 0 ? "SELL" : "WAIT"));
   double displayBaseLot = g_cycleStartLot;
   if(displayBaseLot <= 0.0)
   {
      displayBaseLot = StartLot;
      if(AutoScaleStartLotByBalance)
         displayBaseLot = StartLot * AccountBalance() / ReferenceBalance;
      displayBaseLot = NormalizeLots(displayBaseLot);
   }
   double nextLot = displayBaseLot;
   if(g_level > 0)
      nextLot = displayBaseLot * MathPow(LotMultiplier, g_level - 1);

   Comment("GOLD EMA RECOVERY\n",
           "EMA signal: ", signalText, "  Phase: ", PhaseText(), "\n",
           "Level: ", g_level, "/", MaxTradesPerCycle,
           "  Cycle start lot: ", DoubleToString(displayBaseLot, 2),
           "  Current lot: ", DoubleToString(nextLot, 2), "\n",
           "TP price distance: ", DoubleToString(TakeProfitPriceDistance, 2),
           "  Step: ", DoubleToString(StepPriceDistance, 2), "\n",
           detail);
}
//+------------------------------------------------------------------+
