import fs from "fs/promises";
import path from "node:path";
import process from "process";
import fetch from "node-fetch";

const DEFAULT_STRAPI_URL = "http://localhost:1337";
const ROOT_IMMUTABLE_FIELDS = new Set([
  "id",
  "documentId",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "createdBy",
  "updatedBy",
  "localizations",
  // IF YOU WANT TO ADD MORE ROOT IMMUTABLE FIELDS, ADD THEM HERE
]);
const NESTED_IMMUTABLE_FIELDS = new Set([
  "id",
  "documentId",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "createdBy",
  "updatedBy",
  "localizations",
  // IF YOU WANT TO ADD MORE NESTED IMMUTABLE FIELDS, ADD THEM HERE
]);
const DEFAULT_PROTECTED_UIDS = [
  "api::header.header",
  "api::footer.footer",
  "api::global.global",
  "api::dealer-list.dealer-list",
  // IF YOU WANT TO ADD MORE PROTECTED UIDS, ADD THEM HERE
];

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [key, rawValue] = token.split("=");
    const name = key.replace(/^--/, "");
    if (rawValue !== undefined) {
      args[name] = rawValue;
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      args[name] = argv[i + 1];
      i += 1;
    } else {
      args[name] = true;
    }
  }
  return args;
};

const cliArgs = parseArgs(process.argv.slice(2));

const resolveStringList = (value) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const parseBoolean = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
};

const parseOrder = (value) =>
  resolveStringList(value).map((uid) => uid.trim());

const STRAPI_URL ="http://localhost:1337";
  // cliArgs.url ?? process.env.STRAPI_URL ?? DEFAULT_STRAPI_URL;
const EXPORT_PATH = path.resolve(
  process.cwd(),
  cliArgs.file ?? "./strapi-export.json"
);
const TOKEN =
"009c2b9476758106c8882ef1891c39530b8fbd21b1b7f2ce40838c52259c3df5a8c5e34642073d4f83c9398f784671970bd9d400f2a48ce0b51db71257fb8ca3cc50e0ed7a6e72f0c8e22f434970f0109743e48b733b4d17067d798be7c9f975af260e470a354aee7a64683ad6d5a3b2b07a6c9c55b188ca43c914830fd2ae1c";
  // cliArgs.token ??
  // process.env.STRAPI_ADMIN_TOKEN ??
  // process.env.STRAPI_TOKEN;
const includeProtected =
  parseBoolean(cliArgs["include-protected"]) ??
  parseBoolean(process.env.STRAPI_INCLUDE_PROTECTED) ??
  false;
const manualOrder = parseOrder(
  cliArgs.order ?? process.env.STRAPI_IMPORT_ORDER ?? ""
);

if (!TOKEN) {
  throw new Error(
    "Missing Strapi Admin token. Provide --token, STRAPI_ADMIN_TOKEN, or STRAPI_TOKEN."
  );
}

const protectedUids = new Set([
  ...(includeProtected ? [] : DEFAULT_PROTECTED_UIDS),
  ...resolveStringList(process.env.STRAPI_PROTECTED_UIDS),
  ...resolveStringList(cliArgs.protected ?? ""),
]);
const detectedProtectedUids = new Set();

const stats = {
  items: 0,
  created: 0,
  skipped: 0,
  failed: 0,
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

const stripFields = (value, depth = 0) => {
  if (Array.isArray(value)) {
    return value.map((entry) => stripFields(entry, depth + 1));
  }
  if (value && typeof value === "object") {
    const source = depth === 0 ? ROOT_IMMUTABLE_FIELDS : NESTED_IMMUTABLE_FIELDS;
    return Object.entries(value).reduce((acc, [key, val]) => {
      if (source.has(key)) return acc;
      acc[key] = stripFields(val, depth + 1);
      return acc;
    }, {});
  }
  return value;
};

const detectKind = (payload, group) => {
  if (payload?.kind === "collectionType" || payload?.kind === "singleType") {
    return payload.kind;
  }
  if (group === "collection-types") return "collectionType";
  if (group === "single-types") return "singleType";
  if (Array.isArray(payload?.results) || Array.isArray(payload?.data)) {
    return "collectionType";
  }
  return "singleType";
};

const adminUrl = (pathname) => new URL(pathname, STRAPI_URL).toString();

const safeParse = (text) => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
};

