/**
 * Cloudflare Worker — backend "motor" do visualizador de Xianyu/Goofish.
 *
 * Guarda o token da API de scraping fora do navegador e resolve o CORS.
 * O front-end chama:  https://SEU-WORKER.workers.dev/?id=1096804187655
 *
 * Variáveis de ambiente (defina em Settings → Variables and Secrets do Worker):
 *   APIFY_TOKEN   (secret)  -> seu token do Apify (apify_api_...)
 *   APIFY_ACTOR            -> "usuario/nome-do-actor" (um scraper de Goofish/Xianyu detail)
 *   APIFY_INPUT (opcional) -> template JSON com {{url}} e {{id}}.
 *                             Padrão: {"startUrls":[{"url":"{{url}}"}]}
 *   ALLOW_ORIGIN (opcional)-> origem permitida no CORS. Padrão: "*"
 *                             (recomendo pôr a URL do seu GitHub Pages)
 */

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      });

    try {
      const url = new URL(request.url);
      const raw = url.searchParams.get("id") || url.searchParams.get("url") || "";
      const m = raw.match(/[?&]id=(\d+)/) || raw.match(/(\d{8,})/);
      const id = m ? m[1] : null;
      if (!id) return json({ ok: false, error: "id ausente ou inválido" }, 400);

      if (!env.APIFY_TOKEN || !env.APIFY_ACTOR)
        return json({ ok: false, error: "configure APIFY_TOKEN e APIFY_ACTOR no Worker" }, 500);

      const itemUrl = "https://www.goofish.com/item?id=" + id;
      const tmpl = env.APIFY_INPUT || '{"startUrls":[{"url":"{{url}}"}]}';
      const inputStr = tmpl.replace(/\{\{url\}\}/g, itemUrl).replace(/\{\{id\}\}/g, id);
      let input;
      try { input = JSON.parse(inputStr); }
      catch (e) { return json({ ok: false, error: "APIFY_INPUT não é JSON válido" }, 500); }

      const actorPath = env.APIFY_ACTOR.trim().replace("/", "~");
      const api =
        "https://api.apify.com/v2/acts/" + actorPath +
        "/run-sync-get-dataset-items?token=" + encodeURIComponent(env.APIFY_TOKEN);

      const r = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!r.ok) {
        const t = await r.text();
        return json({ ok: false, error: "Apify " + r.status + ": " + t.slice(0, 400) }, 502);
      }
      const items = await r.json();

      // devolve o array cru; o front-end extrai os campos (imagens/preço/vendedor)
      return json(Array.isArray(items) ? items : [items]);
    } catch (err) {
      return json({ ok: false, error: String(err && err.message || err) }, 500);
    }
  },
};
