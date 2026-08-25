//+------------------------------------------------------------------+
//|                    Gold_Dual_Trend_Pyramid_AutoScale15_EA.mq4   |
//| Dual BUY/SELL pyramids with x1.5 lots and balance-based scaling. |
//+------------------------------------------------------------------+
#property strict

input string PyramidSettings = "--- Dual trend pyramid ---";
input double BaseStartLot = 0.01;
input double LotMultiplier = 1.5;
input bool AutoScaleStartLotByBalance = true;
input double ReferenceBalance = 10000.0;
input int MaxOrdersPerSide = 5;
input double AddStepPriceDistance = 20.0;
input double BasketStopPriceDistance = 10.0;
input double FinalTakeProfitPriceDistance = 20.0;

input string SideSettings = "--- Independent sides ---";
input bool EnableBuy = true;
input bool EnableSell = true;
input int BuyMagicNumber = 20260829;
input int SellMagicNumber = 20260830;
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
   if(BaseStartLot <= 0.0 || LotMultiplier < 1.0 || ReferenceBalance <= 0.0 ||
      MaxOrdersPerSide < 1 ||
      AddStepPriceDistance <= 0.0 || BasketStopPriceDistance <= 0.0 ||
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
   Print("Gold Dual Trend Pyramid AutoScale x1.5 EA loaded on ", Symbol());
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(ShowChartStatus)
      Comment("");
   Print("Gold Dual Trend Pyramid AutoScale x1.5 EA stopped. Reason: ", reason);
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

   RefreshRates();
   double closeQuote = (direction > 0 ? Bid : Ask);
   double stopPrice = latestEntry - direction * BasketStopPriceDistance;
   if((direction > 0 && closeQuote <= stopPrice) ||
      (direction < 0 && closeQuote >= stopPrice))
   {
      SetClosing(direction, true);
      CloseSideOrders(direction, "basket stop");
      return;
   }

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
   double basketBaseLot = (level <= 1 ? ScaledStartLot() : SideBaseLot(direction));
   if(basketBaseLot <= 0.0)
   {
      Print("Could not determine basket base lot. Direction=", direction,
            " Level=", level);
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }
   double requestedLot = basketBaseLot * MathPow(LotMultiplier, level - 1);
   double lots = NormalizeLotsNearest(requestedLot);
   if(requestedLot > MarketInfo(Symbol(), MODE_MAXLOT) + 0.0000001)
   {
      Print("Required lot exceeds broker maximum or lot step. Direction=", direction,
            " Level=", level, " Requested=", DoubleToString(requestedLot, 3));
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   double stopPrice = price - direction * BasketStopPriceDistance;
   double targetPrice = 0.0;
   if(level >= MaxOrdersPerSide)
      targetPrice = price + direction * FinalTakeProfitPriceDistance;

   double brokerMinimum = (MarketInfo(Symbol(), MODE_STOPLEVEL) + 1.0) * Point;
   if(BasketStopPriceDistance < brokerMinimum ||
      (level >= MaxOrdersPerSide && FinalTakeProfitPriceDistance < brokerMinimum))
   {
      Print("Configured price distance is below broker StopLevel.");
      g_nextRetryTime = TimeCurrent() + 5;
      return(-1);
   }

   int magic = SideMagic(direction);
   string side = (direction > 0 ? "BUY" : "SELL");
   string comment = "GOLD_AUTO15_" + side + "_L" + IntegerToString(level);
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
   double commonStop = NormalizeDouble(latestEntry - direction * BasketStopPriceDistance, Digits);
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
double ScaledStartLot()
{
   double scale = 1.0;
   if(AutoScaleStartLotByBalance)
   {
      double availableCapital = MathMin(AccountBalance(), AccountEquity());
      scale = MathFloor(availableCapital / ReferenceBalance + 0.0000001);
      if(scale < 1.0)
         scale = 1.0;
   }
   return(NormalizeLotsNearest(BaseStartLot * scale));
}

//+------------------------------------------------------------------+
double SideBaseLot(const int direction)
{
   datetime earliestTime = 0;
   int earliestTicket = -1;
   double baseLot = 0.0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES) || !IsSideOrder(direction))
         continue;
      if(earliestTime == 0 || OrderOpenTime() < earliestTime ||
         (OrderOpenTime() == earliestTime && OrderTicket() < earliestTicket))
      {
         earliestTime = OrderOpenTime();
         earliestTicket = OrderTicket();
         baseLot = OrderLots();
      }
   }
   return(baseLot);
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
double NormalizeLotsNearest(const double requested)
{
   double minimum = MarketInfo(Symbol(), MODE_MINLOT);
   double maximum = MarketInfo(Symbol(), MODE_MAXLOT);
   double step = MarketInfo(Symbol(), MODE_LOTSTEP);
   if(step <= 0.0)
      step = 0.01;
   double lots = MathFloor(requested / step + 0.500000001) * step;
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
   Comment("GOLD DUAL TREND PYRAMID - AUTOSCALE x1.5\n",
           "BUY magic: ", BuyMagicNumber, "  Level: ", buyCount, "/", MaxOrdersPerSide,
           "  Floating: ", DoubleToString(SideFloatingProfit(1), 2), "\n",
           "SELL magic: ", SellMagicNumber, "  Level: ", sellCount, "/", MaxOrdersPerSide,
           "  Floating: ", DoubleToString(SideFloatingProfit(-1), 2), "\n",
           "Next basket base lot: ", DoubleToString(ScaledStartLot(), 2),
           "  Reference: ", DoubleToString(ReferenceBalance, 0), "\n",
           "Step: ", DoubleToString(AddStepPriceDistance, 2),
           "  Basket stop: ", DoubleToString(BasketStopPriceDistance, 2),
           "  Final target: ", DoubleToString(FinalTakeProfitPriceDistance, 2));
}
//+------------------------------------------------------------------+
