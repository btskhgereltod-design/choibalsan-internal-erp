const express = require("express");
const bcrypt  = require("bcryptjs");
const crypto  = require("crypto");
const fs   = require("fs");
const path = require("path");
const { run, all, get, auth, audit, upload, UPLOAD_DIR } = require("../db");
const { requireRole, requirePermission, canAccessOwn } = require("../middleware/roles");

const router = express.Router();

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

// ── Auth-related profile ─────────────────────────────────────

router.get("/me", auth, async (req, res) => {
  const user = await get(
    "SELECT id,username,full_name,role,position,department,email,avatar_url FROM users WHERE id=?",
    [req.user.id]);
  res.json(user);
});

router.post("/me/avatar", auth, upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Зураг сонгоно уу" });
  if (!String(req.file.mimetype || "").startsWith("image/")) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(400).json({ error: "Зөвхөн зураг файл оруулна уу" });
  }

  const current = await get("SELECT avatar_url FROM users WHERE id=?", [req.user.id]);
  const avatarUrl = `/uploads/${req.file.filename}`;
  await run("UPDATE users SET avatar_url=? WHERE id=?", [avatarUrl, req.user.id]);

  const oldUrl = current?.avatar_url || "";
  if (oldUrl.startsWith("/uploads/") && oldUrl !== avatarUrl) {
    const oldPath = path.resolve(UPLOAD_DIR, path.basename(oldUrl));
    if (oldPath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
      try { fs.unlinkSync(oldPath); } catch {}
    }
  }
  await audit(req.user.id, "UPDATE_AVATAR", "users", req.user.id, avatarUrl);
  res.json({ avatar_url: avatarUrl });
});

router.get("/my-salary", auth, async (req, res) => {
  const u = await get(
    `SELECT salary, skill_allowance_rate, skill_allowance,
            tenure_years, tenure_allowance_rate, tenure_allowance
     FROM users WHERE id=? AND active=1`,
    [req.user.id]);
  res.json(u || null);
});

// ── Users ────────────────────────────────────────────────────

router.get("/users", auth, async (_, res) => {
  res.json(await all(
    "SELECT id,username,full_name,role,position,department,phone,email,register_no,address,avatar_url,active,can_login,permissions FROM users WHERE active=1 AND role<>'ai_readonly' ORDER BY id"));
});

// Full user list for HR module (salary masked for non-hr/director)
router.get("/users-full", auth, async (req, res) => {
  const canSeeSalary = ["director","hr"].includes(req.user.role);
  const rows = await all(
    `SELECT id,username,full_name,role,position,department,phone,email,
            register_no,address,hire_date,contract_type,contract_end,
            status_hr,job_category,education,gender,work_condition,birthdate,nationality,
            emergency_contact,active,can_login,created_at,contract_scan_url,
            haot_exempt,
            ${canSeeSalary ? "salary,skill_allowance_rate,skill_allowance,tenure_years,tenure_allowance_rate,tenure_allowance,meal_allowance" : "NULL AS salary,NULL AS skill_allowance_rate,NULL AS skill_allowance,NULL AS tenure_years,NULL AS tenure_allowance_rate,NULL AS tenure_allowance,NULL AS meal_allowance"}
     FROM users WHERE active=1 AND role<>'ai_readonly' ORDER BY full_name`);
  res.json(rows);
});

