//+------------------------------------------------------------------+
//|              Gold_Dual_Trend_Pyramid_DynamicMoneyStop_EA.mq4    |
//| Dual pyramids with level-based account-currency basket stops.    |
//+------------------------------------------------------------------+
#property strict

input string PyramidSettings = "--- Dual trend pyramid ---";
input double StartLot = 0.01;
input double LotMultiplier = 3.0;
input int MaxOrdersPerSide = 5;
input double AddStepPriceDistance = 20.0;
input double BaseBasketStopMoney = 10.0;
input double BasketStopMultiplier = 3.0;
input double BrokerEmergencyMultiplier = 1.25;
input double FinalTakeProfitPriceDistance = 20.0;

input string SideSettings = "--- Independent sides ---";
input bool EnableBuy = true;
input bool EnableSell = true;
input int BuyMagicNumber = 20260827;
input int SellMagicNumber = 20260828;
input int RestartDelaySeconds = 0;

input string ExecutionSettings = "--- Execution ---";
input double MaxSpreadPrice = 0.0;       // 0 = disabled
input int SlippagePoints = 50;
input bool AllowNewOrders = true;
input bool ShowChartStatus = true;

bool     g_buyClosing = false;
bool     g_sellClosing = false;
bool     g_buyHadBasket = false;
bool     g_sellHadBasket = false;
int      g_buyPeakCount = 0;
int      g_sellPeakCount = 0;
datetime g_buyNextStart = 0;
datetime g_sellNextStart = 0;
datetime g_nextRetryTime = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(StartLot <= 0.0 || LotMultiplier < 1.0 || MaxOrdersPerSide < 1 ||
      AddStepPriceDistance <= 0.0 || BaseBasketStopMoney <= 0.0 ||
      BasketStopMultiplier < 1.0 || BrokerEmergencyMultiplier < 1.0 ||
      FinalTakeProfitPriceDistance <= 0.0 || RestartDelaySeconds < 0 ||
      MaxSpreadPrice < 0.0 || BuyMagicNumber == SellMagicNumber)
   {
      Print("Invalid EA input value. BUY and SELL magic numbers must differ.");
      return(INIT_PARAMETERS_INCORRECT);
   }

   if(!IsGoldSymbol())
   {
      Print("This EA works only on Gold (XAU/GOLD) symbols. Current symbol: ", Symbol());
      return(INIT_FAILED);
   }

   AdoptSide(1);
   AdoptSide(-1);
   Print("Gold Dual Trend Pyramid Dynamic Money Stop EA loaded on ", Symbol());
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(ShowChartStatus)
      Comment("");
   Print("Gold Dual Trend Pyramid Dynamic Money Stop EA stopped. Reason: ", reason);
}

//+------------------------------------------------------------------+
void OnTick()
{
   ManageSide(1);
   ManageSide(-1);
   ShowStatus();
}

