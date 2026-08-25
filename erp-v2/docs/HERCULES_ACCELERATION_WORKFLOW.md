# Hercules-ийг OVERVA хөгжүүлэлтэд ашиглах журам

## Зорилго

Hercules нь OVERVA-г бүхэлд нь дахин үүсгэх хэрэгсэл биш. Нэг удаад нэг тодорхой модуль, дэлгэц, API contract эсвэл засварыг хурдан боловсруулах туслах хэрэгсэл байна. OVERVA-ийн PostgreSQL өгөгдөл, tenant тусгаарлалт, эрх, аудит, API болон дизайн стандарт нь үндсэн эх сурвалж хэвээр үлдэнэ.

## Нэг ажлын багц

Hercules-д өгөх нэг хүсэлт дараах хүрээтэй байна:

1. Нэг модуль эсвэл нэг жижиг боломж.
2. Тодорхой acceptance criteria.
3. Module Manifest ба зөвшөөрөгдсөн route prefix.
4. Ашиглах permission, entity, audit event-ийн жагсаалт.
5. Одоо байгаа API contract болон OVERVA дизайн token.
6. Хийхгүй зүйлсийн тодорхой жагсаалт.

Тодорхойгүй том хүсэлт, бүх ERP-г нэг дор үүсгэх хүсэлт өгөхгүй.

## Build ба Repair

- `Build`: өмнө байгаагүй, батлагдсан жижиг ажлын багцыг шинээр үүсгэнэ.
- `Repair`: байгаа artifact-ийн тодорхой алдааг засна. Бүх модулийг дахин үүсгэхгүй.
- `Review`: код, contract, дизайн эсвэл тестийг өөрчлөлтгүй шалгана.
- `Design`: зөвхөн батлагдсан дэлгэцийн хүрээнд UI хувилбар гаргана.

Алдаа гарвал эхлээд Repair ашиглана. Дахин Build хийх нь credit их үрэх тул зөвхөн artifact ашиглах боломжгүй болсон үед сонгоно.

## Module Manifest-ийн жишээ

```json
{
  "moduleCode": "inventory",
  "version": "1.0.0",
  "routePrefix": "/api/modules/inventory",
  "permissions": ["inventory.read", "inventory.manage"],
  "entities": ["warehouse", "item", "stock_movement"],
  "auditEvents": ["inventory.item.created", "inventory.stock.moved"],
  "navigation": ["Агуулах", "Бараа", "Хөдөлгөөн"],
  "dependencies": ["platform-core", "employee-master"]
}
```

Route нь OVERVA-ийн reserved route болон өөр модультай давхцах ёсгүй.

## Аюулгүй дамжуулах дүрэм

Hercules рүү дараах зүйлсийг өгөхгүй:

- production нууц үг, token, API key;
- бодит tenant-ийн хувийн болон нууц өгөгдөл;
- production database dump;
- Cloudflare, сервер, Git-ийн нууц credential;
- хэрэглэгчийн регистр, утас, цалин зэрэг түүхий мэдээлэл.

Шаардлагатай бол нэргүйжүүлсэн sample data болон зохиомол test fixture ашиглана.

## Нийлүүлэх урсгал

1. OVERVA дээр scope ба manifest-ийг батална.
2. Hercules-ээр нэг artifact гаргуулна.
3. `docs/HERCULES_ARTIFACT_HANDOFF.md`-ийн manifest болон handoff report-ийг авна.
4. Artifact-ийг тусгаарласан орчинд татна.
5. Route, permission, tenant isolation, audit contract-ийг шалгана.
6. Unit/API/build тест ажиллуулна.
7. Хүн өөрчлөлтийг review хийж зөвшөөрнө.
8. Staging орчинд туршина.
9. Зөвхөн батлагдсан өөрчлөлтийг production-д нийлүүлнэ.
10. Зарцуулсан credit, үр дүн, artifact/commit-ийг `admin.overva.com` дээр бүртгэнэ.

Hercules production руу шууд deploy хийх эрхгүй байна.

Smart Import review artifact дээр `docs/SMART_IMPORT_REVIEW_CONTRACT_V1.md`-ийг
заавал мөрдөнө. UI bucket болон production database status-ийг нэг ойлголт болгон
хуулж болохгүй.

## Credit хэмнэх дүрэм

- Нэг хүсэлт = нэг хэмжигдэхүйц үр дүн.
- Одоо байгаа component, route, contract-ийг prompt-д зааж дахин бүтээлгэхгүй.
- Acceptance criteria болон гаралтын файлын жагсаалтыг урьдчилан тогтооно.
- Алдаа засахдаа бүтэн prompt дахин эхлүүлэхгүй, Repair хүсэлт өгнө.
- Ажил бүрийн өмнөх/дараах credit-ийг бүртгэнэ.
- `accepted`, `partial`, `rejected`, `error` үр дүнг үнэнээр тэмдэглэнэ.
- Credit их хэрэглээд хүлээн авалт багатай төрлийн ажлыг Hercules-ээс дотоод хөгжүүлэлт рүү шилжүүлнэ.

## Pro эрх авах босго

Эхлээд 5–10 жижиг ажлын багцыг дээрх журмаар хэмжинэ. Нэг хүлээн авсан artifact-д ногдох дундаж credit болон засварын давтамж тодорхой болсны дараа Pro эрхийн бодит өгөөжийг шийднэ. Ингэснээр эрх худалдаж авсан ч credit-ийг хяналтгүй өсгөхгүй.

## Production gate

Дараахын аль нэг байхгүй бол өөрчлөлтийг нийлүүлэхгүй:

- батлагдсан Module Manifest;
- route collision шалгалт;
- tenant isolation;
- permission шалгалт;
- critical action audit;
- автомат тест;
- хүний review;
- rollback эсвэл өмнөх хувилбар руу буцах боломж.
