//+------------------------------------------------------------------+
//|                                      Gold_EMA_10_20_Reversal.mq4 |
//|       Gold only: EMA(10)[1] / EMA(20)[1] reversal strategy       |
//+------------------------------------------------------------------+
#property strict

input string SignalSettings = "--- EMA signal ---";
input ENUM_TIMEFRAMES SignalTimeframe = PERIOD_CURRENT;
input int FastEmaPeriod = 10;
input int SlowEmaPeriod = 20;
input int SignalShift = 1;
input ENUM_APPLIED_PRICE AppliedPrice = PRICE_CLOSE;
input bool EvaluateOnlyOnNewBar = true;

input string TradeSettings = "--- Trade ---";
input double Lots = 0.01;
input double StopLossPips = 0.0;       // 0 = disabled
input double TakeProfitPips = 0.0;     // 0 = disabled
input double MaxSpreadPips = 0.0;      // 0 = disabled
input int SlippagePoints = 30;
input int MagicNumber = 20260817;
input bool AllowNewOrders = true;
input bool ShowChartStatus = true;

datetime g_lastBarTime = 0;
datetime g_nextRetryTime = 0;
int      g_lastExecutedSignal = 0;
string   g_stateKey;

//+------------------------------------------------------------------+
int OnInit()
{
   if(FastEmaPeriod < 1 || SlowEmaPeriod < 1 || SignalShift < 0 ||
      Lots <= 0.0 || StopLossPips < 0.0 || TakeProfitPips < 0.0 ||
      MaxSpreadPips < 0.0)
   {
      Print("Invalid EA input value.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(!IsGoldSymbol())
   {
      Print("This EA works only on Gold (XAU/GOLD) symbols. Current symbol: ", Symbol());
      return(INIT_FAILED);
   }

   g_stateKey = "GOLD_EMA_ONCE_" + IntegerToString(AccountNumber()) + "_" +
                Symbol() + "_" + IntegerToString(MagicNumber);
   if(!IsTesting() && GlobalVariableCheck(g_stateKey))
      g_lastExecutedSignal = (int)GlobalVariableGet(g_stateKey);

   if(CountMarketOrders(1) > 0)
      g_lastExecutedSignal = 1;
   else if(CountMarketOrders(-1) > 0)
      g_lastExecutedSignal = -1;

   SaveSignalState();
   g_lastBarTime = 0;
   Print("Gold EMA Reversal EA loaded on ", Symbol());
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   SaveSignalState();
   if(ShowChartStatus)
      Comment("");
   Print("Gold EMA Reversal EA stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
void OnTick()
{
   int signal = GetSignalDirection();
   ShowStatus(signal);
   if(signal == 0)
      return;

   datetime currentBar = iTime(Symbol(), SignalTimeframe, 0);
   bool newBar = (currentBar > 0 && currentBar != g_lastBarTime);
   if(newBar)
      g_lastBarTime = currentBar;

   // A reversal is never delayed until another bar. With shift 1 the signal
   // normally changes only when a new candle begins.
   bool reversalNeeded = HasOppositePosition(signal);
   bool signalChanged = (signal != g_lastExecutedSignal);
   bool pendingExists = HasPendingOrders();
   if(EvaluateOnlyOnNewBar && !newBar && !reversalNeeded &&
      !pendingExists && !signalChanged)
      return;

   // Remove any pending order left by an older EA version.
   if(!DeleteAllPendingOrders())
      return;

   // One entry per EMA direction. If SL, TP, or manual close removes the
   // position, wait for the EMA direction to reverse before trading again.
   if(!signalChanged)
      return;

   if(reversalNeeded && !CloseOppositePositions(signal))
      return;

   if(CountMarketOrders(signal) > 0)
   {
      g_lastExecutedSignal = signal;
      SaveSignalState();
      return;
   }
   if(!AllowNewOrders || TimeCurrent() < g_nextRetryTime || !SpreadAllowed())
      return;

   if(OpenMarketOrder(signal) < 0)
      g_nextRetryTime = TimeCurrent() + 5;
   else
   {
      g_lastExecutedSignal = signal;
      SaveSignalState();
   }
}

//+------------------------------------------------------------------+
void SaveSignalState()
{
   if(IsTesting() || StringLen(g_stateKey) == 0)
      return;
   GlobalVariableSet(g_stateKey, g_lastExecutedSignal);
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
int OpenMarketOrder(const int direction)
{
   RefreshRates();
   int type = (direction > 0 ? OP_BUY : OP_SELL);
   double price = (direction > 0 ? Ask : Bid);
   double sl = 0.0;
   double tp = 0.0;
   CalculateStops(direction, price, sl, tp);

   ResetLastError();
   int ticket = OrderSend(Symbol(), type, NormalizeLots(Lots),
                          NormalizeDouble(price, Digits), SlippagePoints,
                          sl, tp, "GOLD_EMA_REV", MagicNumber, 0,
                          (direction > 0 ? clrDodgerBlue : clrTomato));
   if(ticket < 0)
   {
      Print("OrderSend failed. Error=", GetLastError());
      return(-1);
   }

   Print(direction > 0 ? "BUY" : "SELL", " opened. Ticket=", ticket,
         " price=", DoubleToString(price, Digits));
   return(ticket);
}

//+------------------------------------------------------------------+
bool CloseOppositePositions(const int newDirection)
{
   bool success = true;
   int oppositeType = (newDirection > 0 ? OP_SELL : OP_BUY);

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsOurOrder() ||
         OrderType() != oppositeType)
         continue;

      RefreshRates();
      int ticket = OrderTicket();
      double closePrice = (oppositeType == OP_BUY ? Bid : Ask);
      ResetLastError();
      if(!OrderClose(ticket, OrderLots(), NormalizeDouble(closePrice, Digits),
                     SlippagePoints, clrNONE))
      {
         Print("OrderClose failed. Ticket=", ticket, " Error=", GetLastError());
         success = false;
      }
      else
         Print("Previous position closed. Ticket=", ticket);
   }

   if(HasOppositePosition(newDirection))
      success = false;
   return(success);
}

//+------------------------------------------------------------------+
bool DeleteAllPendingOrders()
{
   bool success = true;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsOurOrder())
         continue;

      int type = OrderType();
      if(type != OP_BUYLIMIT && type != OP_SELLLIMIT &&
         type != OP_BUYSTOP && type != OP_SELLSTOP)
         continue;

      int ticket = OrderTicket();
      ResetLastError();
      if(!OrderDelete(ticket, clrNONE))
      {
         Print("Old pending order delete failed. Ticket=", ticket,
               " Error=", GetLastError());
         success = false;
      }
      else
         Print("Old pending order deleted. Ticket=", ticket);
   }
   return(success && !HasPendingOrders());
}

//+------------------------------------------------------------------+
bool HasOppositePosition(const int direction)
{
   int oppositeType = (direction > 0 ? OP_SELL : OP_BUY);
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsOurOrder() &&
         OrderType() == oppositeType)
         return(true);
   return(false);
}