//+------------------------------------------------------------------+
void ManageSide(const int direction)
{
   bool enabled = (direction > 0 ? EnableBuy : EnableSell);
   int count = CountSideOrders(direction);
   bool closing = GetClosing(direction);
   bool hadBasket = GetHadBasket(direction);
   int peakCount = GetPeakCount(direction);

   if(count == 0)
   {
      if(hadBasket || closing)
      {
         FinishSide(direction);
         return;
      }

      if(!enabled || !AllowNewOrders || TimeCurrent() < GetNextStart(direction) ||
         TimeCurrent() < g_nextRetryTime || !SpreadAllowed())
         return;

      if(OpenSideOrder(direction, 1) > 0)
      {
         SetHadBasket(direction, true);
         SetPeakCount(direction, 1);
      }
      return;
   }

   SetHadBasket(direction, true);
   if(count > peakCount)
   {
      SetPeakCount(direction, count);
      peakCount = count;
   }

   if(closing || count < peakCount)
   {
      SetClosing(direction, true);
      CloseSideOrders(direction, "partial basket exit");
      return;
   }

   double latestEntry = 0.0;
   datetime latestTime = 0;
   if(!GetSideBasketInfo(direction, count, latestEntry, latestTime))
   {
      SetClosing(direction, true);
      CloseSideOrders(direction, "invalid basket state");
      return;
   }

   double basketStopMoney = StopMoneyForLevel(count);
   if(SideFloatingProfit(direction) <= -basketStopMoney)
   {
      SetClosing(direction, true);
      CloseSideOrders(direction, "money basket stop");
      return;
   }

   RefreshRates();
   double closeQuote = (direction > 0 ? Bid : Ask);
   if(count >= MaxOrdersPerSide)
   {
      double targetPrice = latestEntry + direction * FinalTakeProfitPriceDistance;
      if((direction > 0 && closeQuote >= targetPrice) ||
         (direction < 0 && closeQuote <= targetPrice))
      {
         SetClosing(direction, true);
         CloseSideOrders(direction, "final basket target");
      }
      return;
   }

   double entryQuote = (direction > 0 ? Ask : Bid);
   double nextTrigger = latestEntry + direction * AddStepPriceDistance;
   if((direction > 0 && entryQuote >= nextTrigger) ||
      (direction < 0 && entryQuote <= nextTrigger))
   {
      if(TimeCurrent() >= g_nextRetryTime && SpreadAllowed())
      {
         int ticket = OpenSideOrder(direction, count + 1);
         if(ticket > 0)
         {
            SetPeakCount(direction, count + 1);
            if(OrderSelect(ticket, SELECT_BY_TICKET, MODE_TRADES))
               latestEntry = OrderOpenPrice();
            UpdateSideProtection(direction, latestEntry, count + 1);
         }
      }
   }
}