router.put("/users/:id/hr", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;

  if (!b.full_name || !b.full_name.trim())
    return res.status(400).json({ error: "Овог нэр шаардлагатай" });

  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))
    return res.status(400).json({ error: "Имэйл хаяг буруу форматтай байна" });

  const salary = Number(b.salary);
  if (b.salary !== undefined && (isNaN(salary) || salary < 0))
    return res.status(400).json({ error: "Цалингийн дүн 0-ээс их байх ёстой" });
  const skillAllowance = Number(b.skill_allowance);
  if (b.skill_allowance !== undefined && (isNaN(skillAllowance) || skillAllowance < 0))
    return res.status(400).json({ error: "Ур чадварын нэмэгдэл 0-ээс их байх ёстой" });
  const skillAllowanceRate = Math.floor(Number(b.skill_allowance_rate));
  if (b.skill_allowance_rate !== undefined && (isNaN(skillAllowanceRate) || skillAllowanceRate < 0 || skillAllowanceRate > 25))
    return res.status(400).json({ error: "Ур чадварын нэмэгдлийн хувь 0-25 хооронд байх ёстой" });
  const tenureAllowance = Number(b.tenure_allowance);
  if (b.tenure_allowance !== undefined && (isNaN(tenureAllowance) || tenureAllowance < 0))
    return res.status(400).json({ error: "Ажилласан жилийн нэмэгдэл 0-ээс их байх ёстой" });
  const tenureYears = Math.floor(Number(b.tenure_years));
  if (b.tenure_years !== undefined && (isNaN(tenureYears) || tenureYears < 0))
    return res.status(400).json({ error: "Ажилласан жил 0-ээс их байх ёстой" });
  const tenureAllowanceRate = Number(b.tenure_allowance_rate);
  if (b.tenure_allowance_rate !== undefined && (isNaN(tenureAllowanceRate) || tenureAllowanceRate < 0 || tenureAllowanceRate > 25))
    return res.status(400).json({ error: "Ажилласан жилийн нэмэгдлийн хувь 0-25 хооронд байх ёстой" });
  const mealAllowance = Number(b.meal_allowance);
  if (b.meal_allowance !== undefined && (isNaN(mealAllowance) || mealAllowance < 0))
    return res.status(400).json({ error: "Хоолны нэмэгдэл 0-ээс их байх ёстой" });

  if (b.hire_date && isNaN(Date.parse(b.hire_date)))
    return res.status(400).json({ error: "Ажилд орсон огноо буруу форматтай байна" });

  if (b.contract_end && isNaN(Date.parse(b.contract_end)))
    return res.status(400).json({ error: "Гэрээ дуусах огноо буруу форматтай байна" });

  if (b.hire_date && b.contract_end && b.contract_end < b.hire_date)
    return res.status(400).json({ error: "Гэрээ дуусах огноо ажилд орсон огнооноос өмнө байж болохгүй" });

  const target = await get("SELECT id FROM users WHERE id=?", [req.params.id]);
  if (!target) return res.status(404).json({ error: "Ажилтан олдсонгүй" });

  const canEditSalary = ["director","hr"].includes(req.user.role);
  await run(`UPDATE users SET
    full_name=?,position=?,department=?,phone=?,email=?,address=?,
    register_no=?,hire_date=?,contract_type=?,contract_end=?,
    status_hr=?,job_category=?,education=?,gender=?,work_condition=?,birthdate=?,
    nationality=?,emergency_contact=?,role=?,active=?
    ${canEditSalary ? ",salary=?,skill_allowance_rate=?,skill_allowance=?,tenure_years=?,tenure_allowance_rate=?,tenure_allowance=?,meal_allowance=?" : ""}
    WHERE id=?`,
    [b.full_name.trim(),b.position||"",b.department||"",b.phone||"",b.email||null,
     b.address||"",b.register_no||"",b.hire_date||null,b.contract_type||"Байнгын",
     b.contract_end||null,b.status_hr||"Идэвхтэй",b.job_category||"Захиргааны ажилтан",
     b.education||"",b.gender||"",b.work_condition||"",b.birthdate||null,b.nationality||"Монгол",
     b.emergency_contact||"",b.role||"engineer",b.active!==false?1:0,
     ...(canEditSalary ? [salary||0, skillAllowanceRate||0, skillAllowance||0, tenureYears||0, tenureAllowanceRate||0, tenureAllowance||0, mealAllowance||0] : []),
     req.params.id]);
  await audit(req.user.id,"UPDATE","users",req.params.id,b.full_name.trim());
  res.json({ ok:true });
});

// HR History
router.get("/hr-history/:userId", auth, async (req,res) => {
  res.json(await all(
    `SELECT h.*,u.full_name creator_name FROM hr_history h
     LEFT JOIN users u ON u.id=h.created_by
     WHERE h.user_id=? ORDER BY h.event_date DESC,h.id DESC`,
    [req.params.userId]));
});

