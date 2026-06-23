# Чойбалсан ERP — ChatGPT Connector Status

**Checkpoint огноо:** 2026-06-23
**Төлөв:** ✅ Ажиллаж байна

---

## Холболтын мэдээлэл

| Талбар | Утга |
|--------|------|
| Custom GPT нэр | Чойбалсан ERP Зөвлөх |
| Schema файл | `docs/connector_slim.yaml` |
| Authentication | Bearer token (JWT, ai_readonly role) |
| Server | https://www.choibalsan-hugjil.com |
| OpenAPI version | 3.1.0 |

---

## Идэвхтэй Action-ууд

### 1. `getExecutiveDailySummary`
- **Endpoint:** `GET /api/ai/executive/daily`
- **Зориулалт:** Байгууллагын өдрийн бүрэн нэгтгэл — гэрэлтүүлэг, гэмтэл, ажил, IoT, агуулах, ирц, эрсдэл, санал
- **Дуудах асуулт:** "ERP өнөөдөр ямар байна?", "Яаралтай зүйл байна уу?"

### 2. `getLightingScheduleToday`
- **Endpoint:** `GET /api/ai/lighting/schedule-today`
- **Зориулалт:** Гэрэлтүүлгийн категори бүрийн өнөөдрийн асах/унтрах цаг, шийдвэрийн эх сурвалж
- **Дуудах асуулт:** "Гэрэл өнөөдөр хэдэд асах вэ?", "Унтрах цаг ямар байна?"

---

## Амжилттай туршсан асуултууд

| Асуулт | Дуудсан action | Үр дүн |
|--------|----------------|--------|
| "ERP өнөөдөр ямар байна?" | `getExecutiveDailySummary` | ✅ 166 гэмтэл, 48 хоцорсон ажил, эрсдэл, санал буцаасан |
| "Гэрэл өнөөдөр хэдэд асах вэ?" | `getLightingScheduleToday` | ✅ 20:40 асах, 01:00 унтрах, decision_source: schedule |

---

## Хязгаарлалт (өөрчлөхгүй)

- Server code шинээр өөрчлөхгүй
- Database schema өөрчлөхгүй
- `docs/ai_advisor_openapi.yaml` (18 endpoint бүрэн schema) хэвээр

---

## Дараагийн шатанд нэмэх боломжтой Action-ууд

Доорх action-ууд `routes/ai_advisor.js`-д аль хэдийн бэлэн, тестэд тэнцсэн.
Шаардлагатай үед `docs/connector_slim.yaml`-д нэмэхэд л хангалттай.

| # | operationId | Endpoint | Зориулалт |
|---|-------------|----------|-----------|
| 3 | `getControlPointsStatus` | `GET /api/ai/lighting/control-points-status` | 241 control point-ийн health, fault, IoT байдал |
| 4 | `getIotDetailed` | `GET /api/ai/iot/detailed` | LoRa node-уудын дэлгэрэнгүй байдал, offline, signal |
| 5 | `searchWorkOrders` | `GET /api/ai/work-orders/search` | Хоцорсон ажлын жагсаалт, эрсдэлийн түвшин |
| 6 | `getFaultWorkflowStatus` | `GET /api/ai/faults/workflow-status` | Гэмтлийн workflow — stuck, засагдсан, хаагдаагүй |
| 7 | `getAiAuditSummary` | `GET /api/ai/audit/ai-summary` | AI хандалтын аудит лог, ашиглалтын нэгтгэл |
