# MASH ECO — Cloudflare R2 Media Storage & CDN Guide

## 1. Architecture Overview

MASH ECO runs a **dual-provider media architecture** (`cloudinary` + `r2`):

- **Existing Cloudinary images** continue loading from Cloudinary / `cdn.masheco.com` unchanged.
- **New uploads** route to whichever provider is selected by `MEDIA_STORAGE_PROVIDER` (`cloudinary` by default, `r2` once configured).
- **Provider-aware deletion** inspects each image's `provider` field (or URL host) and dispatches deletions to the matching provider, refusing cross-tenant R2 deletions.

## 2. Environment Variables (Backend Only)

Never expose `R2_*` credentials to any frontend app or commit `.env` to Git.

```env
MEDIA_STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=<cloudflare_account_id>
R2_ACCESS_KEY_ID=<r2_s3_access_key_id>
R2_SECRET_ACCESS_KEY=<r2_s3_secret_access_key>
R2_BUCKET_NAME=masheco-media
R2_ENDPOINT=https://<cloudflare_account_id>.r2.cloudflarestorage.com
R2_PUBLIC_URL=https://media.masheco.com
```

Keep `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` configured so legacy Cloudinary images can still be deleted when replaced or removed.

## 3. Cloudflare R2 Bucket & Domain Setup

1. Create bucket **`masheco-media`** in Cloudflare R2.
2. Disable the `r2.dev` public subdomain.
3. Under **Bucket → Settings → Custom Domains**, attach **`media.masheco.com`** (Cloudflare automatically creates the proxied DNS record and SSL).
4. Create an **R2 API Token** scoped strictly to **Object Read & Write** on the **`masheco-media`** bucket only.
5. Set `Cache-Control: public, max-age=31536000, immutable` (automatically sent by `r2.provider.ts` on every `PutObject`).

## 4. Object Key Layout & Variants

Every R2 upload uses a UUID filename (never the user's filename):

- `merchants/{tenantId}/products/{uuid}.webp` (+ `_w400.webp`, `_w100.webp`)
- `merchants/{tenantId}/categories/{uuid}.webp` (+ `_w400.webp`, `_w100.webp`)
- `merchants/{tenantId}/store/logo/{uuid}.webp` (+ `_w400.webp`, `_w100.webp`)
- `merchants/{tenantId}/store/banners/{uuid}.webp` (+ `_w400.webp`, `_w100.webp`)
- `merchants/{tenantId}/avatars/{uuid}.webp` (+ `_w400.webp`, `_w100.webp`)
- `platform/blog/{uuid}.webp` (+ `_w400.webp`, `_w100.webp`)

Frontend `imageOptimizer.ts` maps requested widths (`<=120px` → `_w100.webp`, `<=450px` → `_w400.webp`, `>450px` → `.webp`) for `media.masheco.com` URLs while keeping Cloudinary / `cdn.masheco.com` routing intact.

## 5. Upload, Replace & Delete Workflow

1. **Authenticate & Authorize**: `authMiddleware` verifies JWT and derives `tenantId`.
2. **Validate & Process** (`imageProcessor.ts`): Sharp verifies magic bytes/format (`jpeg`, `png`, `webp`), checks dimensions (`>=16px`, `<=8000px`, `<=40MP`), preserves alpha transparency on logos/PNGs, resizes within kind limits (e.g. `1200x1200` for products), and outputs WebP.
3. **Upload** (`r2.provider.ts`): Uploads main + variant objects to R2; rolls back partial writes on error.
4. **Track & Persist** (`media.service.ts`): Tracks upload on `req.uploadedMedia` for `asyncHandler` failure cleanup, saves `MediaAsset` in MongoDB (deletes R2 object if DB save fails), and increments monthly `MediaUsage`.
5. **Replace / Delete**: Old images are deleted **only after** the business document update succeeds. Failed deletes are marked `pending_delete` and retried every 15 minutes by `media.cron.ts`.

## 6. Database Changes

- Additive optional `provider?: 'cloudinary' | 'r2'` on embedded image subdocuments (`Product`, `Category`, `Theme`, `User`). Existing documents without `provider` continue working via URL inference.
- `MediaAsset` collection: tracks active, `pending_delete`, and `deleted` objects with byte sizes and variants.
- `MediaUsage` collection: monthly per-tenant and platform upload/delete counters.

## 7. Usage Tracking APIs

- `GET /api/v1/media/usage/me` (`tenant_admin`)
- `GET /api/v1/media/usage/platform` (`super_admin`)
- `GET /api/v1/media/usage/tenant/:tenantId` (`super_admin`)

## 8. Rollback & Deployment Procedure

### Safe Deployment
1. Deploy backend with `MEDIA_STORAGE_PROVIDER=cloudinary` first.
2. Run `npm run build` and `npm test`.
3. Add `R2_*` variables to production `.env` and verify in staging/canary.
4. Set `MEDIA_STORAGE_PROVIDER=r2` and restart the backend process.

### Instant Rollback
1. Set `MEDIA_STORAGE_PROVIDER=cloudinary` in `.env` and restart the backend.
2. All new uploads immediately return to Cloudinary.
3. Any images already uploaded to R2 continue serving from `https://media.masheco.com` and remain deletable by the provider-aware dispatcher.
