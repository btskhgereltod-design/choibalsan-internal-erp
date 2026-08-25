//+------------------------------------------------------------------+
//|                               Gold_EMA_Trend_Pyramid_EA.mq4      |
//|  Adds size only while Gold moves in the profitable direction.   |
//+------------------------------------------------------------------+
#property strict

input string SignalSettings = "--- EMA start signal ---";
input ENUM_TIMEFRAMES SignalTimeframe = PERIOD_CURRENT;
input int FastEmaPeriod = 10;
input int SlowEmaPeriod = 20;
input int SignalShift = 1;
input ENUM_APPLIED_PRICE AppliedPrice = PRICE_CLOSE;

input string PyramidSettings = "--- Trend pyramid ---";
input double StartLot = 0.01;
input double LotMultiplier = 3.0;
input int MaxOrders = 5;
input double AddStepPriceDistance = 20.0;
input double BasketStopPriceDistance = 10.0;
input double FinalTakeProfitPriceDistance = 20.0;

input string ExecutionSettings = "--- Execution ---";
input double MaxSpreadPrice = 0.0;       // 0 = disabled
input int SlippagePoints = 50;
input int MagicNumber = 20260819;
input bool AllowNewCycles = true;
input bool StartFirstCycleImmediately = true;
input bool ShowChartStatus = true;