router.post("/hr-history", auth, requirePermission("hr_write"), async (req,res) => {
  const b = req.body;
  const r = await run(
    `INSERT INTO hr_history(user_id,event_type,event_date,note,created_by) VALUES(?,?,?,?,?)`,
    [b.user_id,b.event_type,b.event_date,b.note||"",req.user.id]);
  await audit(req.user.id,"CREATE","hr_history",r.id,b.event_type);
  res.json({ id:r.id });
});

// HR Stats
router.get("/hr-stats", auth, async (req,res) => {
  const canSeeSalary = ["director","hr"].includes(req.user.role);
  const users = await all(`SELECT *,${canSeeSalary?'salary':'0 AS salary'} FROM users WHERE active=1 AND role<>'ai_readonly'`);
  const today = new Date().toISOString().slice(0,10);
  const in60  = new Date(Date.now()+60*864e5).toISOString().slice(0,10);

  const byDept = {}, byContract = {}, byEdu = {};
  users.forEach(u => {
    byDept[u.department||'Бусад'] = (byDept[u.department||'Бусад']||0)+1;
    byContract[u.contract_type||'Байнгын'] = (byContract[u.contract_type||'Байнгын']||0)+1;
    byEdu[u.education||'Тодорхойгүй'] = (byEdu[u.education||'Тодорхойгүй']||0)+1;
  });

  const expiring = users.filter(u => u.contract_end && u.contract_end >= today && u.contract_end <= in60)
    .map(u => ({ id:u.id, full_name:u.full_name, contract_type:u.contract_type,
      contract_end:u.contract_end,
      days_left: Math.ceil((new Date(u.contract_end)-new Date(today))/864e5) }));

  res.json({
    total: users.length,
    active: users.filter(u=>u.status_hr==='Идэвхтэй').length,
    onLeave: users.filter(u=>u.status_hr==='Чөлөөнд').length,
    onTrip:  users.filter(u=>u.status_hr==='Томилолт').length,
    byDept, byContract, byEdu, expiring,
    totalSalary: canSeeSalary ? users.reduce((s,u)=>s+(u.salary||0),0) : null
  });
});

