## Strapi Export / Import Toolkit

This directory contains a browser-side exporter (`export-script.js`) and a Node CLI importer (`import.js`) designed for Strapi v4+ production environments. They intentionally avoid any Content-Type Builder or other development-only APIs and rely only on the stable Content Manager endpoints.

---

### `export-script.js` (Admin UI bookmarklet/script)

1. Open your Strapi Admin panel in production and log in with an account that has Content Manager access to every type you plan to export.
2. Paste the script into the browser console or run it via a bookmarklet.
3. The script crawls `nav[aria-label="Content Manager"]`, detects every collection and single type, and fetches each type through `/content-manager/{collection-types|single-types}/{uid}?populate=*&pagination[pageSize]=250`.
4. Pagination is handled automatically until every entry is fetched. Each type payload receives metadata (`kind`, `count`, `fetchedAt`, source URL, etc.).
5. A `strapi-export.json` file downloads automatically.

> The export format keeps both `data` and `results` keys for collection types so older exports remain backward compatible, while also carrying richer metadata for the new importer.

---

### `import.js` (Node CLI)

The importer recreates the exported data by calling the Admin API:

```
node import.js \
  --file=./strapi-export.json \
  --url=https://your-strapi-host \
  --token=<ADMIN_API_TOKEN> \
  --include-protected=true \
  --order=api::category.category,api::article.article
```

**Key behaviours**

- Reads the exported JSON, determines each UID’s kind, and strips Strapi-managed fields (`id`, timestamps, `documentId`, `localizations`, etc.) so payloads resemble what the Admin UI sends.
- Uses the same `/content-manager/{collection-types|single-types}` endpoints the UI uses; each collection entry is `POST`ed as-is, each single type is `PUT`ed once.
- Tracks stats (created/skipped/failed) and stops retrying a UID if Strapi returns `405 Method Not Allowed`.
  **CLI / env options**

| Option / Env                                       | Description                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `--file` / `STRAPI_EXPORT_FILE`                    | Path to `strapi-export.json` (default `./strapi-export.json`).                                                                  |
| `--url` / `STRAPI_URL`                             | Base URL of the target Strapi instance (default `http://localhost:1337`).                                                       |
| `--token` / `STRAPI_ADMIN_TOKEN` / `STRAPI_TOKEN`  | Admin API token (required).                                                                                                     |
| `--include-protected` / `STRAPI_INCLUDE_PROTECTED` | When `true`, disables the built-in protected UID list so everything is attempted.                                               |
| `--protected` / `STRAPI_PROTECTED_UIDS`            | Additional comma-separated UIDs to skip (even if `--include-protected` is on).                                                  |
| `--order` / `STRAPI_IMPORT_ORDER`                  | Comma-separated list of UIDs to force ordering (useful for dependency chains; keys not listed fall back to alphabetical order). |

> Tokens are never stored; provide them per run through CLI flag or environment variable.

---

### Protected Content Types

Strapi blocks certain single types in production (`api::header.header`, `api::global.global`, etc.). By default, the importer skips a curated list and auto-detects any other UID that returns `405`. Use `--include-protected=true` only if you know your project allows REST writes to those types.

---

### Recommended Workflow

1. **Export** content from the source environment using the Admin script.
2. Inspect/commit the resulting `strapi-export.json`.
3. **Import** into the target environment with the CLI, providing the correct Admin token and URL.
4. Review the importer’s summary; rerun after resolving any logged failures.

This toolset is intended for content migration and seeding scenarios. For schema changes use Strapi migrations or the Content-Type Builder in development.\*\*\*
