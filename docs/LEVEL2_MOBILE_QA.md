# Level 2 mobile QA checklist

Run against a production build (`pnpm --filter @fitcrew/web build && pnpm --filter @fitcrew/web start`) at 390px and 640px viewport widths.

## Walkthrough matrix

| Role | Routes | Expected result |
| --- | --- | --- |
| OwnerAdmin | `/dashboard`, `/coaches`, `/organizations`, `/clients`, `/training`, `/money`, `/earnings` | All owner links are visible; forms stack to one column; no horizontal page overflow. |
| Coach | `/dashboard`, `/clients`, `/training`, `/earnings` | Only assigned clients are visible; finance and coach-management routes redirect. |
| OrgAdmin | `/dashboard`, `/organizations`, `/clients`, `/training` | Organization members and organization-assigned coaches only; finance and tenant coach management redirect. |

## Responsive acceptance criteria

- Primary navigation remains keyboard accessible and horizontally scrollable without moving the page.
- Inputs and action buttons meet the 44px touch target minimum.
- Two-column grids collapse at 900px; forms collapse at 640px.
- Text wraps within cards and rows; no horizontal scrollbar exists on `body`.
- Focus indicators remain visible and reduced-motion preferences are respected.

Browser automation is intentionally not checked in until a supported browser runner is available in CI; the matrix above is the release smoke test.
