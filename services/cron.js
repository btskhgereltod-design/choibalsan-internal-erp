"use strict";
const cron = require("node-cron");
const { dispatchMorning, dispatchSummary } = require("./daily-report");
const { saveHseMonthlySnapshot, saveHseAnnualSnapshot, isLastWorkingDayOfMonth } = require("./hse_snapshots");
const { dispatchCriticalAlerts } = require("./notifications");
const { reconcileIotLighting } = require("./iot_recovery");

function startCronJobs() {
  cron.schedule("* * * * *", async () => {
    try {
      const result = await reconcileIotLighting({ source: "cron" });
      if (result.attempted || result.failed) {
        console.log(`[cron] IoT recovery checked=${result.checked} attempted=${result.attempted} failed=${result.failed}`);
      }
    } catch (e) {
      console.error("[cron] IoT recovery error:", e.message);
    }
  }, { timezone: "Asia/Ulaanbaatar" });

  cron.schedule("0 8 * * *", async () => {
    console.log("[cron] 08:00 morning reminder");
    try { await dispatchMorning(); } catch (e) { console.error("[cron] morning error:", e.message); }
    try { await dispatchCriticalAlerts(); } catch (e) { console.error("[cron] alert error:", e.message); }
  }, { timezone: "Asia/Ulaanbaatar" });

  cron.schedule("0 12 * * *", async () => {
    console.log("[cron] 12:00 daily summary");
    try { await dispatchSummary("12:00"); }
    catch (e) { console.error("[cron] 12:00 error:", e.message); }
  }, { timezone: "Asia/Ulaanbaatar" });

  cron.schedule("0 16 * * *", async () => {
    console.log("[cron] 16:00 daily summary");
    try { await dispatchSummary("16:00"); }
    catch (e) { console.error("[cron] 16:00 error:", e.message); }
  }, { timezone: "Asia/Ulaanbaatar" });

  cron.schedule("0 17 * * 1-5", async () => {
    const now = new Date();
    if (!isLastWorkingDayOfMonth(now)) return;
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    console.log(`[cron] HSE monthly snapshot: ${year}-${String(month).padStart(2, "0")}`);
    try {
      await saveHseMonthlySnapshot(year, month, "auto", 0);
      if (month === 12) await saveHseAnnualSnapshot(year, "auto", 0);
    } catch (e) {
      console.error("[cron] HSE snapshot error:", e.message);
    }
  }, { timezone: "Asia/Ulaanbaatar" });

  console.log("[cron] Triggers active: IoT recovery every minute; 08:00, 12:00, 16:00, 17:00 HSE monthly snapshot (Asia/Ulaanbaatar)");
}

module.exports = { startCronJobs };