datetime g_lastSignalBarTime = 0;
datetime g_nextRetryTime = 0;
bool     g_closingBasket = false;
bool     g_hadOpenBasket = false;
int      g_peakBasketCount = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(FastEmaPeriod < 1 || SlowEmaPeriod < 1 || SignalShift < 0 ||
      StartLot <= 0.0 || LotMultiplier < 1.0 || MaxOrders < 1 ||
      AddStepPriceDistance <= 0.0 || BasketStopPriceDistance <= 0.0 ||
      FinalTakeProfitPriceDistance <= 0.0 || MaxSpreadPrice < 0.0)
   {
      Print("Invalid EA input value.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(!IsGoldSymbol())
   {
      Print("This EA works only on Gold (XAU/GOLD) symbols. Current symbol: ", Symbol());
      return(INIT_FAILED);
   }

   int count = CountOpenOrders();
   if(count > 0)
   {
      g_hadOpenBasket = true;
      g_peakBasketCount = count;
      int direction = 0;
      double latestEntry = 0.0;
      datetime latestTime = 0;
      if(GetBasketInfo(count, direction, latestEntry, latestTime))
         UpdateBasketProtection(direction, latestEntry, count);
   }
   else if(!StartFirstCycleImmediately)
      g_lastSignalBarTime = iTime(Symbol(), SignalTimeframe, 0);

   Print("Gold EMA Trend Pyramid EA loaded on ", Symbol());
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(ShowChartStatus)
      Comment("");
   Print("Gold EMA Trend Pyramid EA stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
void OnTick()
{
   int count = CountOpenOrders();

   if(count == 0)
   {
      if(g_hadOpenBasket || g_closingBasket)
      {
         FinishBasket();
         ShowStatus(0, 0, 0.0, "Basket closed; waiting for next signal bar.");
         return;
      }

      if(!AllowNewCycles)
      {
         ShowStatus(GetSignalDirection(), 0, 0.0, "New cycles disabled.");
         return;
      }

      if(TimeCurrent() < g_nextRetryTime)
         return;

      if(!IsNewSignalBar())
      {
         ShowStatus(GetSignalDirection(), 0, 0.0, "Waiting for next signal bar.");
         return;
      }

      int signal = GetSignalDirection();
      if(signal == 0)
      {
         ShowStatus(signal, 0, 0.0, "No EMA direction.");
         return;
      }

      if(!SpreadAllowed())
         return;

      if(OpenPyramidOrder(signal, 1) > 0)
      {
         g_hadOpenBasket = true;
         g_peakBasketCount = 1;
      }
      return;
   }

   g_hadOpenBasket = true;
   if(count > g_peakBasketCount)
      g_peakBasketCount = count;

   if(g_closingBasket || count < g_peakBasketCount)
   {
      g_closingBasket = true;
      CloseAllOrders("partial basket exit");
      return;
   }

   int direction = 0;
   double latestEntry = 0.0;
   datetime latestTime = 0;
   if(!GetBasketInfo(count, direction, latestEntry, latestTime))
   {
      g_closingBasket = true;
      CloseAllOrders("invalid basket state");
      return;
   }

   RefreshRates();
   double closeQuote = (direction > 0 ? Bid : Ask);
   double stopPrice = latestEntry - direction * BasketStopPriceDistance;

   if((direction > 0 && closeQuote <= stopPrice) ||
      (direction < 0 && closeQuote >= stopPrice))
   {
      g_closingBasket = true;
      CloseAllOrders("basket stop");
      return;
   }

   if(count >= MaxOrders)
   {
      double targetPrice = latestEntry + direction * FinalTakeProfitPriceDistance;
      if((direction > 0 && closeQuote >= targetPrice) ||
         (direction < 0 && closeQuote <= targetPrice))
      {
         g_closingBasket = true;
         CloseAllOrders("final basket target");
         return;
      }

      ShowStatus(direction, count, latestEntry, "Maximum level active.");
      return;
   }

   double entryQuote = (direction > 0 ? Ask : Bid);
   double nextTrigger = latestEntry + direction * AddStepPriceDistance;
   if((direction > 0 && entryQuote >= nextTrigger) ||
      (direction < 0 && entryQuote <= nextTrigger))
   {
      if(TimeCurrent() >= g_nextRetryTime && SpreadAllowed())
      {
         int ticket = OpenPyramidOrder(direction, count + 1);
         if(ticket > 0)
         {
            g_peakBasketCount = count + 1;
            if(OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES))
               latestEntry = OrderOpenPrice();
            UpdateBasketProtection(direction, latestEntry, count + 1);
         }
      }
   }

   ShowStatus(direction, CountOpenOrders(), latestEntry, "Basket active.");
}

//+------------------------------------------------------------------+
int OpenPyramidOrder(const int direction, const int level)
{
   RefreshRates();
   int type = (direction > 0 ? OP_BUY : OP_SELL);
   double price = (direction > 0 ? Ask : Bid);
   double requestedLot = StartLot * MathPow(LotMultiplier, level - 1);
   double lots = NormalizeLots(requestedLot);

   if(lots + 0.0000001 < requestedLot)
   {
      Print("Required lot ", DoubleToString(requestedLot, 3),
            " exceeds broker maximum or lot step.");
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   double stopPrice = price - direction * BasketStopPriceDistance;
   double targetPrice = 0.0;
   if(level >= MaxOrders)
      targetPrice = price + direction * FinalTakeProfitPriceDistance;

   double brokerMinimum = (MarketInfo(Symbol(), MODE_STOPLEVEL) + 1.0) * Point;
   if(BasketStopPriceDistance < brokerMinimum ||
      (level >= MaxOrders && FinalTakeProfitPriceDistance < brokerMinimum))
   {
      Print("Configured price distance is below broker StopLevel.");
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   string comment = "GOLD_PYR_L" + IntegerToString(level);
   ResetLastError();
   int ticket = OrderSend(Symbol(), type, lots, NormalizeDouble(price, Digits),
                          SlippagePoints, NormalizeDouble(stopPrice, Digits),
                          NormalizeDouble(targetPrice, Digits), comment,
                          MagicNumber, 0, (direction > 0 ? clrDodgerBlue : clrTomato));
   if(ticket < 0)
   {
      Print("OrderSend failed at level ", level, ". Error=", GetLastError());
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   Print(direction > 0 ? "BUY" : "SELL", " pyramid order opened. Level=", level,
         " lot=", DoubleToString(lots, 2), " ticket=", ticket,
         " entry=", DoubleToString(price, Digits));
   return(ticket);
}

//+------------------------------------------------------------------+
bool UpdateBasketProtection(const int direction, const double latestEntry, const int count)
{
   double commonStop = NormalizeDouble(latestEntry - direction * BasketStopPriceDistance, Digits);
   double commonTarget = 0.0;
   if(count >= MaxOrders)
      commonTarget = NormalizeDouble(latestEntry + direction * FinalTakeProfitPriceDistance, Digits);

   bool allUpdated = true;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsOurMarketOrder())
         continue;

      if(MathAbs(OrderStopLoss() - commonStop) <= Point / 2.0 &&
         MathAbs(OrderTakeProfit() - commonTarget) <= Point / 2.0)
         continue;

      ResetLastError();
      if(!OrderModify(OrderTicket(), OrderOpenPrice(), commonStop, commonTarget, 0, clrNONE))
      {
         Print("OrderModify failed. Ticket=", OrderTicket(), " Error=", GetLastError());
         allUpdated = false;
      }
   }
   return(allUpdated);
}

//+------------------------------------------------------------------+
bool CloseAllOrders(const string reason)
{
   bool allClosed = true;
   RefreshRates();

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsOurMarketOrder())
         continue;

      double closePrice = (OrderType() == OP_BUY ? Bid : Ask);
      ResetLastError();
      if(!OrderClose(OrderTicket(), OrderLots(), NormalizeDouble(closePrice, Digits),
                     SlippagePoints, clrSilver))
      {
         Print("OrderClose failed. Ticket=", OrderTicket(), " Error=", GetLastError());
         allClosed = false;
      }
   }

   if(CountOpenOrders() == 0)
   {
      Print("Basket closed: ", reason);
      FinishBasket();
      return(true);
   }

   g_nextRetryTime = TimeCurrent() + 2;
   return(allClosed);
}

//+------------------------------------------------------------------+
void FinishBasket()
{
   g_closingBasket = false;
   g_hadOpenBasket = false;
   g_peakBasketCount = 0;
   g_lastSignalBarTime = iTime(Symbol(), SignalTimeframe, 0);
}

//+------------------------------------------------------------------+
bool GetBasketInfo(const int expectedCount, int &direction, double &latestEntry,
                   datetime &latestTime)
{
   direction = 0;
   latestEntry = 0.0;
   latestTime = 0;
   int found = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsOurMarketOrder())
         continue;

      int orderDirection = (OrderType() == OP_BUY ? 1 : -1);
      if(direction == 0)
         direction = orderDirection;
      else if(direction != orderDirection)
         return(false);

      found++;
      if(OrderOpenTime() > latestTime ||
         (OrderOpenTime() == latestTime && OrderOpenPrice() != latestEntry))
      {
         latestTime = OrderOpenTime();
         latestEntry = OrderOpenPrice();
      }
   }
   return(found == expectedCount && found > 0);
}

