import { api, table, toast, state, hydrateGlobals } from "./common.js";

export async function materials() {
  const rows = await api("/api/materials");

  main.innerHTML = `
  <h1>Материал</h1>

  <div class="panel">
    <h2>Материал нэмэх</h2>

    <div class="row3">
      <input class="input" id="mname" placeholder="Материалын нэр">
      <input class="input" id="munit" placeholder="Хэмжих нэгж">
      <input class="input" id="mbalance" type="number" value="0" placeholder="Үлдэгдэл">
    </div>

    <div class="row3">
      <input class="input" id="mwarn" type="number" value="10" placeholder="Анхааруулах үлдэгдэл">
      <input class="input" id="mprice" type="number" value="0" placeholder="Нэгж үнэ">
      <input class="input" id="mnote" placeholder="Тайлбар">
    </div>

    <button class="btn" onclick="saveMaterial()">Хадгалах</button>
  </div>

  <div class="panel">
    <h2>Материалын бүртгэл</h2>

    ${table(
      ["Нэр","Үлдэгдэл","Нэгж","Анхааруулга","Үнэ","Төлөв"],
      rows.map(r => [
        r.item_name,
        r.balance,
        r.unit,
        r.warning_level,
        Number(r.price || 0).toLocaleString() + "₮",
        Number(r.balance) <= Number(r.warning_level)
          ? `<span class="pill bad">Бага үлдэгдэл</span>`
          : `<span class="pill ok">Хэвийн</span>`
      ])
    )}
  </div>`;

  hydrateGlobals();
}

export async function saveMaterial() {
  await api("/api/materials", {
    method: "POST",
    body: JSON.stringify({
      item_name: mname.value,
      unit: munit.value,
      balance: Number(mbalance.value || 0),
      warning_level: Number(mwarn.value || 0),
      price: Number(mprice.value || 0),
      note: mnote.value
    })
  });

  toast("Материал хадгаллаа");
  materials();
}