router.post("/users", auth, requirePermission("hr_write"), async (req, res) => {

  const b = req.body;
  if (!b.full_name || !b.full_name.trim())
    return res.status(400).json({ error: "Овог нэр шаардлагатай" });

  const phoneDigits = digitsOnly(b.phone);
  const registerDigits = digitsOnly(b.register_no);
  const username = (b.username || phoneDigits || ("emp" + Date.now())).trim();
  const password = b.password || registerDigits || crypto.randomBytes(18).toString("base64url");

  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))
    return res.status(400).json({ error: "Имэйл хаяг буруу форматтай байна" });
  for (const [key, label] of [
    ["salary", "Цалингийн дүн"],
    ["skill_allowance_rate", "Ур чадварын нэмэгдлийн хувь"],
    ["skill_allowance", "Ур чадварын нэмэгдэл"],
    ["tenure_years", "Ажилласан жил"],
    ["tenure_allowance_rate", "Ажилласан жилийн нэмэгдлийн хувь"],
    ["tenure_allowance", "Ажилласан жилийн нэмэгдэл"],
    ["meal_allowance", "Хоолны нэмэгдэл"],
  ]) {
    const value = Number(b[key] || 0);
    if (isNaN(value) || value < 0)
      return res.status(400).json({ error: `${label} 0-ээс их байх ёстой` });
  }
  if (Number(b.skill_allowance_rate || 0) > 25)
    return res.status(400).json({ error: "Ур чадварын нэмэгдлийн хувь 25%-иас их байж болохгүй" });
  if (Number(b.tenure_allowance_rate || 0) > 25)
    return res.status(400).json({ error: "Ажилласан жилийн нэмэгдлийн хувь 25%-иас их байж болохгүй" });

  const existing = await get("SELECT id FROM users WHERE username=?", [username]);
  if (existing)
    return res.status(409).json({ error: `"${username}" нэвтрэх нэр аль хэдийн бүртгэлтэй байна` });

  let r;
  try {
    r = await run(`
      INSERT INTO users(username,password_hash,full_name,role,position,
        register_no,address,phone,department,email,gender,education,work_condition,birthdate,nationality,emergency_contact,
        hire_date,contract_type,contract_end,status_hr,
        salary,skill_allowance_rate,skill_allowance,tenure_years,tenure_allowance_rate,tenure_allowance,meal_allowance,active,can_login)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
      [username, bcrypt.hashSync(password, 10), b.full_name.trim(),
       b.role || "engineer", b.position || "",
        b.register_no || "", b.address || "", b.phone || "", b.department || "",
        b.email || null, b.gender || "", b.education || "", b.work_condition || "", b.birthdate || null,
        b.nationality || "Монгол", b.emergency_contact || "", b.hire_date || null, b.contract_type || "Байнгын",
        b.contract_end || null, b.status_hr || "Идэвхтэй",
        Number(b.salary || 0), Math.floor(Number(b.skill_allowance_rate || 0)), Number(b.skill_allowance || 0),
        Math.floor(Number(b.tenure_years || 0)), Number(b.tenure_allowance_rate || 0), Number(b.tenure_allowance || 0), Number(b.meal_allowance || 0),
        b.can_login ? 1 : 0]);
  } catch (e) {
    if (e.message?.includes("UNIQUE")) return res.status(409).json({ error: "Нэвтрэх нэр давхардаж байна" });
    throw e;
  }

  await audit(req.user.id, "CREATE", "users", r.id, b.full_name.trim());
  res.json({ id: r.id });
});

router.put("/users/:id", auth, requirePermission("hr_write"), async (req, res) => {

  const b = req.body;
  const username = (b.username || digitsOnly(b.phone) || "").trim();
  if (username) {
    const existing = await get("SELECT id FROM users WHERE username=? AND id<>?", [username, req.params.id]);
    if (existing)
      return res.status(409).json({ error: `"${username}" нэвтрэх нэр аль хэдийн бүртгэлтэй байна` });
  }
  await run(`
    UPDATE users SET ${username ? "username=?," : ""} full_name=?,role=?,position=?,register_no=?,
      address=?,phone=?,department=?,email=?,active=?,can_login=?,permissions=? WHERE id=?`,
    [...(username ? [username] : []), b.full_name, b.role || "engineer", b.position || "",
     b.register_no || "", b.address || "", b.phone || "",
     b.department || "", b.email || null, b.active ? 1 : 0,
      b.can_login ? 1 : 0, b.permissions || null, req.params.id]);

  await audit(req.user.id, "UPDATE", "users", req.params.id, b.full_name);
  res.json({ ok: true });
});

router.put("/users/:id/password", auth, async (req, res) => {
  const tid = Number(req.params.id);
  const isSelf  = req.user.id === tid;
  const isAdmin = ["director","hr"].includes(req.user.role);
  if (!isSelf && !isAdmin) return res.status(403).json({ error: "Эрх хүрэхгүй" });
  const { new_password, current_password } = req.body;
  if (!new_password || new_password.length < 8)
    return res.status(400).json({ error: "Нууц үг хамгийн багадаа 8 тэмдэгт байх ёстой" });
  if (isSelf && !isAdmin) {
    const u = await get("SELECT password_hash FROM users WHERE id=?", [tid]);
    if (!bcrypt.compareSync(current_password || "", u.password_hash))
      return res.status(400).json({ error: "Одоогийн нууц үг буруу байна" });
  }
  await run("UPDATE users SET password_hash=? WHERE id=?",
    [bcrypt.hashSync(new_password, 10), tid]);
  await audit(req.user.id, "CHANGE_PASSWORD", "users", tid, "Нууц үг өөрчлөгдлөө");
  res.json({ ok: true });
});

router.delete("/users/:id", auth, requirePermission("hr_write"), async (req, res) => {

  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "Өөрийгөө идэвхгүй болгох боломжгүй" });

  const user = await get("SELECT id FROM users WHERE id=?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Ажилтан олдсонгүй" });

  await run("UPDATE users SET active=0 WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DEACTIVATE", "users", req.params.id, "Ажилтан идэвхгүй болгосон");
  res.json({ ok: true });
});

router.delete("/users/:id/permanent", auth, requireRole("director"), async (req, res) => {

  if (Number(req.params.id) === req.user.id)
    return res.status(400).json({ error: "Өөрийгөө устгах боломжгүй" });

  const user = await get("SELECT id, full_name FROM users WHERE id=?", [req.params.id]);
  if (!user) return res.status(404).json({ error: "Хэрэглэгч олдсонгүй" });

  await run("DELETE FROM users WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "users", req.params.id, `${user.full_name} бүрмөсөн устгагдлаа`);
  res.json({ ok: true });
});

// ── HR records ───────────────────────────────────────────────

router.post("/hr-records", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  if (!b.user_id)     return res.status(400).json({ error: "Ажилтан сонгоогүй байна" });
  if (!b.record_type) return res.status(400).json({ error: "Бүртгэлийн төрөл шаардлагатай" });
  if (!b.start_date)  return res.status(400).json({ error: "Эхлэх огноо шаардлагатай" });

  const userExists = await get("SELECT id FROM users WHERE id=? AND active=1", [b.user_id]);
  if (!userExists) return res.status(404).json({ error: "Ажилтан олдсонгүй эсвэл идэвхгүй байна" });

  if (b.end_date && b.end_date < b.start_date)
    return res.status(400).json({ error: "Дуусах огноо эхлэх огнооноос өмнө байж болохгүй" });

  const hasHourData = ["work_hours", "leave_hours", "overtime_hours"]
    .some(key => b[key] !== undefined && b[key] !== null && b[key] !== "");
  const workHours = hasHourData ? Number(b.work_hours || 0) : null;
  const leaveHours = hasHourData ? Number(b.leave_hours || 0) : null;
  const overtimeHours = hasHourData ? Number(b.overtime_hours || 0) : null;
  if (hasHourData && [workHours, leaveHours, overtimeHours].some(v => !Number.isFinite(v) || v < 0 || v > 24))
    return res.status(400).json({ error: "Цагийн утга 0-24 хооронд байна" });
  if (hasHourData && workHours + leaveHours > 8)
    return res.status(400).json({ error: "Ажилласан болон чөлөө/тасалсан цагийн нийлбэр 8-аас их байж болохгүй" });
  const recordType = hasHourData && leaveHours > 0 && ["Ажилласан", "Хоцорсон", "Илүү цаг"].includes(b.record_type)
    ? "Чөлөө"
    : b.record_type;

  const endDate = b.end_date || b.start_date;
  if (hasHourData && endDate === b.start_date) {
    const existing = await get(
      `SELECT id FROM hr_records
       WHERE user_id=? AND start_date=? AND COALESCE(end_date,start_date)=?
       ORDER BY id DESC LIMIT 1`,
      [b.user_id, b.start_date, b.start_date]);
    if (existing) {
      await run(
        `UPDATE hr_records
         SET record_type=?,end_date=?,work_hours=?,leave_hours=?,overtime_hours=?,note=?,created_by=?
         WHERE id=?`,
        [recordType, endDate, workHours, leaveHours, overtimeHours, b.note || "", req.user.id, existing.id]);
      await audit(req.user.id, "UPDATE", "hr_records", existing.id, `${recordType} цагийн бүртгэл`);
      return res.json({ id: existing.id, updated: true });
    }
  }

  const r = await run(
    `INSERT INTO hr_records(
       user_id,record_type,start_date,end_date,work_hours,leave_hours,overtime_hours,note,created_by
     ) VALUES(?,?,?,?,?,?,?,?,?)`,
    [b.user_id, recordType, b.start_date, b.end_date || null,
     workHours, leaveHours, overtimeHours, b.note || "", req.user.id]);
  await audit(req.user.id, "CREATE", "hr_records", r.id, recordType);
  res.json({ id: r.id });
});

router.get("/hr-records", auth, async (req, res) => {
  const canSeeAll = ["director", "hr", "chief_engineer"].includes(req.user.role);
  if (canSeeAll) {
    res.json(await all(
      `SELECT h.*, u.full_name employee_name, c.full_name created_name
       FROM hr_records h
       LEFT JOIN users u ON u.id=h.user_id
       LEFT JOIN users c ON c.id=h.created_by
       ORDER BY start_date DESC, id DESC`));
  } else {
    res.json(await all(
      `SELECT h.*, u.full_name employee_name, c.full_name created_name
       FROM hr_records h
       LEFT JOIN users u ON u.id=h.user_id
       LEFT JOIN users c ON c.id=h.created_by
       WHERE h.user_id=?
       ORDER BY start_date DESC, id DESC`,
      [req.user.id]));
  }
});

router.delete("/hr-records/:id", auth, requirePermission("hr_write"), async (req, res) => {
  const rec = await get("SELECT * FROM hr_records WHERE id=?", [req.params.id]);
  if (!rec) return res.status(404).json({ error: "Олдсонгүй" });
  await run("DELETE FROM hr_records WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "hr_records", req.params.id, `${rec.record_type} устгагдлаа`);
  res.json({ ok: true });
});

// ── Employee Profiles ────────────────────────────────────────

router.get("/employee-profile/:userId", auth, canAccessOwn("userId"), async (req, res) => {
  const tid = Number(req.params.userId);
  const profile = await get("SELECT * FROM employee_profiles WHERE user_id=?", [tid]);
  res.json(profile || {});
});

router.put("/employee-profile/:userId", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  const existing = await get("SELECT id FROM employee_profiles WHERE user_id=?", [req.params.userId]);
  if (existing) {
    await run(`UPDATE employee_profiles SET
      family_status=?,spouse_name=?,children_count=?,children_names=?,home_address=?,
      diploma=?,professional_cert=?,id_card_no=?,
      job_description=?,contract_no=?,contract_date=?,contract_notes=?,
      updated_at=CURRENT_TIMESTAMP WHERE user_id=?`,
      [b.family_status||'',b.spouse_name||'',b.children_count||0,b.children_names||'',b.home_address||'',
       b.diploma||'',b.professional_cert||'',b.id_card_no||'',
       b.job_description||'',b.contract_no||'',b.contract_date||'',b.contract_notes||'',
       req.params.userId]);
  } else {
    await run(`INSERT INTO employee_profiles
      (user_id,family_status,spouse_name,children_count,children_names,home_address,
       diploma,professional_cert,id_card_no,job_description,contract_no,contract_date,contract_notes)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.userId,b.family_status||'',b.spouse_name||'',b.children_count||0,b.children_names||'',b.home_address||'',
       b.diploma||'',b.professional_cert||'',b.id_card_no||'',
       b.job_description||'',b.contract_no||'',b.contract_date||'',b.contract_notes||'']);
  }
  await audit(req.user.id, "UPDATE", "employee_profiles", req.params.userId, "Профайл шинэчлэгдлээ");
  res.json({ ok: true });
});

