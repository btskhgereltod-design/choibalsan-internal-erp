const express = require("express");
const { run, all, get, auth, upload } = require("../db");
const router = express.Router();
const CHAT_REACTIONS = new Set(["👍", "❤️", "😂", "😮", "😢"]);

async function touchLastSeen(userId) {
  await run(
    `INSERT INTO user_last_seen(user_id, last_seen) VALUES(?, datetime('now','localtime'))
     ON CONFLICT(user_id) DO UPDATE SET last_seen=datetime('now','localtime')`,
    [userId]
  );
}

async function attachReactions(rows, userId) {
  if (!rows.length) return rows;
  const ids = rows.map(r => Number(r.id)).filter(Boolean);
  const placeholders = ids.map(() => "?").join(",");
  const reactions = await all(
    `SELECT message_id, emoji, COUNT(*) count
     FROM chat_message_reactions
     WHERE message_id IN (${placeholders})
     GROUP BY message_id, emoji`,
    ids
  );
  const mine = await all(
    `SELECT message_id, emoji
     FROM chat_message_reactions
     WHERE user_id=? AND message_id IN (${placeholders})`,
    [userId, ...ids]
  );
  const byMessage = {};
  reactions.forEach(r => {
    if (!byMessage[r.message_id]) byMessage[r.message_id] = [];
    byMessage[r.message_id].push({ emoji: r.emoji, count: Number(r.count || 0) });
  });
  const myByMessage = Object.fromEntries(mine.map(r => [r.message_id, r.emoji]));
  return rows.map(r => ({
    ...r,
    reactions: byMessage[r.id] || [],
    my_reaction: myByMessage[r.id] || null
  }));
}

