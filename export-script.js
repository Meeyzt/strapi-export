(() => {
  const PAGE_SIZE = 250;
  const EXPORT_FILENAME = "strapi-export.json";
  const NAV_SELECTOR =
    'nav[aria-label="Content Manager"] li > a[href*="/content-manager/"]';

  const state = {
    token: null,
    origin: window.location.origin,
  };

  const systemTime = () => new Date().toISOString();

  const adminToken = () => {
    if (state.token) return state.token;
    const raw = window.localStorage.getItem("jwtToken");
    if (!raw) {
      throw new Error("Unable to locate admin JWT token in localStorage.");
    }
    state.token = raw.replace(/"/g, "");
    return state.token;
  };

  const requestConfig = () => ({
    method: "GET",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${adminToken()}`,
    },
    credentials: "include",
  });

  const parseLink = (href) => {
    if (!href) return null;
    const match = href.match(
      /content-manager\/(collection-types|single-types)\/([^/?]+)/i
    );
    if (!match) return null;
    return { group: match[1], uid: decodeURIComponent(match[2]) };
  };

  const collectContentTypes = () => {
    const anchors = document.querySelectorAll(NAV_SELECTOR);
    const result = {
      "collection-types": new Set(),
      "single-types": new Set(),
    };

    anchors.forEach((anchor) => {
      const parsed = parseLink(anchor.getAttribute("href"));
      if (parsed) result[parsed.group].add(parsed.uid);
    });

    return {
      "collection-types": Array.from(result["collection-types"]).sort(),
      "single-types": Array.from(result["single-types"]).sort(),
    };
  };

  const buildUrl = (group, uid, page) => {
    const url = new URL(
      `${state.origin}/content-manager/${group}/${encodeURIComponent(uid)}?populate=*`
    );
    url.searchParams.set("populate", "*");
    url.searchParams.set("pagination[pageSize]", PAGE_SIZE.toString());
    if (page) {
      url.searchParams.set("pagination[page]", page.toString());
    }
    return url.toString();
  };

  const fetchJson = async (url) => {
    const res = await fetch(url, requestConfig());
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`${res.status} ${res.statusText} → ${url}\n${body}`);
    }
    return res.json();
  };

  const fetchCollection = async (uid) => {
    const entries = [];
    let page = 1;
    let paginationMeta = null;

    while (true) {
      const payload = await fetchJson(buildUrl("collection-types", uid, page));
      const pageEntries = payload.results ?? payload.data ?? [];
      paginationMeta = payload.meta?.pagination ?? null;
      entries.push(...pageEntries);

      const pageCount = paginationMeta?.pageCount ?? 1;
      if (page >= pageCount || pageEntries.length === 0) break;
      page += 1;
    }

    return { entries, pagination: paginationMeta };
  };

  const fetchSingle = async (uid) => {
    const payload = await fetchJson(buildUrl("single-types", uid));
    return payload.data ?? payload;
  };

  const download = (data) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = EXPORT_FILENAME;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const run = async () => {
    console.log("⏳ Starting Strapi export…");
    const collections = collectContentTypes();
    const exportPayload = {
      meta: {
        exportedAt: systemTime(),
        source: state.origin,
        formatVersion: 1,
        pageSize: PAGE_SIZE,
      },
      "collection-types": {},
      "single-types": {},
    };

    for (const uid of collections["collection-types"]) {
      try {
        const { entries, pagination } = await fetchCollection(uid);
        exportPayload["collection-types"][uid] = {
          kind: "collectionType",
          meta: {
            count: entries.length,
            pagination,
            fetchedAt: systemTime(),
          },
          data: entries,
          results: entries,
        };
        console.log(
          `✔ Exported collection ${uid} (${entries.length} entries)`
        );
      } catch (error) {
        console.error(`❌ Failed to export collection ${uid}`, error);
      }
    }

    for (const uid of collections["single-types"]) {
      try {
        const record = await fetchSingle(uid);
        exportPayload["single-types"][uid] = {
          kind: "singleType",
          meta: {
            fetchedAt: systemTime(),
          },
          data: record ?? null,
        };
        console.log(`✔ Exported single ${uid}`);
      } catch (error) {
        console.error(`❌ Failed to export single ${uid}`, error);
      }
    }

    download(exportPayload);
    console.log("🎉 Export finished. Downloaded", EXPORT_FILENAME);
  };

  run().catch((error) => {
    console.error("Export failed:", error);
  });
})();
