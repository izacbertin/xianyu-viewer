/**
 * Backend do visualizador de anúncios do Goofish/Xianyu (Cloudflare Worker).
 *
 * Guarda o token do Apify (secret APIFY_TOKEN), chama os scrapers, traduz
 * os textos para português com o Workers AI e guarda o resultado em cache.
 *
 *   GET /api/item?id=<id do anúncio ou link>
 *   GET /api/seller?id=<id do vendedor>
 *   GET /api/health
 */

const ITEM_ACTOR = "dami_studio/goofish-scraper";
const SELLER_ACTOR = "zen-studio/goofish-xianyu-seller-scraper";
const PHOTO_REVIEW_ACTOR = "unitbytes/goofish-scraper";

const LLM_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const FALLBACK_MODEL = "@cf/meta/m2m100-1.2b";

const CACHE_VERSION = "v4";
const ITEM_CACHE_SECONDS = 6 * 3600;
const SELLER_CACHE_SECONDS = 12 * 3600;
const FETCH_REVIEWS = 50;        // asked from the scraper (many are empty placeholders)
const FETCH_PHOTO_REVIEWS = 20;
const MAX_REVIEWS = 40;          // shown after filtering
const MAX_LISTINGS = 12;

const CONDITION_PT = {
  "brand new": "Novo",
  "new": "Novo",
  "like new": "Seminovo",
  "almost new": "Quase novo",
  "lightly used": "Pouco usado",
  "slightly used": "Pouco usado",
  "used": "Usado",
  "visibly used": "Com marcas de uso",
  "heavily used": "Muito usado",
  "for parts": "Para peças",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOW_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
    const allowOrigin = allowed.includes("*") ? "*" : (origin && allowed.includes(origin) ? origin : allowed[0]);
    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };
    const json = (obj, status = 200, extra = {}) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors, ...extra },
      });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405);

    // Browsers send Origin on cross-site fetches: refuse sites other than ours.
    if (origin && !allowed.includes("*") && !allowed.includes(origin)) {
      return json({ ok: false, error: "forbidden_origin" }, 403);
    }

    if (url.pathname === "/api/health") {
      const out = { ok: true, apifyToken: Boolean(env.APIFY_TOKEN), ai: Boolean(env.AI) };
      if (url.searchParams.get("diag")) {
        // Translates one fixed sentence so the model can be checked without spending Apify credit.
        const t0 = Date.now();
        diag.length = 0;
        const sample = await translateMany(env, DIAG_SAMPLE);
        out.sample = sample[0]; out.ms = Date.now() - t0; out.problems = diag.slice(-5);
      }
      return json(out);
    }

    const route = url.pathname === "/api/item" ? "item" : url.pathname === "/api/seller" ? "seller" : null;
    if (!route) return json({ ok: false, error: "not_found" }, 404);
    if (!env.APIFY_TOKEN) return json({ ok: false, error: "server_not_configured" }, 500);

    const id = extractId(url.searchParams.get("id") || "", route);
    if (!id) return json({ ok: false, error: "bad_id" }, 400);

    // Cache by route + id only, so different query strings share one entry.
    const cacheKey = new Request(`https://cache.internal/${CACHE_VERSION}/${route}/${id}`);
    const cache = caches.default;
    const hit = await cache.match(cacheKey);
    if (hit) {
      const body = await hit.text();
      return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", ...cors, "X-Cache": "HIT" } });
    }

    let result;
    try {
      result = route === "item" ? await getItem(env, id) : await getSeller(env, id);
    } catch (err) {
      const e = err instanceof ApifyError ? err : null;
      return json({ ok: false, error: e ? e.code : "internal_error", detail: String(err && err.message || err).slice(0, 300) }, e ? e.status : 500);
    }

    const ttl = route === "item" ? ITEM_CACHE_SECONDS : SELLER_CACHE_SECONDS;
    const body = JSON.stringify(result);
    if (result.ok) {
      ctx.waitUntil(cache.put(cacheKey, new Response(body, {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${ttl}` },
      })));
    }
    return new Response(body, {
      status: result.ok ? 200 : 404,
      headers: { "Content-Type": "application/json; charset=utf-8", ...cors, "X-Cache": "MISS" },
    });
  },
};

// ---------------------------------------------------------------- input

function extractId(raw, route) {
  raw = String(raw).trim();
  const m = route === "seller"
    ? raw.match(/userId=(\d+)/) || raw.match(/^(\d{5,})$/)
    : raw.match(/[?&]id=(\d+)/) || raw.match(/(\d{8,})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------- Apify

class ApifyError extends Error {
  constructor(code, status, message) { super(message); this.code = code; this.status = status; }
}

async function runActor(env, actor, input) {
  const api = `https://api.apify.com/v2/acts/${actor.replace("/", "~")}/run-sync-get-dataset-items` +
    `?token=${encodeURIComponent(env.APIFY_TOKEN)}&timeout=240`;
  const r = await fetch(api, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (r.status === 401) throw new ApifyError("apify_auth", 502, "Apify token rejected");
  if (r.status === 402) throw new ApifyError("apify_credit", 502, "Apify account out of credit");
  if (r.status === 408) throw new ApifyError("timeout", 504, "Scraper took too long");
  if (!r.ok) throw new ApifyError("apify_error", 502, `Apify ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [data];
}

// ---------------------------------------------------------------- item

async function getItem(env, id) {
  const rows = await runActor(env, ITEM_ACTOR, {
    itemUrls: [`https://www.goofish.com/item?id=${id}`],
    maxItems: 1,
    includeDescription: true,
  });
  const item = rows.find((r) => r && (r.title || r.itemId));
  if (!item) {
    const note = rows.map((r) => r && (r.note || r.message || r.error || r.reason)).find(Boolean);
    return { ok: false, error: "not_found_or_blocked", detail: note || null };
  }

  const specs = item.specs && typeof item.specs === "object" ? item.specs : {};
  const keys = Object.keys(specs);
  const vals = keys.map((k) => (typeof specs[k] === "string" ? specs[k] : null));
  const base = [
    item.title,
    item.description,
    item.sellerLastSeen,
    [item.city, item.district].filter(Boolean).join(" "),
    item.sellerZhimaCredit,
    item.sellerReplyTime,
  ];
  const tr = await translateMany(env, [...base, ...keys, ...vals]);
  const cond = item.conditionText ? CONDITION_PT[String(item.conditionText).toLowerCase()] || item.conditionText : null;

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    item,
    pt: {
      title: tr[0],
      description: tr[1],
      sellerLastSeen: tr[2],
      location: tr[3],
      sellerCredit: tr[4],
      sellerReplyTime: tr[5],
      condition: cond,
      specs: keys.length ? keys.map((k, i) => ({
        key: tr[base.length + i] || k,
        value: vals[i] == null ? specs[k] : (tr[base.length + keys.length + i] || vals[i]),
      })) : null,
    },
  };
}

// ---------------------------------------------------------------- seller

// Goofish fills transactions nobody reviewed with a fixed sentence and folds them away.
const PLACEHOLDER = /未做出评价|系统默认|默认好评/;

function isRealReview(r) {
  if (!r) return false;
  if (r.reviewLane && /folded/.test(r.reviewLane)) return false;
  if (typeof r.text === "string" && PLACEHOLDER.test(r.text)) return false;
  return Boolean(r.text || (r.imageUrls && r.imageUrls.length));
}

/** Maps a row of the photo-review scraper to the shape the main scraper uses. */
function normalizePhotoReview(r) {
  const item = r.tradedItem || r.item || {};
  const images = r.reviewImages || r.imageUrls || r.images || [];
  return {
    rateId: r.reviewId || r.rateId || r.id,
    rating: r.ratingType || r.rating || null,
    text: r.feedbackText || r.text || r.content || "",
    reviewerRole: r.raterRole || r.reviewerRole || null,
    reviewerName: r.raterName || r.reviewerName || r.raterNick || null,
    reviewerAvatarUrl: r.raterAvatar || r.reviewerAvatarUrl || null,
    reviewerIpProvince: r.raterLocation || r.reviewerIpProvince || null,
    dateLabel: r.feedbackDate || r.dateLabel || null,
    at: r.feedbackAt || r.at || null,
    // this scraper puts the reviewer's role ("买家"/"卖家") in tags; the role has its own field
    tags: (Array.isArray(r.tags) ? r.tags : []).filter((t) => typeof t === "string" && !/^(买家|卖家)$/.test(t)),
    itemId: item.id ? String(item.id) : null,
    itemPrice: item.price != null ? item.price : null,
    tradeInfo: item.title ? { itemTitle: item.title, itemPic: item.picUrl || item.image || null } : null,
    imageUrls: (Array.isArray(images) ? images : []).map((x) => (typeof x === "string" ? x : x && x.url)).filter(Boolean),
  };
}

async function getPhotoReviews(env, id) {
  try {
    const rows = await runActor(env, PHOTO_REVIEW_ACTOR, {
      mode: "seller",
      sellerInputs: [`https://www.goofish.com/personal?userId=${id}`],
      includeListings: false,
      includeReviews: true,
      maxReviews: FETCH_PHOTO_REVIEWS,
      reviewFilter: "with_photos",
      outputFormat: "nested",
    });
    const nested = rows.flatMap((r) => (r && Array.isArray(r.reviews) ? r.reviews : []));
    // "tabular" style rows, in case the actor ignores outputFormat
    const flat = rows.filter((r) => r && (r.feedbackText || r.reviewImages) && !Array.isArray(r.reviews));
    return [...nested, ...flat].map(normalizePhotoReview).filter((r) => r.imageUrls.length);
  } catch (e) {
    return []; // best effort: the page still works without photo reviews
  }
}

async function getSeller(env, id) {
  const [rows, photoReviews] = await Promise.all([
    runActor(env, SELLER_ACTOR, {
      sellerInputs: [`https://www.goofish.com/personal?userId=${id}`],
      includeListings: true,
      includeReviews: true,
      deepListings: false,
      maxListings: MAX_LISTINGS,
      maxReviews: FETCH_REVIEWS,
    }),
    getPhotoReviews(env, id),
  ]);
  const seller = rows.find((r) => r && r.rowType === "seller") || rows.find((r) => r && r.displayName);
  if (!seller || seller.rowStatus === "error") {
    return { ok: false, error: "not_found_or_blocked", detail: seller && seller.detailError || null };
  }

  const fetched = Array.isArray(seller.reviews) ? seller.reviews : [];
  const real = fetched.filter(isRealReview);
  // Photo reviews first, then the rest, without repeating the same review.
  const seen = new Set();
  const reviews = [...photoReviews, ...real].filter((r) => {
    const k = r.rateId != null ? String(r.rateId) : null;
    if (k && seen.has(k)) return false;
    if (k) seen.add(k);
    return true;
  }).slice(0, MAX_REVIEWS);

  const listings = (Array.isArray(seller.listings) ? seller.listings
    : rows.filter((r) => r && r.rowType === "listing")).slice(0, MAX_LISTINGS);

  // One batch for every Chinese string on the page.
  const head = [seller.bio, seller.creditBadge && seller.creditBadge.text, seller.ipProvince];
  const texts = [
    ...head,
    ...reviews.map((r) => r.text),
    ...reviews.map((r) => r.tradeInfo && r.tradeInfo.itemTitle),
    ...reviews.map((r) => r.reviewerIpProvince),
    ...listings.map((l) => l.title),
  ];
  const tagList = [...new Set(reviews.flatMap((r) => (Array.isArray(r.tags) ? r.tags : [])))];
  const tr = await translateMany(env, [...texts, ...tagList]);
  const tagPt = Object.fromEntries(tagList.map((t, i) => [t, tr[texts.length + i] || t]));

  let i = head.length;
  const reviewText = reviews.map(() => tr[i++]);
  const reviewItem = reviews.map(() => tr[i++]);
  const reviewProv = reviews.map(() => tr[i++]);
  const listingTitle = listings.map(() => tr[i++]);

  // Keep the payload small: drop the nested arrays we re-emit below.
  const { reviews: _r, listings: _l, ...profile } = seller;

  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    seller: profile,
    pt: { bio: tr[0], creditText: tr[1], province: tr[2] },
    reviewInfo: {
      fetched: fetched.length,
      withoutComment: fetched.length - real.length,
      withPhotos: reviews.filter((r) => r.imageUrls && r.imageUrls.length).length,
    },
    reviews: reviews.map((r, k) => ({
      ...r,
      pt: {
        text: reviewText[k],
        itemTitle: reviewItem[k],
        province: reviewProv[k],
        tags: (r.tags || []).map((t) => tagPt[t] || t),
      },
    })),
    listings: listings.map((l, k) => ({ ...l, pt: { title: listingTitle[k] } })),
  };
}

// ---------------------------------------------------------------- translation

const CJK = /[㐀-鿿豈-﫿]/;
const BATCH_ITEMS = 24;
const BATCH_CHARS = 2400;

const SYSTEM_PROMPT =
  "Você é tradutor de chinês para português do Brasil, especializado em anúncios de produtos usados " +
  "(Xianyu/Goofish). Recebe um objeto JSON cujos valores são textos em chinês e devolve SOMENTE um objeto JSON " +
  "com as mesmas chaves e os valores traduzidos. Regras: tradução natural e fiel, sem acrescentar nem omitir " +
  "informação; preserve quebras de linha, números, preços, modelos e códigos; mantenha marcas e nomes de produtos " +
  "na forma usada no Brasil (任天堂 = Nintendo, 塞尔达传说 = The Legend of Zelda, 星之卡比 = Kirby, 苹果 = Apple, " +
  "顺丰 = SF Express); 成色 = estado de conservação; 全新 = novo; 包邮 = frete grátis; 港版/日版/国行 = versão de " +
  "Hong Kong/japonesa/chinesa; 擦亮 = anúncio atualizado (\"刚刚擦亮\" = \"anúncio atualizado agora\"); 来过 = esteve online; 收 no início de um título = \"Compro\". Nomes de províncias e cidades em português " +
  "(上海 = Xangai, 广东 = Guangdong, 北京 = Pequim). Não explique nada.";

const DIAG_SAMPLE = ["全新未拆封，顺丰包邮，多买多省，每多带1台立减5元"];

/** Translates an array of strings zh→pt. Non-Chinese / empty entries pass through. */
async function translateMany(env, list) {
  const out = list.map((s) => (typeof s === "string" ? s : s == null ? null : String(s)));
  if (!env.AI) return out;
  const unique = [...new Set(out.filter((s) => s && CJK.test(s)))];
  if (!unique.length) return out;

  const batches = [];
  let cur = [], size = 0;
  for (const s of unique) {
    if (cur.length && (cur.length >= BATCH_ITEMS || size + s.length > BATCH_CHARS)) { batches.push(cur); cur = []; size = 0; }
    cur.push(s); size += s.length;
  }
  if (cur.length) batches.push(cur);

  const done = new Map();
  await pool(batches, 4, async (batch) => {
    const res = await translateBatch(env, batch);
    batch.forEach((s, k) => { if (res[k]) done.set(s, res[k]); });
  });

  // Anything the LLM missed goes through the plain translation model (bounded).
  const missing = unique.filter((s) => !done.has(s)).slice(0, 20);
  await pool(missing, 5, async (s) => { done.set(s, await translatePlain(env, s)); });

  return out.map((s) => (s && done.has(s) ? done.get(s) : s));
}

async function translateBatch(env, batch) {
  const payload = {};
  batch.forEach((s, k) => { payload["t" + (k + 1)] = s; });
  try {
    const input = {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 6000,
      // Without this the model "thinks" first and a full listing takes minutes instead of seconds.
      chat_template_kwargs: { enable_thinking: false },
    };
    const r = await env.AI.run(LLM_MODEL, input);
    const content = extractContent(r);
    const obj = parseJsonObject(content);
    if (!obj) diag.push("unparsed: " + (content ? content.slice(0, 160) : "empty; keys=" + Object.keys(r || {}).join(",") + " " + JSON.stringify(r).slice(0, 200)));
    return batch.map((_, k) => {
      const v = obj && obj["t" + (k + 1)];
      return typeof v === "string" && v.trim() ? v : null;
    });
  } catch (e) {
    diag.push("error: " + String(e && e.message || e).slice(0, 200));
    return batch.map(() => null);
  }
}

// Last translation problems, exposed by /api/health?diag=1 (no user data beyond short snippets).
const diag = [];

function extractContent(r) {
  if (!r) return "";
  if (typeof r === "string") return r;
  if (r.choices && r.choices[0] && r.choices[0].message) {
    const c = r.choices[0].message.content;
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : p && p.text) || "").join("");
  }
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  return "";
}

function parseJsonObject(text) {
  if (!text) return null;
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { const o = JSON.parse(text.slice(a, b + 1)); return o && typeof o === "object" ? o : null; }
  catch (e) { return null; }
}

async function translatePlain(env, text) {
  try {
    const parts = text.split(/(\n+)/);
    const res = [];
    for (const part of parts) {
      if (!part || /^\n+$/.test(part) || !CJK.test(part)) { res.push(part); continue; }
      const r = await env.AI.run(FALLBACK_MODEL, { text: part.slice(0, 400), source_lang: "zh", target_lang: "pt" });
      res.push((r && r.translated_text) || part);
    }
    return res.join("");
  } catch (e) {
    return text;
  }
}

async function pool(items, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const k = next++; await fn(items[k]); }
  });
  await Promise.all(workers);
}