// GET /api/chat/users — бүх ажилтан + онлайн статус
router.get("/chat/users", auth, async (req, res) => {
  try {
    await touchLastSeen(req.user.id);
    const users = await all(`
      SELECT u.id, u.full_name, u.position, u.department, u.role, u.avatar_url,
             COALESCE(ls.last_seen,'') AS last_seen,
             CASE WHEN ls.last_seen > datetime('now','localtime','-5 minutes') THEN 1 ELSE 0 END AS is_online
      FROM users u
      LEFT JOIN user_last_seen ls ON ls.user_id = u.id
      WHERE u.active = 1 AND u.id != ? AND u.role != 'ai_readonly'
      ORDER BY is_online DESC, u.full_name
    `, [req.user.id]);
    res.json(users);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/messages — бүлэг эсвэл DM мессежүүд
router.get("/chat/messages", auth, async (req, res) => {
  try {
    await touchLastSeen(req.user.id);
    const recipId = req.query.recipient_id ? Number(req.query.recipient_id) : null;
    let rows;
    if (!recipId) {
      rows = await all(`
        SELECT m.*, u.full_name AS sender_name, u.position AS sender_position,
               u.department AS sender_dept, u.avatar_url AS sender_avatar_url
        FROM chat_messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.recipient_id IS NULL
        ORDER BY m.created_at DESC LIMIT 100
      `);
    } else {
      rows = await all(`
        SELECT m.*, u.full_name AS sender_name, u.position AS sender_position,
               u.department AS sender_dept, u.avatar_url AS sender_avatar_url
        FROM chat_messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.recipient_id IS NOT NULL
          AND ((m.sender_id=? AND m.recipient_id=?) OR (m.sender_id=? AND m.recipient_id=?))
        ORDER BY m.created_at DESC LIMIT 100
      `, [req.user.id, recipId, recipId, req.user.id]);
    }
    res.json(await attachReactions(rows.reverse(), req.user.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/chat/messages — мессеж илгээх (текст + олон зураг)
router.post("/chat/messages", auth, upload.fields([
  { name: "images", maxCount: 12 },
  { name: "image",  maxCount: 12 },
]), async (req, res) => {
  try {
    await touchLastSeen(req.user.id);
    const { message, recipient_id } = req.body;
    const files = [
      ...(req.files?.images || []),
      ...(req.files?.image || []),
    ];
    if (!message && !files.length) return res.status(400).json({ error: "Мессеж эсвэл зураг оруулна уу" });

    const created = [];
    if (message || !files.length) {
      const r = await run(
        `INSERT INTO chat_messages(sender_id, recipient_id, message, image_url) VALUES(?,?,?,?)`,
        [req.user.id, recipient_id ? Number(recipient_id) : null, message || null, null]
      );
      created.push(r.id);
    }
    for (const file of files) {
      const r = await run(
        `INSERT INTO chat_messages(sender_id, recipient_id, message, image_url) VALUES(?,?,?,?)`,
        [req.user.id, recipient_id ? Number(recipient_id) : null, null, `/uploads/${file.filename}`]
      );
      created.push(r.id);
    }
    const placeholders = created.map(() => "?").join(",");
    const rows = await all(`
      SELECT m.*, u.full_name AS sender_name, u.position AS sender_position,
             u.avatar_url AS sender_avatar_url
      FROM chat_messages m JOIN users u ON u.id = m.sender_id
      WHERE m.id IN (${placeholders}) ORDER BY m.id ASC
    `, created);
    res.json(await attachReactions(rows, req.user.id));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/chat/messages/:id/reaction — reaction нэмэх, солих, цуцлах
router.post("/chat/messages/:id/reaction", auth, async (req, res) => {
  try {
    const messageId = Number(req.params.id);
    const emoji = String(req.body.emoji || "");
    if (!CHAT_REACTIONS.has(emoji)) return res.status(400).json({ error: "Дэмжигдээгүй emoji байна" });

    const msg = await get("SELECT id,sender_id,recipient_id FROM chat_messages WHERE id=?", [messageId]);
    if (!msg) return res.status(404).json({ error: "Мессеж олдсонгүй" });
    if (msg.recipient_id !== null
        && Number(msg.sender_id) !== Number(req.user.id)
        && Number(msg.recipient_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "Энэ мессежид хандах эрхгүй" });
    }

    const current = await get(
      "SELECT id,emoji FROM chat_message_reactions WHERE message_id=? AND user_id=?",
      [messageId, req.user.id]
    );
    if (current?.emoji === emoji) {
      await run("DELETE FROM chat_message_reactions WHERE id=?", [current.id]);
    } else if (current) {
      await run("UPDATE chat_message_reactions SET emoji=?,created_at=CURRENT_TIMESTAMP WHERE id=?", [emoji, current.id]);
    } else {
      await run(
        "INSERT INTO chat_message_reactions(message_id,user_id,emoji) VALUES(?,?,?)",
        [messageId, req.user.id, emoji]
      );
    }
    const [updated] = await attachReactions([{ id: messageId }], req.user.id);
    res.json(updated);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/chat/messages/:id/tag — зургийг ажилтай холбох
router.post("/chat/messages/:id/tag", auth, async (req, res) => {
  try {
    const { work_log_id, execution_id } = req.body;
    const msg = await get("SELECT * FROM chat_messages WHERE id=?", [req.params.id]);
    if (!msg) return res.status(404).json({ error: "Мессеж олдсонгүй" });
    if (!msg.image_url) return res.status(400).json({ error: "Зургийн мессеж биш байна" });

    await run(
      `UPDATE chat_messages SET tagged_work_log_id=?, tagged_execution_id=? WHERE id=?`,
      [work_log_id || null, execution_id || null, msg.id]
    );

    if (msg.image_url) {
      const filePath = msg.image_url.startsWith("/uploads/")
        ? msg.image_url
        : `/uploads/${msg.image_url.replace(/^\/+/, "")}`;
      if (execution_id) {
        await run(
          `INSERT INTO execution_photos(execution_id, file_path, stamp_text, uploaded_by) VALUES(?,?,?,?)`,
          [Number(execution_id), filePath, "ERP chat", req.user.id]
        );
      } else if (work_log_id) {
        await run(
          `INSERT INTO work_photos(work_log_id, file_path, stamp_text, uploaded_by) VALUES(?,?,?,?)`,
          [Number(work_log_id), filePath, "ERP chat", req.user.id]
        );
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/chat/messages/:id — өөрийн мессеж устгах
router.delete("/chat/messages/:id", auth, async (req, res) => {
  try {
    const msg = await get("SELECT * FROM chat_messages WHERE id=?", [req.params.id]);
    if (!msg) return res.status(404).json({ error: "Мессеж олдсонгүй" });
    if (Number(msg.sender_id) !== Number(req.user.id) && !["director"].includes(req.user.role)) {
      return res.status(403).json({ error: "Зөвхөн өөрийн мессежийг устгана" });
    }
    await run("DELETE FROM chat_message_reactions WHERE message_id=?", [req.params.id]);
    await run("DELETE FROM chat_messages WHERE id=?", [req.params.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/work-logs — ажлын жагсаалт (tagging-д зориулсан)
router.get("/chat/work-logs", auth, async (req, res) => {
  try {
    const rows = await all(`
      SELECT id, title, category, department, status, start_date, end_date
      FROM asset_events
      WHERE status NOT IN ('Хаагдсан','Дууссан гэж илгээсэн')
      ORDER BY created_at DESC LIMIT 80
    `);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/executions/:workId — ажлын гүйцэтгэлүүд (tagging dropdown)
router.get("/chat/executions/:workId", auth, async (req, res) => {
  try {
    const rows = await all(
      `SELECT id, title, status, progress FROM work_executions WHERE work_log_id=? ORDER BY created_at DESC`,
      [req.params.workId]
    );
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/tag-data — салбараар бүлэглэсэн гүйцэтгэлүүд (tagging dropdown)
router.get("/chat/tag-data", auth, async (req, res) => {
  try {
    const execs = await all(`
      SELECT we.id, we.title AS exec_title, we.status, we.progress,
             ae.title AS work_title, ae.category, ae.id AS work_log_id
      FROM work_executions we
      JOIN asset_events ae ON ae.id = we.work_log_id
      WHERE ae.status NOT IN ('Хаагдсан','Цуцалсан')
      ORDER BY ae.category, ae.title, we.id DESC
    `);
    const cats = [...new Set(execs.map(e => e.category).filter(Boolean))].sort();
    const execsByCat = {};
    cats.forEach(cat => { execsByCat[cat] = execs.filter(e => e.category === cat); });
    const uncatExecs = execs.filter(e => !e.category);
    if (uncatExecs.length) { execsByCat["Бусад"] = uncatExecs; cats.push("Бусад"); }
    res.json({ categories: cats, execsByCat });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/chat/unread?since_id=N — уншаагүй мессежийн тоо
router.get("/chat/unread", auth, async (req, res) => {
  try {
    const sinceId = parseInt(req.query.since_id) || 0;
    const result = await get(
      `SELECT COUNT(*) as count FROM chat_messages
       WHERE id > ? AND sender_id != ?
         AND (recipient_id IS NULL OR recipient_id = ?)`,
      [sinceId, req.user.id, req.user.id]
    );
    // Also fetch the latest message preview
    const latest = await get(
      `SELECT m.id, m.message, u.full_name sender_name
       FROM chat_messages m JOIN users u ON u.id = m.sender_id
       WHERE m.id > ? AND m.sender_id != ?
         AND (m.recipient_id IS NULL OR m.recipient_id = ?)
       ORDER BY m.id DESC LIMIT 1`,
      [sinceId, req.user.id, req.user.id]
    );
    res.json({ count: result.count, latest });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/chat/heartbeat — last_seen шинэчлэх
router.post("/chat/heartbeat", auth, async (req, res) => {
  try {
    await touchLastSeen(req.user.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