//+------------------------------------------------------------------+
int OpenSideOrder(const int direction, const int level)
{
   RefreshRates();
   int type = (direction > 0 ? OP_BUY : OP_SELL);
   double price = (direction > 0 ? Ask : Bid);
   double requestedLot = StartLot * MathPow(LotMultiplier, level - 1);
   double lots = NormalizeLots(requestedLot);
   if(lots + 0.0000001 < requestedLot)
   {
      Print("Required lot exceeds broker maximum or lot step. Direction=", direction,
            " Level=", level, " Requested=", DoubleToString(requestedLot, 3));
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize = MarketInfo(Symbol(), MODE_TICKSIZE);
   if(tickSize <= 0.0)
      tickSize = Point;
   double valuePerPrice = (tickSize > 0.0 ? lots * tickValue / tickSize : 0.0);
   double stopPrice = 0.0;
   if(level == 1 && valuePerPrice > 0.0)
      stopPrice = price - direction * EmergencyStopMoneyForLevel(level) / valuePerPrice;
   double targetPrice = 0.0;
   if(level >= MaxOrdersPerSide)
      targetPrice = price + direction * FinalTakeProfitPriceDistance;

   double brokerMinimum = (MarketInfo(Symbol(), MODE_STOPLEVEL) + 1.0) * Point;
   if((level >= MaxOrdersPerSide && FinalTakeProfitPriceDistance < brokerMinimum))
   {
      Print("Configured price distance is below broker StopLevel.");
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   int magic = SideMagic(direction);
   string side = (direction > 0 ? "BUY" : "SELL");
   string comment = "GOLD_DYNSTOP_" + side + "_L" + IntegerToString(level);
   ResetLastError();
   int ticket = OrderSend(Symbol(), type, lots, NormalizeDouble(price, Digits),
                          SlippagePoints, NormalizeDouble(stopPrice, Digits),
                          NormalizeDouble(targetPrice, Digits), comment, magic, 0,
                          (direction > 0 ? clrDodgerBlue : clrTomato));
   if(ticket < 0)
   {
      Print(side, " OrderSend failed. Level=", level, " Error=", GetLastError());
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   Print(side, " pyramid order opened. Level=", level,
         " lot=", DoubleToString(lots, 2), " ticket=", ticket);
   return(ticket);
}

//+------------------------------------------------------------------+
bool UpdateSideProtection(const int direction, const double latestEntry, const int count)
{
   double commonStop = CalculateMoneyStopPrice(direction, EmergencyStopMoneyForLevel(count));
   if(commonStop <= 0.0)
   {
      Print("Could not calculate broker emergency money stop. Direction=", direction);
      return(false);
   }
   double commonTarget = 0.0;
   if(count >= MaxOrdersPerSide)
      commonTarget = NormalizeDouble(latestEntry + direction * FinalTakeProfitPriceDistance, Digits);

   bool allUpdated = true;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsSideOrder(direction))
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
double CalculateMoneyStopPrice(const int direction, const double lossMoney)
{
   RefreshRates();
   double sensitivity = 0.0;
   double tickValue = MarketInfo(Symbol(), MODE_TICKVALUE);
   double tickSize = MarketInfo(Symbol(), MODE_TICKSIZE);
   if(tickSize <= 0.0)
      tickSize = Point;
   if(tickValue <= 0.0 || tickSize <= 0.0)
      return(0.0);

   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsSideOrder(direction))
         sensitivity += OrderLots() * tickValue / tickSize;

   if(sensitivity <= 0.0)
      return(0.0);

   double quote = (direction > 0 ? Bid : Ask);
   double profit = SideFloatingProfit(direction);
   double stopPrice = quote + (-lossMoney - profit) / (direction * sensitivity);
   double brokerMinimum = (MarketInfo(Symbol(), MODE_STOPLEVEL) + 1.0) * Point;

   if(direction > 0 && stopPrice >= Bid - brokerMinimum)
      stopPrice = Bid - brokerMinimum;
   if(direction < 0 && stopPrice <= Ask + brokerMinimum)
      stopPrice = Ask + brokerMinimum;
   return(NormalizeDouble(stopPrice, Digits));
}

//+------------------------------------------------------------------+
void CloseSideOrders(const int direction, const string reason)
{
   RefreshRates();
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsSideOrder(direction))
         continue;
      double closePrice = (direction > 0 ? Bid : Ask);
      ResetLastError();
      if(!OrderClose(OrderTicket(), OrderLots(), NormalizeDouble(closePrice, Digits),
                     SlippagePoints, clrSilver))
         Print("OrderClose failed. Ticket=", OrderTicket(), " Error=", GetLastError());
   }

   if(CountSideOrders(direction) == 0)
   {
      Print(direction > 0 ? "BUY" : "SELL", " basket closed: ", reason);
      FinishSide(direction);
   }
   else
      g_nextRetryTime = TimeCurrent() + 2;
}

//+------------------------------------------------------------------+
void FinishSide(const int direction)
{
   SetClosing(direction, false);
   SetHadBasket(direction, false);
   SetPeakCount(direction, 0);
   SetNextStart(direction, TimeCurrent() + RestartDelaySeconds);
}

//+------------------------------------------------------------------+
void AdoptSide(const int direction)
{
   int count = CountSideOrders(direction);
   if(count <= 0)
      return;
   SetHadBasket(direction, true);
   SetPeakCount(direction, count);
   double latestEntry = 0.0;
   datetime latestTime = 0;
   if(GetSideBasketInfo(direction, count, latestEntry, latestTime))
      UpdateSideProtection(direction, latestEntry, count);
}

//+------------------------------------------------------------------+
bool GetSideBasketInfo(const int direction, const int expectedCount,
                       double &latestEntry, datetime &latestTime)
{
   latestEntry = 0.0;
   latestTime = 0;
   int found = 0;
   int latestTicket = -1;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsSideOrder(direction))
         continue;
      found++;
      if(OrderOpenTime() > latestTime ||
         (OrderOpenTime() == latestTime && OrderTicket() > latestTicket))
      {
         latestTime = OrderOpenTime();
         latestTicket = OrderTicket();
         latestEntry = OrderOpenPrice();
      }
   }
   return(found == expectedCount && found > 0);
}