//+------------------------------------------------------------------+
int CountOpenOrders()
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsOurMarketOrder())
         count++;
   return(count);
}

//+------------------------------------------------------------------+
double BasketFloatingProfit()
{
   double profit = 0.0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsOurMarketOrder())
         profit += OrderProfit() + OrderSwap() + OrderCommission();
   return(profit);
}

//+------------------------------------------------------------------+
bool IsOurMarketOrder()
{
   return(OrderSymbol() == Symbol() && OrderMagicNumber() == MagicNumber &&
          (OrderType() == OP_BUY || OrderType() == OP_SELL));
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
bool IsNewSignalBar()
{
   datetime currentBar = iTime(Symbol(), SignalTimeframe, 0);
   if(currentBar <= 0)
      return(false);

   if(g_lastSignalBarTime == 0)
   {
      g_lastSignalBarTime = currentBar;
      return(StartFirstCycleImmediately);
   }

   if(currentBar == g_lastSignalBarTime)
      return(false);

   g_lastSignalBarTime = currentBar;
   return(true);
}

//+------------------------------------------------------------------+
bool SpreadAllowed()
{
   if(MaxSpreadPrice <= 0.0)
      return(true);

   RefreshRates();
   if(Ask - Bid <= MaxSpreadPrice)
      return(true);

   Print("Entry delayed: spread price ", DoubleToString(Ask - Bid, Digits),
         " exceeds MaxSpreadPrice.");
   g_nextRetryTime = TimeCurrent() + 5;
   return(false);
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
   int lotDigits = (step < 0.01 ? 3 : 2);
   return(NormalizeDouble(lots, lotDigits));
}

//+------------------------------------------------------------------+
bool IsGoldSymbol()
{
   string symbolName = Symbol();
   StringToUpper(symbolName);
   return(StringFind(symbolName, "XAU") >= 0 || StringFind(symbolName, "GOLD") >= 0);
}

//+------------------------------------------------------------------+
void ShowStatus(const int direction, const int count, const double latestEntry,
                const string detail)
{
   if(!ShowChartStatus)
      return;

   string directionText = (direction > 0 ? "BUY" : (direction < 0 ? "SELL" : "WAIT"));
   double nextLot = StartLot * MathPow(LotMultiplier, count);
   double stopPrice = 0.0;
   double nextPrice = 0.0;
   if(count > 0)
   {
      stopPrice = latestEntry - direction * BasketStopPriceDistance;
      nextPrice = latestEntry + direction * (count >= MaxOrders ?
                  FinalTakeProfitPriceDistance : AddStepPriceDistance);
   }

   Comment("GOLD EMA TREND PYRAMID\n",
           "Direction: ", directionText, "  Level: ", count, "/", MaxOrders, "\n",
           "Latest entry: ", DoubleToString(latestEntry, Digits),
           "  Basket stop: ", DoubleToString(stopPrice, Digits), "\n",
           (count >= MaxOrders ? "Final target: " : "Next add: "),
           DoubleToString(nextPrice, Digits),
           "  Next lot: ", DoubleToString(nextLot, 2), "\n",
           "Floating P/L: ", DoubleToString(BasketFloatingProfit(), 2), "\n",
           detail);
}
//+------------------------------------------------------------------+
