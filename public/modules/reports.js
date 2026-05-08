import { api, table } from "./common.js";

export async function reports() {
  const work = await api("/api/work-logs");
  const expenses = await api("/api/expenses");
  const materials = await api("/api/materials");
  const attendanceRows = await api("/api/hr-records");

  const totalExpense =
    expenses.reduce((a,b)=>a + Number(b.amount || 0),0);

  const totalWorkCost =
    work.reduce((a,b)=>a + Number(b.cost || 0),0);

  const totalAttendance =
    attendanceRows.filter(x =>
      x.record_type === "Ажилласан"
    ).length;

  main.innerHTML = `
  <h1>Тайлан</h1>

  <div class="grid">
    <div class="stat">
      <span class="muted">Нийт ажил</span>
      <b>${work.length}</b>
    </div>

    <div class="stat">
      <span class="muted">Зардал</span>
      <b>${totalExpense.toLocaleString()}₮</b>
    </div>

    <div class="stat">
      <span class="muted">Ажлын өртөг</span>
      <b>${totalWorkCost.toLocaleString()}₮</b>
    </div>

    <div class="stat">
      <span class="muted">Ирц</span>
      <b>${totalAttendance}</b>
    </div>
  </div>

  <div class="panel">
    <h2>Сүүлийн ажлууд</h2>

    ${table(
      ["Огноо","Ажил","Байршил","Төлөв"],
      work.slice(0,10).map(r => [
        r.work_date,
        r.title,
        r.location,
        r.status
      ])
    )}
  </div>

  <div class="panel">
    <h2>Материалын төлөв</h2>

    ${table(
      ["Материал","Үлдэгдэл","Төлөв"],
      materials.map(r => [
        r.item_name,
        r.balance,
        Number(r.balance) <= Number(r.warning_level)
          ? `<span class="pill bad">Анхаар!</span>`
          : `<span class="pill ok">Хэвийн</span>`
      ])
    )}
  </div>

  <div class="panel">
    <h2>Тайлан хэвлэх</h2>

    <button class="btn" onclick="window.print()">
      PDF / Хэвлэх
    </button>
  </div>`;
}
