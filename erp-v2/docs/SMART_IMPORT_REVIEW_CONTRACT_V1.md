# Smart Import Review Contract v1

## Implementation status — 2026-08-24

- Migration: `api/migrations/0050_smart_import_review_contract.sql`.
- API: `api/src/routes/structure-smart-imports.js` supports row-level correction,
  acceptance, reasoned exclusion, approval blocking, commit outcome, and audit.
- Validation: `api/src/services/structure-import.js` determines canonical
  create/skip proposals without treating a new position under an existing unit as
  an exact duplicate.
- UI: `web/structure-smart-import.js` uses live API rows and derives every bucket
  count from the same row collection; no Hercules fixture is used.
- Verification: the focused Smart Import suite passed 8/8 and the full API suite
  passed 155/155 tests.
- Deployment: migration `0050` is applied to the current production database;
  the API/web rebuild, container health checks, tunnel connectivity, and public
  Smart Import asset were verified after deployment.

## Хүрээ

Энэ contract нь байгууллагын бүтэц импортлох review дэлгэцийн утгыг тогтооно.
Hercules-ийн одоогийн `Create / Update / Skip / Needs Review / Reject` prototype нь
UX reference бөгөөд OVERVA-ийн database status-тай нэг талбар гэж ойлгож болохгүй.

## Төлөвийг дөрвөн тусдаа хэмжээсээр хадгална

| Хэмжээс | Утга |
| --- | --- |
| Proposed action | `create`, `update`, `skip` — canonical өгөгдөлд хийх санал |
| Validation state | `valid`, `warning`, `error` — deterministic дүрмийн үр дүн |
| Review decision | `pending`, `accepted`, `corrected`, `excluded` — хүний шийдвэр |
| Commit outcome | `not_applied`, `created`, `updated`, `skipped`, `rejected`, `failed` |

`Needs Review` нь `review_decision=pending`; `Reject` нь засагдаагүй
`validation_state=error` байна. Эдгээрийг `create/update/skip`-тэй нэг database
status болгон хольж болохгүй.

## Одоогийн production mapping

OVERVA-ийн одоогийн `smart_import_rows.status` нь
`pending / ready / warning / error / imported` утгатай. Иймээс Hercules-ийн таван
bucket-ийг энэ баганад шууд хуулж болохгүй.

| Hercules UI | Одоогийн OVERVA-д тайлбарлах нь |
| --- | --- |
| Create | validation амжилттай, шинэ business key — proposed action |
| Update | validation амжилттай, business key таарсан ба өгөгдөл өөр — proposed action |
| Skip | яг ижил canonical утгатай — proposed action |
| Needs Review | ambiguous match эсвэл хүний шийдвэр шаардсан warning |
| Reject | deterministic error; commit-д орохгүй |

Production implementation хийхээс өмнө proposed action болон review decision-ийг
тусдаа хадгалах migration/API өөрчлөлтийг review хийж батална. Prototype-ийн local
state-ийг schema гэж үзэхгүй.

## Өөрчлөхгүй дүрэм

- Scope нь эхний хувилбарт зөвхөн department болон position байна.
- Department business key: `department_code`.
- Position business key: `position_code`; position нь `department_code`-той байна.
- Нэр дангаараа update хийх түлхүүр болохгүй.
- Employee import болон user account linking нь тусдаа үе шат байна.
- AI mapping санал гаргаж болно; deterministic validation болон хүний approval-ийг
  алгасахгүй.
- Canonical table-д зөвхөн серверийн transaction commit бичнэ.
- Commit нь tenant-scoped, permission-checked, idempotent байна.
- Critical review, approval, exclusion, correction болон commit бүр audit event үүсгэнэ.

## Approval gate

- `Needs Review` мөр бүр corrected, accepted эсвэл excluded болсон байна.
- `Reject` мөр бүр засагдсан эсвэл шалтгаантай excluded болсон байна.
- Approval хийх хүн сервер талд `structure.import.manage` эрхтэй байна.
- Approval хийхэд validation snapshot hash, file hash, mapping/ruleset version хадгална.
- Approval-аас хойш canonical structure өөрчлөгдвөл commit-ийн өмнө revalidate хийнэ.

## UX acceptance

- Бүх тоо нэг filtered source-оос бодогдоно; hard-coded count байхгүй.
- Excluded мөр тусдаа төлөв болж count, filter, audit-д үргэлж харагдана.
- Edit хийсэн мөрийг дангаар нь revalidate хийнэ.
- Commit хүртэл canonical өгөгдөл өөрчлөгдөхгүй.
- Error report нь `row_number`, `record_type`, `field`, `error_message`,
  `raw_value`, `bucket` талбартай байна.
- Mock data нь зохиомол бөгөөд бодит tenant-ийн хувийн өгөгдөл агуулахгүй.

## Одоогийн Hercules artifact-ийн шийдвэр

`Import Review Prototype v4`-ийг `reference_only` гэж хүлээн авна. Review table,
bucket summary, inline correction болон issue presentation-ийг дахин ашиглаж болно.
Mock backend, local session state, route/auth таамаг, hard-coded fixture-ийг production
руу шилжүүлэхгүй.
