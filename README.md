# 闲鱼 Viewer — anúncios do Xianyu em português

Cole o link de um anúncio (ou de um vendedor) do Goofish/Xianyu e veja, em português: fotos, preço, descrição, reputação do vendedor, avaliações de compradores e fotos das avaliações.

## Como funciona

```
Navegador ──> index.html (GitHub Pages)
                  │  GET /api/item?id=…   /api/seller?id=…
                  ▼
            Cloudflare Worker (worker/)
              • guarda o token do Apify (secret)
              • chama os scrapers com proxy na China
              • traduz zh → pt com Workers AI
              • cache: 6 h (anúncio) / 12 h (vendedor)
                  ▼
               Apify
```

O visitante nunca vê nem informa chave nenhuma: o token fica só no Worker.

| Parte | Onde | Arquivo |
|---|---|---|
| Site | GitHub Pages | `index.html` |
| Backend | Cloudflare Workers | `worker/src/index.js`, `worker/wrangler.toml` |

Scrapers usados (Apify): `dami_studio/goofish-scraper` (anúncio) e `zen-studio/goofish-xianyu-seller-scraper` (perfil, avaliações, outros anúncios).

## Publicar o backend

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put APIFY_TOKEN   # cole o token do Apify quando pedir
npx wrangler deploy
```

Depois, coloque a URL do Worker em `API_BASE`, no começo do script do `index.html`.

`ALLOW_ORIGIN` (em `wrangler.toml`) lista os sites que podem usar o backend. Ao trocar de domínio, atualize ali.

## Custos

- **Apify**: ~US$ 0,004 por anúncio; perfil do vendedor com 30 avaliações e 12 anúncios ~US$ 0,06. O plano grátis dá US$ 5/mês.
- **Cloudflare**: Workers e Workers AI têm cota grátis diária. O cache evita pagar duas vezes pela mesma consulta.

## Limites

- O bloqueio do Goofish varia por horário. Quando o scraper não consegue, o site avisa e pede pra tentar depois.
- A tradução é automática; o botão **中文 original** mostra o texto original ao lado.
- A primeira consulta de cada link leva de 20 a 60 segundos; as seguintes abrem na hora (cache).