const adminRequest = async (method, pathname, body) => {
  const response = await fetch(adminUrl(pathname), {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  const parsed = safeParse(raw);

  if (!response.ok) {
    const error = new Error(
      `HTTP ${response.status} ${response.statusText} → ${pathname}`
    );
    error.status = 'published';
    error.body = parsed;
    throw error;
  }
  return parsed;
};

const extractCollectionEntries = (payload) => {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.entries)) return payload.entries;
  return [];
};

const encodeUid = (uid) => encodeURIComponent(uid);

const importCollectionType = async (uid, payload) => {
  const entries = extractCollectionEntries(payload);
  if (!entries.length) {
    log(`ℹ No entries found for ${uid}, skipping.`);
    return;
  }

  log(`⏳ Importing ${entries.length} entries for ${uid}`);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = stripFields(entries[index]);
    stats.items += 1;

    try {
      await adminRequest(
        "POST",
        `/content-manager/collection-types/${encodeUid(uid)}`,
        entry
      );
      stats.created += 1;
      log(`✔ (${index + 1}/${entries.length}) ${uid}`);
    } catch (error) {
      if (error.status === 405) {
        log(
          `⛔ ${uid} is protected (405). Skipping remaining entries for this model.`
        );
        detectedProtectedUids.add(uid);
        stats.skipped += entries.length - index;
        return;
      }

      stats.failed += 1;
      log(`❌ Failed to import ${uid} entry ${index + 1}`, error.body ?? "");
    }
  }
};

const importSingleType = async (uid, payload) => {
  const record = payload?.data ?? payload;
  if (!record || typeof record !== "object") {
    log(`ℹ No data for single type ${uid}, skipping.`);
    stats.skipped += 1;
    return;
  }

  stats.items += 1;
  try {
    await adminRequest(
      "PUT",
      `/content-manager/single-types/${encodeUid(uid)}`,
      stripFields(record)
    );
    stats.created += 1;
    log(`✔ Updated single type ${uid}`);
  } catch (error) {
    if (error.status === 405) {
      log(`⛔ ${uid} is protected (405). Skipping.`);
      detectedProtectedUids.add(uid);
      stats.skipped += 1;
      return;
    }

    stats.failed += 1;
    log(`❌ Failed to import single type ${uid}`, error.body ?? "");
  }
};

const loadExportFile = async () => {
  const raw = await fs.readFile(EXPORT_PATH, "utf8");
  return JSON.parse(raw);
};

const iterateGroups = (json) => ({
  "collection-types": json["collection-types"] ?? {},
  "single-types": json["single-types"] ?? {},
});

const shouldSkipUid = (uid) =>
  protectedUids.has(uid) || detectedProtectedUids.has(uid);

const sortEntriesWithManualOrder = (entries) => {
  if (!manualOrder.length) {
    return [...entries].sort(([a], [b]) => a.localeCompare(b));
  }

  const priority = new Map(
    manualOrder.map((uid, index) => [uid, index])
  );

  const maxPriority = manualOrder.length;

  return [...entries].sort(([uidA], [uidB]) => {
    const aPriority = priority.has(uidA) ? priority.get(uidA) : maxPriority;
    const bPriority = priority.has(uidB) ? priority.get(uidB) : maxPriority;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return uidA.localeCompare(uidB);
  });
};

const importAll = async () => {
  if (includeProtected) {
    log(
      "⚠ include-protected flag enabled. Default protected UID list disabled."
    );
  }
  log("Loading export file:", EXPORT_PATH);
  const exportData = await loadExportFile();
  const groups = iterateGroups(exportData);

  for (const [groupName, collection] of Object.entries(groups)) {
    if (!collection || typeof collection !== "object") continue;

    const entries = sortEntriesWithManualOrder(Object.entries(collection));
    for (const [uid, payload] of entries) {
      if (uid === "meta") continue;

      const kind = detectKind(payload, groupName);
      if (shouldSkipUid(uid)) {
        const skipCount =
          kind === "collectionType"
            ? extractCollectionEntries(payload).length || 1
            : 1;
        log(`⏩ Skipping protected model ${uid}`);
        stats.skipped += skipCount;
        continue;
      }

      if (kind === "collectionType") {
        await importCollectionType(uid, payload);
      } else {
        await importSingleType(uid, payload);
      }
    }
  }

  log(
    `\nSummary → created: ${stats.created}, skipped: ${stats.skipped}, failed: ${stats.failed}, processed entries: ${stats.items}`
  );

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
};

importAll().catch((error) => {
  console.error("Import crashed:", error);
  process.exitCode = 1;
});