//+------------------------------------------------------------------+
int CountSideOrders(const int direction)
{
   int count = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsSideOrder(direction))
         count++;
   return(count);
}

//+------------------------------------------------------------------+
bool IsSideOrder(const int direction)
{
   int type = (direction > 0 ? OP_BUY : OP_SELL);
   return(OrderSymbol() == Symbol() && OrderMagicNumber() == SideMagic(direction) &&
          OrderType() == type);
}

//+------------------------------------------------------------------+
int SideMagic(const int direction)
{
   return(direction > 0 ? BuyMagicNumber : SellMagicNumber);
}

//+------------------------------------------------------------------+
double SideFloatingProfit(const int direction)
{
   double profit = 0.0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(OrderSelect(i, SELECT_BY_POS, MODE_TRADES) && IsSideOrder(direction))
         profit += OrderProfit() + OrderSwap() + OrderCommission();
   return(profit);
}

//+------------------------------------------------------------------+
double StopMoneyForLevel(const int level)
{
   int safeLevel = MathMax(1, MathMin(level, MaxOrdersPerSide));
   return(BaseBasketStopMoney * MathPow(BasketStopMultiplier, safeLevel - 1));
}

//+------------------------------------------------------------------+
double EmergencyStopMoneyForLevel(const int level)
{
   return(StopMoneyForLevel(level) * BrokerEmergencyMultiplier);
}

//+------------------------------------------------------------------+
bool SpreadAllowed()
{
   if(MaxSpreadPrice <= 0.0)
      return(true);
   RefreshRates();
   if(Ask - Bid <= MaxSpreadPrice)
      return(true);
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
bool GetClosing(const int direction) { return(direction > 0 ? g_buyClosing : g_sellClosing); }
bool GetHadBasket(const int direction) { return(direction > 0 ? g_buyHadBasket : g_sellHadBasket); }
int GetPeakCount(const int direction) { return(direction > 0 ? g_buyPeakCount : g_sellPeakCount); }
datetime GetNextStart(const int direction) { return(direction > 0 ? g_buyNextStart : g_sellNextStart); }
void SetClosing(const int direction, const bool value) { if(direction > 0) g_buyClosing=value; else g_sellClosing=value; }
void SetHadBasket(const int direction, const bool value) { if(direction > 0) g_buyHadBasket=value; else g_sellHadBasket=value; }
void SetPeakCount(const int direction, const int value) { if(direction > 0) g_buyPeakCount=value; else g_sellPeakCount=value; }
void SetNextStart(const int direction, const datetime value) { if(direction > 0) g_buyNextStart=value; else g_sellNextStart=value; }

//+------------------------------------------------------------------+
void ShowStatus()
{
   if(!ShowChartStatus)
      return;
   int buyCount = CountSideOrders(1);
   int sellCount = CountSideOrders(-1);
   double buyStop = StopMoneyForLevel(buyCount);
   double sellStop = StopMoneyForLevel(sellCount);
   Comment("GOLD DUAL TREND PYRAMID - DYNAMIC MONEY STOP\n",
           "BUY magic: ", BuyMagicNumber, "  Level: ", buyCount, "/", MaxOrdersPerSide,
           "  Floating: ", DoubleToString(SideFloatingProfit(1), 2),
           "  Stop: -", DoubleToString(buyStop, 2), "\n",
           "SELL magic: ", SellMagicNumber, "  Level: ", sellCount, "/", MaxOrdersPerSide,
           "  Floating: ", DoubleToString(SideFloatingProfit(-1), 2),
           "  Stop: -", DoubleToString(sellStop, 2), "\n",
           "Step: ", DoubleToString(AddStepPriceDistance, 2),
           "  Stop sequence: -", DoubleToString(BaseBasketStopMoney, 2),
           " x", DoubleToString(BasketStopMultiplier, 2),
           "  Final target: ", DoubleToString(FinalTakeProfitPriceDistance, 2));
}
//+------------------------------------------------------------------+
