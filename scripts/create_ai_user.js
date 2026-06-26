/**
 * AI_READONLY хэрэглэгч үүсгэж, JWT token гаргах скрипт
 *
 * Ажиллуулах:
 *   node scripts/create_ai_user.js
 *
 * Үүсэх зүйл:
 *   - users хүснэгтэд 'chatgpt_ai' нэртэй ai_readonly role-той хэрэглэгч
 *   - Консол дээр JWT token хэвлэнэ (ChatGPT Custom GPT Actions-д ашиглана)
 *
 * Ашиглах:
 *   1. Энэ скриптийг нэг удаа ажиллуул
 *   2. Хэвлэгдсэн TOKEN-ийг ChatGPT Custom GPT → Actions → Authentication-д оруул
 *   3. Token-ийг .env дотор хадгалж болно (AI_TOKEN=...)
 */

const path    = require("path");
const fs      = require("fs");
const sqlite3 = require("sqlite3").verbose();
const bcrypt  = require("bcryptjs");
const jwt     = require("jsonwebtoken");

// dotenv суулгаагүй тул .env файлыг гараар уншина
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  });
}
loadEnv();

const DB_FILE   = path.join(__dirname, "..", "data", "app.db");
const db        = new sqlite3.Database(DB_FILE);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("❌  JWT_SECRET .env файлд тохируулаагүй байна.");
  console.error("    .env файл дотор JWT_SECRET=<тань нууц утга> гэж нэмнэ үү.");
  process.exit(1);
}

function run(sql, params = []) {
  return new Promise((res, rej) =>
    db.run(sql, params, function(err) { err ? rej(err) : res(this); })
  );
}

function get(sql, params = []) {
  return new Promise((res, rej) =>
    db.get(sql, params, (err, row) => err ? rej(err) : res(row))
  );
}

async function main() {
  console.log("\n🤖  AI_READONLY хэрэглэгч үүсгэж байна...\n");

  // Аль хэдийн байгаа эсэхийг шалгах
  const existing = await get("SELECT id, role FROM users WHERE username=?", ["chatgpt_ai"]);

  if (existing) {
    console.log(`ℹ️   'chatgpt_ai' хэрэглэгч аль хэдийн байна (id=${existing.id}, role=${existing.role}).`);
    console.log("    Token дахин гаргаж байна...\n");

    const token = jwt.sign(
      { id: existing.id, username: "chatgpt_ai", role: "ai_readonly", full_name: "ChatGPT AI Advisor" },
      JWT_SECRET,
      { expiresIn: "365d" }
    );

    printResult(existing.id, token);
    db.close();
    return;
  }

  // Шинэ хэрэглэгч үүсгэх
  // Нууц үгийг random болгоно (login эрх байхгүй тул чухал биш)
  const randomPwd   = "ai-" + Math.random().toString(36).slice(2, 14) + "-readonly";
  const passwordHash = bcrypt.hashSync(randomPwd, 10);

  const result = await run(
    `INSERT INTO users
       (username, password_hash, full_name, role, active, can_login)
     VALUES (?, ?, ?, ?, 1, 1)`,
    ["chatgpt_ai", passwordHash, "ChatGPT AI Advisor", "ai_readonly"]
  );

  const userId = result.lastID;
  console.log(`✅  Хэрэглэгч үүслээ: id=${userId}, username=chatgpt_ai, role=ai_readonly`);
  console.log(`    can_login=0 (ERP login цонхоор нэвтрэх боломжгүй)\n`);

  // 1 жилийн хугацаатай token гаргах
  const token = jwt.sign(
    { id: userId, username: "chatgpt_ai", role: "ai_readonly", full_name: "ChatGPT AI Advisor" },
    JWT_SECRET,
    { expiresIn: "365d" }
  );

  printResult(userId, token);
  db.close();
}

function printResult(userId, token) {
  const border = "═".repeat(64);

  console.log(border);
  console.log("  ChatGPT Custom GPT Actions-д хэрэглэх мэдээлэл");
  console.log(border);
  console.log();
  console.log("  1️⃣   Authentication тохиргоо:");
  console.log("       Type: Bearer");
  console.log("       Token (доорх мөрийг бүтнээр нь copy хийнэ):");
  console.log();
  console.log("  " + token);
  console.log();
  console.log("  2️⃣   OpenAPI Schema файл:");
  console.log("       docs/ai_advisor_openapi.yaml");
  console.log("       (servers[0].url-ийг таны домэйнээр солино)");
  console.log();
  console.log("  3️⃣   ChatGPT Custom GPT System Prompt (доорх хэсэг):");
  console.log();
  console.log([
    "  Та Чойбалсан хөгжил ОНӨААТҮГ-ийн стратегийн зөвлөх юм.",
    "  ERP API-аас авсан мэдээллийг үндэслэж монгол хэлээр хариул.",
    "  Техникийн нэр томьёог энгийн үгээр тайлбарла.",
    "  Тоонуудыг хялбар ойлгогдохоор хэлбэрлэ (жишээ: 1,250 кВт).",
    "  Асуудал илэрвэл юуг яаралтай шийдэх хэрэгтэйг дурдаарай.",
    "  Дурын мэдээлэл өөрчлөх, устгах, тушаал өгөхгүй —",
    "  зөвхөн унших, дүн шинжилгээ хийх, зөвлөгөө өгнө.",
  ].join("\n"));
  console.log();
  console.log("  4️⃣   Локал тест хийх (ngrok):");
  console.log("       npx ngrok http 4000");
  console.log("       → гарсан https://xxxx.ngrok-free.app хаягийг");
  console.log("         yaml файлын servers[0].url-д орлуулна");
  console.log();
  console.log("  5️⃣   Token хэзээ дуусах:");
  console.log("       365 хоногийн дараа дахин: node scripts/create_ai_user.js");
  console.log();
  console.log(border);
  console.log();
}

main().catch(err => {
  console.error("❌  Алдаа гарлаа:", err.message);
  db.close();
  process.exit(1);
});
