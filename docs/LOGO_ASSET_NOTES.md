# LOGO_ASSET_NOTES.md

## Session
- Date: 2026-02-06
- Session: 8.4
- Scope: logo-only update (no broader UI/layout redesign)

## Source Asset
- User-provided vector file: `/Users/bhavyakhimavat/Desktop/episteme_mark_final_vectorized.svg`

## Canonical Logo Files
- Source copies:
  - `/Users/bhavyakhimavat/Desktop/episteme/output/imagegen/logo/episteme_mark_final.svg`
  - `/Users/bhavyakhimavat/Desktop/episteme/output/imagegen/logo/episteme_mark_alt.svg`
- Runtime assets:
  - `/Users/bhavyakhimavat/Desktop/episteme/public/brand/episteme-mark.svg`
  - `/Users/bhavyakhimavat/Desktop/episteme/public/brand/episteme-mark.png`
  - `/Users/bhavyakhimavat/Desktop/episteme/public/brand/episteme-mark-32.png`
  - `/Users/bhavyakhimavat/Desktop/episteme/src/app/favicon.ico`

## Integration Points
- Topbar brand icon:
  - `/Users/bhavyakhimavat/Desktop/episteme/src/components/topbar/TopBar.tsx`
- App metadata icons/favicons:
  - `/Users/bhavyakhimavat/Desktop/episteme/src/app/layout.tsx`

## Notes
- Topbar now uses `/brand/episteme-mark.svg` for crisp scaling.
- Metadata icons include SVG + PNG fallback entries.
- Favicon `.ico` regenerated from the same logo source to keep browser compatibility.
