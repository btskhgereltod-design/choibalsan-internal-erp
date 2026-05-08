import { api, today, table, userOptions, toast, state, hydrateGlobals, codeClass, escapeHtml } from "./common.js";

export async function attendance() {
  const rows = await api("/api/hr-records");
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const days = new Date(year, month, 0).getDate();

  const byUser = {};
  state.users.forEach(u => {
    byUser[u.id] = {
      user: u,
      days: {},
      summary: { worked:0, absent:0, leave:0, sick:0, vacation:0, overtime:0 }
    };
  });

  rows.forEach(r => {
    const d = new Date(r.start_date);
    if (d.getFullYear() !== year || d.getMonth() + 1 !== month) return;

    const day = d.getDate();
    if (!byUser[r.user_id]) return;

    let code = "А";
    if (r.record_type === "Ажил тасалсан") code = "Т";
    if (r.record_type === "Чөлөө") code = "Ч";
    if (r.record_type === "Өвчтэй") code = "Ө";
    if (r.record_type === "Ээлжийн амралт") code = "Э";
    if (r.record_type === "Хоцорсон") code = "Х";
    if (r.record_type === "Илүү цаг") code = "ИЦ";

    byUser[r.user_id].days[day] = code;

    if (code === "А") byUser[r.user_id].summary.worked++;
    if (code === "Т") byUser[r.user_id].summary.absent++;
    if (code === "Ч") byUser[r.user_id].summary.leave++;
    if (code === "Ө") byUser[r.user_id].summary.sick++;
    if (code === "Э") byUser[r.user_id].summary.vacation++;
    if (code === "ИЦ") byUser[r.user_id].summary.overtime++;
  });

  main.innerHTML = `
  <h1>Ирц / цагийн бүртгэл</h1>

  <div class="panel">
    <h2>Өнөөдрийн ирц бүртгэх</h2>

    <div class="row3">
      <select class="input" id="auser">${userOptions()}</select>

      <select class="input" id="atype" onchange="onAttendanceTypeChange()">
        <option>Ажилласан</option>
        <option>Ажил тасалсан</option>
        <option>Чөлөө</option>
        <option>Өвчтэй</option>
        <option>Ээлжийн амралт</option>
        <option>Хоцорсон</option>
        <option>Илүү цаг</option>
      </select>

      <input class="input" id="adate" type="date" value="${today()}" max="${today()}">
    </div>

    <div id="attendanceDynamicFields"></div>

    <input class="input" id="anote" placeholder="Тайлбар">
    <button class="btn" onclick="saveAttendance()">Хадгалах</button>
    <button class="btn secondary" onclick="markAllWorked()">Өнөөдөр бүгдийг ажилласан болгох</button>

    <p class="muted small">Өмнөх өдрийн бүртгэл өөрчлөхийг дараагийн хувилбарт зөвхөн Захирал/ХН эрхтэй болгоно.</p>
  </div>

  <div class="panel">
    <h2>${year} оны ${month}-р сарын ирцийн матриц</h2>

    <div class="legend">
      <span class="dayCode worked">А</span> Ажилласан
      <span class="dayCode absent">Т</span> Тасалсан
      <span class="dayCode leave">Ч</span> Чөлөө
      <span class="dayCode sick">Ө</span> Өвчтэй
      <span class="dayCode vacation">Э</span> Амралт
      <span class="dayCode late">Х</span> Хоцорсон
      <span class="dayCode overtime">ИЦ</span> Илүү цаг
    </div>

    <div class="attendanceWrap">
      <table class="attendanceTable">
        <thead>
          <tr>
            <th class="stickyName">Ажилтан</th>
            ${Array.from({length:days},(_,i)=>`<th>${i+1}</th>`).join("")}
            <th>А</th>
            <th>Т</th>
            <th>Ч</th>
            <th>Ө</th>
            <th>Э</th>
            <th>ИЦ</th>
          </tr>
        </thead>
        <tbody>
          ${Object.values(byUser).map(x => `
            <tr>
              <td class="stickyName">
                <b>${x.user.full_name}</b>
                <div class="small muted">${x.user.position || ""}</div>
              </td>
              ${Array.from({length:days},(_,i)=>{
                const code = x.days[i+1] || "";
                return `<td>${code ? `<span class="dayCode ${codeClass(code)}">${code}</span>` : ""}</td>`;
              }).join("")}
              <td>${x.summary.worked}</td>
              <td>${x.summary.absent}</td>
              <td>${x.summary.leave}</td>
              <td>${x.summary.sick}</td>
              <td>${x.summary.vacation}</td>
              <td>${x.summary.overtime}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  </div>`;

  onAttendanceTypeChange();
  hydrateGlobals();
}

export function onAttendanceTypeChange() {
  const type = atype.value;
  const box = document.getElementById("attendanceDynamicFields");

  if (type === "Ажилласан" || type === "Хоцорсон" || type === "Илүү цаг") {
    box.innerHTML = `
      <div class="row3">
        <input class="input" id="amorningIn" type="time" value="08:30">
        <input class="input" id="alunchOut" type="time" value="12:30">
        <input class="input" id="aafternoonIn" type="time" value="13:30">
      </div>
      <div class="row">
        <input class="input" id="aeveningOut" type="time" value="17:30">
        <input class="input" id="aovertime" type="number" value="0" placeholder="Илүү цаг">
      </div>
    `;
  } else {
    box.innerHTML = `
      <div class="row">
        <input class="input" id="astartDate" type="date" value="${today()}">
        <input class="input" id="aendDate" type="date" value="${today()}">
      </div>
    `;
  }
  hydrateGlobals();
}

export async function saveAttendance() {
  const type = atype.value;
  let noteText = anote.value || "";
  let startDate = adate.value;
  let endDate = adate.value;

  if (type === "Ажилласан" || type === "Хоцорсон" || type === "Илүү цаг") {
    const mi = amorningIn.value;
    const lo = alunchOut.value;
    const ai = aafternoonIn.value;
    const eo = aeveningOut.value;
    const ot = aovertime.value || 0;

    noteText =
      `Өглөө ирсэн: ${mi}, Үдэд гарсан: ${lo}, Үдээс хойш ирсэн: ${ai}, Тарсан: ${eo}, Илүү цаг: ${ot}` +
      (noteText ? " | " + noteText : "");
  } else {
    startDate = astartDate.value;
    endDate = aendDate.value;
  }

  await api("/api/hr-records", {
    method: "POST",
    body: JSON.stringify({
      user_id: auser.value,
      record_type: type,
      start_date: startDate,
      end_date: endDate,
      note: noteText
    })
  });

  toast("Ирц хадгаллаа");
  attendance();
}

export async function markAllWorked() {
  if (!confirm("Өнөөдөр бүх ажилтныг ажилласан гэж бүртгэх үү?")) return;

  for (const u of state.users) {
    await api("/api/hr-records", {
      method: "POST",
      body: JSON.stringify({
        user_id: u.id,
        record_type: "Ажилласан",
        start_date: today(),
        end_date: today(),
        note: "Өглөө ирсэн: 08:30, Үдэд гарсан: 12:30, Үдээс хойш ирсэн: 13:30, Тарсан: 17:30"
      })
    });
  }

  toast("Бүх ажилтан ажилласнаар бүртгэгдлээ");
  attendance();
}
