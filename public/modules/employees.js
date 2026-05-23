import { api, table, toast, state, hydrateGlobals } from "./common.js";

export async function hr() {
  const rows = await api("/api/users");

  main.innerHTML = `
  <h1>Хүний нөөц / Ажилчдын бүртгэл</h1>

  <div class="panel">
    <h2>Шинэ ажилтан нэмэх</h2>

    <div class="row3">
      <input class="input" id="efull" placeholder="Овог нэр">

      <div>
      <div class="small muted">Албан тушаал</div>

      <select class="input" id="epos">

        <option>Сонгох</option>
        <option>Захирал</option>
        <option>Ерөнхий инженер</option>
        <option>Хүний нөөцийн ажилтан</option>
        <option>ХАБЭА-н ажилтан</option>
        <option>Нягтлан бодогч</option>
        <option>Сүлжээний инженер</option>
        <option>Цахилгааны инженер</option>
        <option>Нярав</option>
        <option>Сүлжээний техникч</option>
        <option>Гагнуурчин</option>
        <option>Цахилгаанчин</option>
        <option>Кранист</option>
        <option>Туслах ажилчин</option>
        <option>Сахиул</option>
      </select>

      <div>
       <div class="small muted">Тасаг</div>

         <select class="input" id="edept">

    <option value="">Сонгох</option>
    <option>Захиргаа Аж Ахуй</option>
    <option>Камер</option>
    <option>Гэрэлтүүлэг</option>
        
  </select>
</div>
    </div>

    <div class="row3">
      <input class="input" id="ereg" placeholder="Регистрийн дугаар">
      <input class="input" id="ephone" placeholder="Утас">
      <input class="input" id="eaddr" placeholder="Гэрийн хаяг">
    </div>

   <div class="row3">
     <div>
       <div class="small muted">Системийн эрх</div>

     <select class="input" id="erole">

      <option value="choice">Сонгох</option>
      <option value="director">Захирал</option>
      <option value="hr">Хүний нөөц</option>
      <option value="chief_engineer">Ерөнхий инженер</option>
      <option value="engineer">Цахилгааны инженер</option>
      <option value="accountant">Нягтлан</option>
      <option value="safety">ХАБЭА</option>
      <option value="storekeeper">Нярав</option>      
      <option value="Worker">Ажилтан</option>
    </select>
  </div>
</div>

    <button class="btn" onclick="saveEmployee()">Ажилтан нэмэх</button>
  </div>

  <div class="panel">
    <h2>Ажилчдын жагсаалт</h2>

    ${table(
      ["№","Овог нэр","Албан тушаал","Тасаг","Утас","Role","Үйлдэл"],
      rows.map((r,i) => [
        i + 1,
        r.full_name,
        r.position || "",
        r.department || "",
        r.phone || "",
        r.role,
        `<button class="btn danger" onclick="deleteEmployee(${r.id})">Устгах</button>`
      ])
    )}
  </div>`;

  hydrateGlobals();
}

export async function saveEmployee() {
  if (!efull.value.trim()) {
    alert("Овог нэр оруулна уу");
    return;
  }

  await api("/api/users", {
    method: "POST",
    body: JSON.stringify({
      full_name: efull.value,
      position: epos.value,
      department: edept.value,
      register_no: ereg.value,
      phone: ephone.value,
      address: eaddr.value,
      role: erole.value
    })
  });

  state.users = await api("/api/users");
  toast("Ажилтан нэмэгдлээ");
  hr();
}

export async function deleteEmployee(id) {
  if (!confirm("Энэ ажилтныг устгах уу?")) return;

  await api(`/api/users/${id}`, {
    method: "DELETE"
  });

  state.users = await api("/api/users");
  toast("Ажилтан устгагдлаа");
  hr();
}

export async function deactivateEmployee(id) {
  return deleteEmployee(id);
}
