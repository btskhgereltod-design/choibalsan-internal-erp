# Hercules artifact-ийг OVERVA-д хүлээн авах contract

## Audit record — Import Review v4 export (2026-08-24)

- Audit decision: `partial` for UX concepts; `reference_only` for the exported
  application and database.
- Reused concepts: summary buckets, visible issue explanations, inline correction,
  explicit exclusion, and approval gating.
- Rejected implementation: fixture rows, component-local workflow state, Convex
  user-only schema, prototype routing/auth, and hard-coded counts.
- OVERVA target: the existing tenant-scoped PostgreSQL Smart Import API,
  immutable audit, primary-admin authorization, and canonical structure tables.
- Evidence: 8 focused Smart Import tests and all 155 API tests passed.

## Зорилго

Hercules-д гаргасан prototype, дэлгэц эсвэл component нь OVERVA-ийн production
код биш. Энэ contract нь artifact-ийн хэрэгтэй хэсгийг tenant isolation, permission,
audit болон одоо байгаа API-г эвдэхгүйгээр үндсэн repository-д хүлээн авах зааг юм.

## Source of truth

- OVERVA-ийн repository, PostgreSQL schema, API болон `docs/DECISIONS.md` нь үнэн эх
  сурвалж байна.
- Hercules-ийн mock data, local state, Convex schema, auth, route болон backend нь
  production-ийн үнэн эх сурвалж болохгүй.
- Hercules-ийн artifact-аас UX урсгал, component-ийн зохион байгуулалт, validation-ийн
  харагдац болон хэрэглэгчийн ойлгомжтой шийдлийг сонгон авна.
- Production өгөгдлийн төлөв, permission, audit болон commit дүрмийг OVERVA өөрөө
  хэрэгжүүлнэ.

## Artifact бүрийн заавал өгөх manifest

```yaml
artifact_id: hercules-smart-import-review-v4
artifact_type: ux-reference
scope: organization-structure-import-review
source_version: v4
allowed_route_prefix: /app/import
changed_files: []
dependencies: []
mock_data_files: []
permissions_shown:
  - organization.structure.import
  - import.approve
production_api_assumed: false
database_writes: none
tests_run: []
acceptance_evidence: []
credit_before: 21.2
credit_after: 17.4
known_gaps: []
```

Manifest дахь `production_api_assumed`, `database_writes`, `known_gaps`-ийг хоосон
орхиж болохгүй.

## Хүлээн авах дараалал

1. Artifact-ийн эх код болон manifest-ийг export хийнэ.
2. Тусгаарласан branch эсвэл түр ажлын хавтсанд шалгана.
3. Component бүрийг одоо байгаа OVERVA route, CSS token, API contract-той тулгана.
4. Mock data болон local state-ийг production код руу хуулж оруулахгүй.
5. Tenant, permission, audit, validation, idempotency-г сервер талд дахин батална.
6. Unit/API/build test болон хүний review амжилттай болсны дараа л merge хийнэ.
7. Staging дээр бодит бус fixture ашиглан туршаад production-д гаргана.

## Шууд татгалзах нөхцөл

- production credential эсвэл бодит хүний өгөгдөл агуулсан;
- organization ID-г client query эсвэл form-оос итгэж авсан;
- audit event-ийг client талд үнэн эх сурвалж болгон үүсгэсэн;
- approval-гүйгээр canonical table-д бичдэг;
- одоо байгаа API-г тайлбаргүй сольсон;
- ажиллаж буй route эсвэл component-ийг бүхэлд нь дахин үүсгэсэн;
- rollback, test evidence эсвэл changed-file list байхгүй.

## Хүлээн авалтын шийдвэр

- `accepted`: production contract-т нийцсэн, тесттэйгээр merge хийсэн.
- `partial`: зөвхөн тодорхой component/UX санааг авсан.
- `reference_only`: зураглал, урсгалын лавлагаа болгон хадгалсан.
- `rejected`: аюулгүй эсвэл архитектурын шаардлага хангаагүй.

Hercules дээр build амжилттай болсон нь `accepted` гэсэн үг биш. OVERVA-ийн
production gate-ийг давсны дараа л хүлээн авсанд тооцно.
