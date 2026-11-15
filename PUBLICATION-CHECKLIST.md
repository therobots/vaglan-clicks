# Publication check — 2026-11-15

This records the focused source review. A production hostname and operator details were not provided, so deployed behavior is not marked as passed. Recheck against the actual production deployment after the coordinated rollout.

| Check | Status | Evidence / next check |
| --- | --- | --- |
| Public audience and host policy | PENDING | `AGENTS.md` says public; production hostname not confirmed. |
| robots.txt | PENDING | `public/robots.txt` added; production response and sitemap URL need checking. |
| Sitemap | FAIL | No canonical production URL was provided, so no sitemap can be published yet. |
| Metadata and language | PENDING | Title, description, English/Greek toggle and share titles exist; canonical and language URLs need the production host. |
| Essential crawler content | PENDING | Gallery is client rendered; production rendered-content inspection remains. |
| Social preview | PENDING | OG/Twitter titles and descriptions added; absolute URL and image need production host and artwork. |
| Structured data | N/A | No claims or ratings are being published; add only when operator details are verified. |
| Errors and assets | PENDING | Check real 404 responses and preview assets on production. |
| Crawler and security separation | PENDING | Source checks add private previews; verify Storage bucket privacy, service-role separation, API limits and headers after deployment. |
| llms.txt | N/A | Not offered; optional for this gallery. |
| Search Console | PENDING | Account access and property status not provided. |
| Build and regression | PENDING | Local lint, type check, 24 unit tests, production build and 2 browser smoke tests pass; CI and deployed flows remain untested. |
| Usability | PENDING | Run phone/desktop flows and accessibility checks after deployment. |
| Security and privacy | PENDING | Inspect deployed bucket, removal link, secret exposure, and privacy disclosures. |
| Accounts and data | PENDING | Admin PIN and paid-order isolation require staging/live tests. |
| Legal and content | FAIL | `/info` still lacks the operator's real identity, contact details, and reviewed consumer terms. |
| Paid features | PENDING | Viva demo payment, webhook and download tests require configured staging credentials. |
| Operations | PENDING | Production TLS, deployment, rollback and storage backup not verified. |