// ── Employee Awards ───────────────────────────────────────────

router.get("/employee-awards/:userId", auth, canAccessOwn("userId"), async (req, res) => {
  const tid = Number(req.params.userId);
  res.json(await all("SELECT * FROM employee_awards WHERE user_id=? ORDER BY award_date DESC, id DESC", [tid]));
});

router.post("/employee-awards", auth, requirePermission("hr_write"), async (req, res) => {
  const b = req.body;
  if (!b.award_name) return res.status(400).json({ error: "Шагналын нэр шаардлагатай" });
  const r = await run(
    `INSERT INTO employee_awards(user_id,award_name,award_date,awarded_by,note) VALUES(?,?,?,?,?)`,
    [b.user_id, b.award_name, b.award_date||'', b.awarded_by||'', b.note||'']);
  await audit(req.user.id, "CREATE", "employee_awards", r.id, b.award_name);
  res.json({ id: r.id });
});

router.delete("/employee-awards/:id", auth, requirePermission("hr_write"), async (req, res) => {
  await run("DELETE FROM employee_awards WHERE id=?", [req.params.id]);
  await audit(req.user.id, "DELETE", "employee_awards", req.params.id, "Шагнал устгагдлаа");
  res.json({ ok: true });
});

// ── Employee Files ───────────────────────────────────────────

