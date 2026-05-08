import { api, today, table, state } from "./common.js";

export async function dashboard() {
  const s = await api(`/api/reports/summary?year=${new Date().getFullYear()}`);

  const totalWork = s.work.count || 0;
  const workCost = Math.round(s.work.total_cost || 0);
  const financeCost = Math.round(s.expenses.total || 0);
  const avgProgress = Math.round(s.work.avg_progress || 0);
  const materialWarnings = (s.materials || []).filter(x => Number(x.balance) <= 10);

  main.innerHTML = `
  <div class="hero">
    <div>
      <h1>SMART CITY OPERATIONS CENTER</h1>
      <p class="muted">Чойбалсан хөгжил ОНӨҮГ — дотоод ажил, тайлан, төлөвлөгөөний ERP систем</p>
    </div>
    <div class="hero-right">
      <div class="hero-badge">LAN ONLINE</div>
      <div id="liveClock"></div>
      <div class="weather">Choibalsan • ERP ONLINE</div>
    </div>
  </div>

  <div class="grid">
    <div class="stat"><span class="muted">Нийт ажил</span><b>${totalWork}</b><p class="small muted">2026 оны бүртгэл</p></div>
    <div class="stat"><span class="muted">Ажлын зардал</span><b>${workCost.toLocaleString()}₮</b><p class="small muted">Ажилтай холбогдсон өртөг</p></div>
    <div class="stat"><span class="muted">Санхүүгийн зардал</span><b>${financeCost.toLocaleString()}₮</b><p class="small muted">Нягтлангийн бүртгэл</p></div>
    <div class="stat"><span class="muted">Дундаж явц</span><b>${avgProgress}%</b><p class="small muted">Гүйцэтгэлийн хувь</p></div>
  </div>

  <div class="smartGrid">
    <div class="panel">
      <h2>Smart City Status</h2>
      <div class="statusLine"><span>💡 Гэрэлтүүлэг</span><b class="okText">4332 бүртгэлтэй</b></div>
      <div class="statusLine"><span>🎥 Камер</span><b class="okText">191 камер</b></div>
      <div class="statusLine"><span>🚦 Гэрлэн дохио</span><b class="warnText">12 байршил</b></div>
      <div class="statusLine"><span>🌐 Backend</span><b class="okText">ONLINE</b></div>
    </div>

    <div class="panel">
      <h2>Warning Center</h2>
      ${
        materialWarnings.length
        ? materialWarnings.map(x => `<div class="alertItem">⚠ ${x.item_name} үлдэгдэл бага: <b>${x.balance}</b></div>`).join("")
        : `<div class="alertItem good">✅ Одоогоор материалын ноцтой анхааруулга алга</div>`
      }
      <div class="alertItem">📌 Хугацаа хэтэрсэн task logic дараагийн хувилбарт орно</div>
    </div>
  </div>

  <div class="panel">
    <h2>Ажлын төрөл</h2>
    ${table(["Төрөл","Тоо","Зардал"], s.byCategory.map(x => [
      x.category,
      x.count,
      Math.round(x.cost || 0).toLocaleString() + "₮"
    ]))}
  </div>

  <div class="panel">
    <h2>Материалын үлдэгдлийн зураглал</h2>
    ${table(["Материал","Үлдэгдэл"], s.materials.map(x => [
      x.item_name,
      Number(x.balance).toLocaleString()
    ]))}
  </div>`;

  updateClock();
  state.clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const el = document.getElementById("liveClock");
  if (el) el.innerText = new Date().toLocaleString("mn-MN");
}