//+------------------------------------------------------------------+
int CountMarketOrders(const int direction)
{
   int count = 0;
   int wantedType = (direction > 0 ? OP_BUY : OP_SELL);
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsOurOrder() &&
         OrderType() == wantedType)
         count++;
   return(count);
}

//+------------------------------------------------------------------+
bool HasPendingOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsOurOrder())
         continue;
      int type = OrderType();
      if(type == OP_BUYLIMIT || type == OP_SELLLIMIT ||
         type == OP_BUYSTOP || type == OP_SELLSTOP)
         return(true);
   }
   return(false);
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
void CalculateStops(const int direction, const double entry,
                    double &sl, double &tp)
{
   double minimum = (MarketInfo(Symbol(), MODE_STOPLEVEL) + 1.0) * Point;
   double slDistance = (StopLossPips > 0.0 ? MathMax(StopLossPips * PipSize(), minimum) : 0.0);
   double tpDistance = (TakeProfitPips > 0.0 ? MathMax(TakeProfitPips * PipSize(), minimum) : 0.0);

   sl = (slDistance > 0.0 ? entry - direction * slDistance : 0.0);
   tp = (tpDistance > 0.0 ? entry + direction * tpDistance : 0.0);
   if(sl > 0.0) sl = NormalizeDouble(sl, Digits);
   if(tp > 0.0) tp = NormalizeDouble(tp, Digits);
}

//+------------------------------------------------------------------+
double PipSize()
{
   return((Digits == 3 || Digits == 5) ? 10.0 * Point : Point);
}

//+------------------------------------------------------------------+
double NormalizeLots(const double requested)
{
   double minimum = MarketInfo(Symbol(), MODE_MINLOT);
   double maximum = MarketInfo(Symbol(), MODE_MAXLOT);
   double step = MarketInfo(Symbol(), MODE_LOTSTEP);
   if(step <= 0.0)
      step = 0.01;
   double lots = MathFloor(requested / step + 0.0000001) * step;
   lots = MathMax(minimum, MathMin(maximum, lots));
   return(NormalizeDouble(lots, 2));
}

//+------------------------------------------------------------------+
bool SpreadAllowed()
{
   if(MaxSpreadPips <= 0.0)
      return(true);
   RefreshRates();
   double spread = (Ask - Bid) / PipSize();
   if(spread <= MaxSpreadPips)
      return(true);

   Print("Entry delayed: spread ", DoubleToString(spread, 1),
         " pips exceeds MaxSpreadPips.");
   g_nextRetryTime = TimeCurrent() + 5;
   return(false);
}

//+------------------------------------------------------------------+
void ShowStatus(const int signal)
{
   if(!ShowChartStatus)
      return;

   string signalText = (signal > 0 ? "BUY" : (signal < 0 ? "SELL" : "WAIT"));
   double spread = (Ask - Bid) / PipSize();
   Comment("GOLD EMA ", FastEmaPeriod, " / ", SlowEmaPeriod,
           "  shift=", SignalShift, "\n",
           "Signal: ", signalText,
           "  Spread: ", DoubleToString(spread, 1), " pips\n",
           "BUY orders: ", CountMarketOrders(1),
           "  SELL orders: ", CountMarketOrders(-1));
}
//+------------------------------------------------------------------+