// Deprecated: see docs/deprecated-endpoints.md
router.get("/employee-files/:userId", auth, canAccessOwn("userId"), async (req, res) => {
  const tid = Number(req.params.userId);
  res.json(await all("SELECT * FROM employee_files WHERE user_id=? ORDER BY id DESC", [tid]));
});

// Deprecated: see docs/deprecated-endpoints.md
router.post("/employee-files/:userId", auth, requirePermission("hr_write"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл байхгүй" });
  const relative = "/uploads/" + req.file.filename;
  const r = await run(
    `INSERT INTO employee_files(user_id,file_type,file_path,file_name,uploaded_by) VALUES(?,?,?,?,?)`,
    [req.params.userId, req.body.file_type || "other",
     relative, req.file.originalname, req.user.id]);
  await audit(req.user.id, "UPLOAD", "employee_files", r.id, req.file.originalname);
  res.json({ id: r.id, file_path: relative });
});

// Deprecated: see docs/deprecated-endpoints.md
router.delete("/employee-files/:id", auth, requirePermission("hr_write"), async (req, res) => {
  const f = await get("SELECT * FROM employee_files WHERE id=?", [req.params.id]);
  if (f) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(f.file_path)), () => {});
    await run("DELETE FROM employee_files WHERE id=?", [req.params.id]);
    await audit(req.user.id, "DELETE", "employee_files", req.params.id, f.file_name || "");
  }
  res.json({ ok: true });
});

