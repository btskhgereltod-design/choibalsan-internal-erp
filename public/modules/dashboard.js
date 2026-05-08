import { api, today, table, state } from "./common.js";

export async function dashboard() {
  const s = await api(`/api/reports/summary?year=${new Date().getFullYear()}`);
  const totalWork     = s.work.count || 0;
  const workCost      = Math.round(s.work.total_cost || 0);
  const financeCost   = Math.round(s.expenses.total || 0);
  const avgProgress   = Math.round(s.work.avg_progress || 0);
  const matWarnings   = (s.materials || []).filter(x => Number(x.balance) <= Number(x.warning_level || 10));

  // ── Today attendance ──
  const todayStr = today();
  let todayAtt = { worked:0, absent:0, leave:0, sick:0, vacation:0, late:0, overtime:0 };
  let hrRows = [];
  try {
    hrRows = await api("/api/hr-records");
    const validIds = new Set(state.users.map(u => u.id));
    const latest = {};
    hrRows.forEach(r => {
      if (!r.start_date || !validIds.has(r.user_id)) return;
      const s = r.start_date.slice(0,10);
      const e = (r.end_date || r.start_date).slice(0,10);
      if (todayStr < s || todayStr > e) return;
      if (!latest[r.user_id] || r.id > latest[r.user_id].id) latest[r.user_id] = r;
    });
    Object.values(latest).forEach(r => {
      if (r.record_type === "Ажилласан")       todayAtt.worked++;
      if (r.record_type === "Ажил тасалсан")   todayAtt.absent++;
      if (r.record_type === "Чөлөө")           todayAtt.leave++;
      if (r.record_type === "Өвчтэй")          todayAtt.sick++;
      if (r.record_type === "Ээлжийн амралт")  todayAtt.vacation++;
      if (r.record_type === "Хоцорсон")        todayAtt.late++;
      if (r.record_type === "Илүү цаг")        todayAtt.overtime++;
    });
  } catch(e) {}

  const totalEmp    = state.users.length;
  const notRecorded = totalEmp - Object.values(todayAtt).reduce((a,b)=>a+b,0);
  const attPct      = totalEmp ? Math.round(todayAtt.worked / totalEmp * 100) : 0;

  // ── This month attendance trend (last 7 days) ──
  const year  = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  main.innerHTML = `
  <!-- ═══ HERO ═══ -->
  <div class="hero">
    <div style="display:flex;align-items:center;gap:16px;position:relative;z-index:1">
      <img src="logo.jpg" class="heroLogo" onerror="this.style.display='none'">
      <div class="hero-text">
        <h1>Чойбалсан хөгжил ОНӨҮГ</h1>
        <p class="sub">Дотоод ажил · Тайлан · Төлөвлөгөөний ERP систем</p>
      </div>
    </div>
    <div class="hero-right">
      <div class="hero-badge">LAN ONLINE</div>
      <div id="liveClock"></div>
      <div class="weather">Чойбалсан хот · ERP ONLINE</div>
    </div>
  </div>

  <!-- ═══ STATS ROW ═══ -->
  <div class="stats-grid" style="grid-template-columns:repeat(6,1fr);margin-bottom:20px">
    <div class="stat-card blue">
      <div class="stat-top">
        <span class="stat-label">Нийт ажилтан</span>
        <div class="stat-icon">👥</div>
      </div>
      <div class="stat-value">${totalEmp}</div>
      <div class="stat-sub">Бүртгэлтэй ажилтан</div>
    </div>
    <div class="stat-card green">
      <div class="stat-top">
        <span class="stat-label">Өнөөдөр ирсэн</span>
        <div class="stat-icon">✅</div>
      </div>
      <div class="stat-value">${todayAtt.worked}</div>
      <div class="stat-sub">${attPct}% ирэлт</div>
    </div>
    <div class="stat-card red">
      <div class="stat-top">
        <span class="stat-label">Ирээгүй</span>
        <div class="stat-icon">❌</div>
      </div>
      <div class="stat-value">${todayAtt.absent}</div>
      <div class="stat-sub">Тасалсан ажилтан</div>
    </div>
    <div class="stat-card amber">
      <div class="stat-top">
        <span class="stat-label">Нийт ажил</span>
        <div class="stat-icon">🛠</div>
      </div>
      <div class="stat-value">${totalWork}</div>
      <div class="stat-sub">${new Date().getFullYear()} оны бүртгэл</div>
    </div>
    <div class="stat-card purple">
      <div class="stat-top">
        <span class="stat-label">Ажлын дундаж явц</span>
        <div class="stat-icon">📈</div>
      </div>
      <div class="stat-value">${avgProgress}%</div>
      <div class="stat-sub">
        <div class="progress-bar" style="margin-top:4px">
          <div class="progress-fill ${avgProgress>=70?'green':avgProgress>=40?'amber':'red'}"
               style="width:${avgProgress}%"></div>
        </div>
      </div>
    </div>
    <div class="stat-card ${matWarnings.length?'red':'green'}">
      <div class="stat-top">
        <span class="stat-label">Материал анхааруулга</span>
        <div class="stat-icon">${matWarnings.length?'⚠️':'📦'}</div>
      </div>
      <div class="stat-value">${matWarnings.length}</div>
      <div class="stat-sub">${matWarnings.length?'Бага үлдэгдэлтэй':'Хэвийн байдалтай'}</div>
    </div>
  </div>

  <!-- ═══ MAIN CONTENT GRID ═══ -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px">

    <!-- Өнөөдрийн ирэвсэл -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>⏱ Өнөөдрийн ирэвсэл</h3>
          <div class="subtitle">${todayStr}</div>
        </div>
        <button class="btn sm secondary" onclick="show('attendance')">Бүртгэх →</button>
      </div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          ${[
            ['✅','Ажилласан', todayAtt.worked,   'green'],
            ['❌','Тасалсан',  todayAtt.absent,   'red'],
            ['🟡','Чөлөөтэй', todayAtt.leave,    'amber'],
            ['🔵','Өвчтэй',   todayAtt.sick,     'blue'],
            ['⚫','Амралт',   todayAtt.vacation,  ''],
            ['🟠','Илүү цаг', todayAtt.overtime,  ''],
          ].map(([ic,lb,vl,cl])=>`
            <div style="display:flex;align-items:center;gap:8px;padding:8px;background:var(--bg);border-radius:8px">
              <span style="font-size:16px">${ic}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:11px;color:var(--ink3)">${lb}</div>
                <div style="font-size:18px;font-weight:800;color:var(--ink)">${vl}</div>
              </div>
            </div>`).join('')}
        </div>
        <!-- Attendance progress -->
        <div class="progress-wrap">
          <div class="progress-label">
            <span>Ирэлтийн хувь</span>
            <span style="font-weight:700">${attPct}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${attPct>=80?'green':attPct>=60?'amber':'red'}"
                 style="width:${attPct}%"></div>
          </div>
        </div>
        ${notRecorded>0?`<div class="alertItem warn" style="margin-top:10px;padding:8px 10px;font-size:12px">
          ⚠ ${notRecorded} ажилтны ирэвсэл бүртгэгдээгүй байна</div>`:''}
      </div>
    </div>

    <!-- Smart City Status -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>🏙 Smart City статус</h3>
          <div class="subtitle">Онлайн мэдээлэл</div>
        </div>
        <span class="pill ok" style="font-size:10px">ONLINE</span>
      </div>
      <div class="panel-body" style="padding-top:12px">
        ${[
          ['💡','Гэрэлтүүлэг','4,332 бүртгэлтэй','ok'],
          ['🎥','Камер','191 камер','ok'],
          ['🚦','Гэрлэн дохио','12 байршил','warn'],
          ['🌐','Backend','ONLINE','ok'],
          ['📡','LoRaWAN','ChirpStack онлайн','ok'],
          ['⚡','Эрчим хүч','Хэвийн','ok'],
        ].map(([ic,lb,vl,st])=>`
          <div class="status-row">
            <span class="status-name"><span class="status-icon">${ic}</span>${lb}</span>
            <b class="${st==='ok'?'okText':'warnText'}">${vl}</b>
          </div>`).join('')}
      </div>
    </div>

    <!-- Warning Center -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>⚠️ Warning Center</h3>
          <div class="subtitle">Анхааруулга, мэдэгдэл</div>
        </div>
        ${matWarnings.length?`<span class="pill bad">${matWarnings.length} анхааруулга</span>`:`<span class="pill ok">Хэвийн</span>`}
      </div>
      <div class="panel-body" style="padding-top:12px">
        ${matWarnings.length
          ? matWarnings.map(x=>`
            <div class="alertItem bad" style="padding:9px 12px;font-size:12px">
              <span>⚠️</span>
              <div><b>${x.item_name}</b> — үлдэгдэл бага: <b>${x.balance}</b></div>
            </div>`).join('')
          : `<div class="alertItem good" style="padding:9px 12px;font-size:12px">
              <span>✅</span><span>Материалын ноцтой анхааруулга байхгүй</span></div>`
        }
        ${todayAtt.absent>0?`
          <div class="alertItem warn" style="padding:9px 12px;font-size:12px;margin-top:6px">
            <span>👤</span><span>Өнөөдөр <b>${todayAtt.absent}</b> ажилтан ирээгүй байна</span>
          </div>`:''}
        <div class="alertItem" style="padding:9px 12px;font-size:12px;margin-top:6px">
          <span>📌</span><span>Хугацаа хэтэрсэн task дараагийн хувилбарт орно</span>
        </div>
      </div>
    </div>

  </div>

  <!-- ═══ SECOND ROW ═══ -->
  <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:16px">

    <!-- Ажлын явц + зардал -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>📊 Санхүү & Ажлын дүн</h3>
          <div class="subtitle">${new Date().getFullYear()} оны нийт</div>
        </div>
        <button class="btn sm secondary" onclick="show('reports')">Дэлгэрэнгүй →</button>
      </div>
      <div class="panel-body">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="background:var(--blue4);border-radius:10px;padding:14px;border:1px solid #bfdbfe">
            <div style="font-size:11px;color:var(--blue);margin-bottom:4px;font-weight:600">АЖЛЫН ЗАРДАЛ</div>
            <div style="font-size:22px;font-weight:800;color:var(--blue)">${workCost.toLocaleString()}₮</div>
          </div>
          <div style="background:var(--red2);border-radius:10px;padding:14px;border:1px solid #fecaca">
            <div style="font-size:11px;color:var(--red);margin-bottom:4px;font-weight:600">САНХҮҮГИЙН ЗАРДАЛ</div>
            <div style="font-size:22px;font-weight:800;color:var(--red)">${financeCost.toLocaleString()}₮</div>
          </div>
          <div style="background:var(--green4);border-radius:10px;padding:14px;border:1px solid #bbf7d0">
            <div style="font-size:11px;color:var(--green);margin-bottom:4px;font-weight:600">НИЙТ АЖИЛ</div>
            <div style="font-size:22px;font-weight:800;color:var(--green)">${totalWork}</div>
          </div>
        </div>
        <!-- Category breakdown -->
        <div style="font-size:12px;font-weight:700;color:var(--ink3);margin-bottom:8px;letter-spacing:.08em;text-transform:uppercase">Ажлын төрлөөр</div>
        ${s.byCategory.slice(0,5).map(x => {
          const maxCost = Math.max(...s.byCategory.map(c=>Number(c.cost||0)),1);
          const pct = Math.round(Number(x.cost||0)/maxCost*100);
          return `<div class="progress-wrap" style="margin-bottom:10px">
            <div class="progress-label">
              <span>${x.category||'Бусад'} <span style="color:var(--ink3)">(${x.count})</span></span>
              <span style="font-weight:700">${Math.round(x.cost||0).toLocaleString()}₮</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
          </div>`;
        }).join('') || '<div class="muted small">Өгөгдөл алга</div>'}
      </div>
    </div>

    <!-- Quick actions -->
    <div class="panel">
      <div class="panel-head">
        <h3>⚡ Хурдан үйлдэл</h3>
      </div>
      <div class="panel-body">
        <div class="quick-actions" style="grid-template-columns:1fr 1fr">
          ${[
            ['⏱','Ирэвсэл бүртгэх','attendance'],
            ['🛠','Ажил нэмэх','work'],
            ['📦','Материал','materials'],
            ['💰','Зардал','expenses'],
            ['👥','Хүний нөөц','hr'],
            ['📑','Тайлан','reports'],
          ].map(([ic,lb,pg])=>`
            <div class="qa-btn" onclick="show('${pg}')">
              <span class="qa-icon">${ic}</span>
              <span>${lb}</span>
            </div>`).join('')}
        </div>

        <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
          <div style="font-size:11px;font-weight:700;color:var(--ink3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:10px">Материалын дүн</div>
          ${s.materials.slice(0,4).map(x=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:0.5px solid var(--border);font-size:12px">
              <span>${x.item_name}</span>
              <span class="pill ${Number(x.balance)<=Number(x.warning_level||10)?'bad':'ok'}" style="padding:2px 7px;font-size:10px">
                ${Number(x.balance).toLocaleString()}
              </span>
            </div>`).join('') || '<div class="muted small">Өгөгдөл алга</div>'}
        </div>
      </div>
    </div>

  </div>

  <!-- ═══ BOTTOM ROW ═══ -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

    <!-- Recent work -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>🛠 Сүүлийн ажлууд</h3>
          <div class="subtitle">5 сүүлийн бүртгэл</div>
        </div>
        <button class="btn sm secondary" onclick="show('work')">Бүгдийг харах →</button>
      </div>
      <div class="table-wrap">
        ${table(
          ["Огноо","Ажил","Байршил","Төлөв"],
          (s.recentWork||s.byCategory.slice(0,5)).slice(0,5).map(r=>[
            r.work_date||'—',
            r.title||r.category||'—',
            r.location||'—',
            r.status
              ? `<span class="pill ${r.status==='Дууссан'?'ok':r.status==='Явагдаж байна'?'info':'warn'}">${r.status}</span>`
              : '—'
          ])
        )}
      </div>
    </div>

    <!-- Ажилчдын жагсаалт товч -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>👥 Ажилчдын жагсаалт</h3>
          <div class="subtitle">Нийт ${totalEmp} ажилтан</div>
        </div>
        <button class="btn sm secondary" onclick="show('hr')">Бүгдийг харах →</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Нэр</th><th>Албан тушаал</th><th>Тасаг</th></tr></thead>
          <tbody>
            ${state.users.slice(0,8).map(u=>`
              <tr>
                <td style="font-weight:600">${u.full_name}</td>
                <td>${u.position||'—'}</td>
                <td><span class="pill info" style="font-size:10px">${u.department||'—'}</span></td>
              </tr>`).join('')}
            ${state.users.length>8?`
              <tr><td colspan="3" style="text-align:center;color:var(--ink3);font-size:12px;padding:10px">
                + ${state.users.length-8} ажилтан бий
              </td></tr>`:''}
          </tbody>
        </table>
      </div>
    </div>

  </div>`;

  // Clock update
  if (state.clockTimer) clearInterval(state.clockTimer);
  updateClock();
  state.clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const el = document.getElementById("liveClock");
  if (el) el.innerText = new Date().toLocaleString("mn-MN", {
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}
