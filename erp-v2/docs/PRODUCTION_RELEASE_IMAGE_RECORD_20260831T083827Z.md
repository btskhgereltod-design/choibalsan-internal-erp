# Production release image record — 20260831T083827Z

Status: **pre-build preservation complete at `2026-08-31T11:50:11Z`**

Phase A deployment status: **SUCCESS at `2026-08-31T12:15:34Z`**

| Service | Running container | Image creation time (UTC) | Immutable image ID/digest | Rollback tag |
|---|---|---|---|---|
| API | `overva-production-api-1` | `2026-08-31T08:35:29.635110368Z` | `sha256:079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2` | `overva-production-api:rollback-20260831T083827Z` |
| Web | `overva-production-web-1` | `2026-08-31T08:37:18.225422749Z` | `sha256:d008f0a360b420bc4edb681a2f22bbb9630381e53a22a988e79a0cb23bb1b5e1` | `overva-production-web:rollback-20260831T083827Z` |

Validated local digest references:

- `overva-production-api@sha256:079eb97b1f0f494b6bd3da8502f1a59926ccf151081265cff2f009347c2938d2`
- `overva-production-web@sha256:d008f0a360b420bc4edb681a2f22bbb9630381e53a22a988e79a0cb23bb1b5e1`

The pre-build gate created both local tags directly from the running container
image IDs. No image was rebuilt and no running container was replaced.

| Service | Immutable rollback tag | Archive filename | Bytes | SHA-256 | Off-host Drive file ID |
|---|---|---|---:|---|---|
| API | `overva-production-api:rollback-20260831T083827Z` | `overva-production-api_rollback-20260831T083827Z.tar` | 84,244,480 | `B964DF0B176068267B401EE05695AA7BEEF687D9C2756D132E538238E318C640` | `1oPqTp7_DPMXyvLvxxs1c6PEpX3ffZ_Sk` |
| Web | `overva-production-web:rollback-20260831T083827Z` | `overva-production-web_rollback-20260831T083827Z.tar` | 29,628,416 | `F25E97A8B39680AABDAE172B8EB1A8859F947018BEAAD7AEBD3068A17BCE6A68` | `1AptLTGqxTTVlnJ-w1B_I48YFGHW0rlsR` |

Local storage is the ignored directory
`release-artifacts/20260831T083827Z/`. Both tar files were readable and
contained Docker `manifest.json` (`22` API entries and `92` Web entries).

The independent copy is in the private Google Drive folder
[`OVERVA Release Vault/20260831T083827Z`](https://drive.google.com/drive/folders/1AkRgK65HWV7E7_sFwcwnBnVp_ktS15dh).
Drive read-back showed the same filenames and byte sizes, `shared=false`, and
one owner-only permission. The folder ID is
`1AkRgK65HWV7E7_sFwcwnBnVp_ktS15dh`. Drive upload IDs and URLs were returned
only after each upload completed. The local SHA-256 manifest is stored beside
the archives and is copied to the same vault as Drive file
`1jkXBEaJlPxSUSy8KpRVA3fxd6-XVt_Eh`.

`D:` was explicitly rejected as independent evidence: Windows reports both
`C:` and `D:` as partitions on physical disk 0 (`KINGSTON SA400S37960G`).

## Phase A execution identity

- Candidate API image:
  `sha256:036bfe0f7d9f223c0136328b53c74deec4755928ca78f40bc0e8a2e96bdebbc5`
- Candidate Web image:
  `sha256:b3936e47bec669d05b7797b9c38bbab9ca9d7caac922b90b758002c6955067be`
- Migration cutoff: `2026-08-31T12:00:25.4889819Z`
- Candidate application cutoff: `2026-08-31T12:04:15.580Z`
- Pre-deploy backup: `overva-20260831T114722Z`
- Post-deploy backup: `overva-20260831T121439Z`
- Execution evidence: `PRODUCTION_PHASE_A_RELEASE_20260831T121534Z.md`

The preserved rollback tags still resolved to the original image IDs after
deployment. The mutable `latest` tags are not rollback authority.