// ── User files (alias routes for frontend) ───────────────────

router.get("/users/:id/files", auth, canAccessOwn("id"), async (req, res) => {
  const tid = Number(req.params.id);
  const rows = await all("SELECT * FROM employee_files WHERE user_id=? ORDER BY id DESC", [tid]);
  res.json(rows.map(f => ({
    ...f,
    filename: path.basename(f.file_path || ""),
    original_name: f.file_name,
    uploaded_at: f.created_at
  })));
});

router.post("/users/:id/files", auth, requirePermission("hr_write"), upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл байхгүй" });
  const relative = "/uploads/" + req.file.filename;
  const r = await run(
    `INSERT INTO employee_files(user_id,file_type,file_path,file_name,uploaded_by) VALUES(?,?,?,?,?)`,
    [req.params.id, req.body.file_type || "other", relative, req.file.originalname, req.user.id]);
  await audit(req.user.id, "UPLOAD", "employee_files", r.id, req.file.originalname);
  res.json({ id: r.id, file_path: relative });
});

router.delete("/users/:id/files/:fileId", auth, requirePermission("hr_write"), async (req, res) => {
  const f = await get("SELECT * FROM employee_files WHERE id=?", [req.params.fileId]);
  if (f) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(f.file_path)), () => {});
    await run("DELETE FROM employee_files WHERE id=?", [req.params.fileId]);
    await audit(req.user.id, "DELETE", "employee_files", req.params.fileId, f.file_name || "");
  }
  res.json({ ok: true });
});

// ── Audit logs ───────────────────────────────────────────────

router.get("/audit-logs", auth, requireRole("director"), async (req, res) => {
  res.json(await all(
    `SELECT a.*, u.full_name FROM audit_logs a
     LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300`));
});

router.post("/users/:id/contract-scan", auth, requirePermission("hr_write"), upload.single("scan"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Файл олдсонгүй" });
  const url = "/uploads/" + req.file.filename;
  await run("UPDATE users SET contract_scan_url=? WHERE id=?", [url, req.params.id]);
  await audit(req.user.id, "UPDATE", "users", req.params.id, "contract scan uploaded");
  res.json({ url });
});

module.exports = router;
