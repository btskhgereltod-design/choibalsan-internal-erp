# Чойбалсан ERP — ChatGPT Connector Status

**Checkpoint огноо:** 2026-06-23
**Төлөв:** ✅ 7 action бүхий GPT Actions холболт ажиллаж байна

---

## Холболтын мэдээлэл

| Талбар | Утга |
|--------|------|
| GPT нэр | Чойбалсан ERP Зөвлөх |
| Schema файл | `docs/connector_slim.yaml` |
| Authentication | API Key — Authorization: Bearer token (JWT) |
| Production URL | https://www.choibalsan-hugjil.com |
| OpenAPI version | 3.1.0 |
| Token эзэмшигч | `chatgpt_ai` (role: ai_readonly, id: 39) |

---

## Идэвхтэй Action-ууд (7)

| # | operationId | Endpoint | Зориулалт |
|---|-------------|----------|-----------|
| 1 | `getExecutiveDailySummary` | `GET /api/ai/executive/daily` | Өдрийн бүрэн нэгтгэл — гэмтэл, ажил, IoT, агуулах, ирц, эрсдэл |
| 2 | `getLightingScheduleToday` | `GET /api/ai/lighting/schedule-today` | Гэрэлтүүлгийн өдрийн асах/унтрах хуваарь, шийдвэрийн эх сурвалж |
| 3 | `getControlPointsStatus` | `GET /api/ai/lighting/control-points-status` | Control point бүрийн health, fault, IoT холболт |
| 4 | `getIotDetailed` | `GET /api/ai/iot/detailed` | LoRa node-уудын offline, signal, гэмтлийн байдал |
| 5 | `searchWorkOrders` | `GET /api/ai/work-orders/search` | Ажлын даалгавар хайх, хоцорсон, эрсдэлийн түвшин |
| 6 | `getFaultWorkflowStatus` | `GET /api/ai/faults/workflow-status` | Гэмтлийн workflow — stuck, засагдсан, хаагдаагүй |
| 7 | `getAiAuditSummary` | `GET /api/ai/audit/ai-summary` | AI connector-ийн хандалтын аудит, ашиглалтын нэгтгэл |

---

## Туршилтын үр дүн

| Туршсан асуулт | Дуудсан action | Үр дүн |
|----------------|----------------|--------|
| "ERP өнөөдөр ямар байна?" | `getExecutiveDailySummary` | ✅ 166 гэмтэл, 48 хоцорсон ажил, эрсдэл, санал |
| "Гэрэл өнөөдөр хэдэд асах вэ?" | `getLightingScheduleToday` | ✅ 20:40 асах, 01:00 унтрах, decision_source: schedule |
| 7 action бүгд HTTP 200 | — | ✅ 56/56 шалгалт тэнцсэн |

---

## Аюулгүй байдлын одоогийн байдал

| Зүйл | Байдал | Тайлбар |
|------|--------|---------|
| Role | `ai_readonly` (level 0) | `/api/ai/*` read-only-с өөр ямар ч endpoint нэвтрэх эрхгүй |
| Token хугацаа | 365 хоног | Тестэд хангалттай. Production-д 30–90 хоног болгох шаардлагатай |
| `can_login` | `1` (хэвээр) | `db.js` auth middleware Bearer token болон web UI login-г нэг flag-аар шалгадаг тул өөрчлөх боломжгүй. UI login ба API access-ийг салгах механизм дараа нэмэх шаардлагатай |
| Нууц үг | Random `ai-xxxx-readonly` | Хэн ч мэдэхгүй тул web UI нэвтрэх эрсдэл бага |
| DELETE/UPDATE/INSERT | Хориглосон | `requireAiRole` middleware болон route зөвхөн GET |
| Audit log | Идэвхтэй | Бүх AI хандалт `audit_logs` хүснэгтэд immutable бичигдэнэ |

---

## Дараа нэмэх шаардлагатай security сайжруулалт

1. **Token хугацаа богиносгох** — 365 хоног → 30–90 хоног + `node scripts/create_ai_user.js` дахин ажиллуулах процесс тогтоох
2. **Revoke mechanism** — token blacklist эсвэл DB-д token hash хадгалж, `auth()` middleware-д шалгах
3. **UI/API access салгах** — `can_login` нэг flag хоёр зорилгод ашиглагдаж байна. `can_api=1` тусдаа column нэмж Bearer token auth-д ашиглах (schema migration шаардлагатай)

---

## Хязгаарлалт (өөрчлөхгүй)

- `docs/ai_advisor_openapi.yaml` — 18 endpoint бүрэн schema, хэвээр
- Server code (`routes/ai_advisor.js`) — өөрчлөхгүй
- Database schema — өөрчлөхгүй
- **Дараагийн шатанд шинэ action нэмэхээс өмнө заавал зөвшөөрөл авна**
