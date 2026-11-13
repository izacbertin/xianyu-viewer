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

## Rotas do backend

| Rota | O que faz | Cache |
|---|---|---|
| `/api/search?q=…&sort=…&min=…&max=…` | Traduz a busca para chinês e lista até 30 anúncios | 1 h |
| `/api/item?id=…` | Anúncio completo traduzido | 6 h |
| `/api/seller?id=…` | Perfil, avaliações (as com foto primeiro) e outros anúncios | 12 h |
| `/api/health?diag=1` | Estado do serviço e um teste rápido da tradução | — |

A busca usa `unitbytes/goofish-scraper` (modo search); a tradução usa `@cf/google/gemma-4-26b-a4b-it`, com `m2m100` de reserva.

## Custos (Apify, por consulta nova; repetidas saem do cache)

- Busca com 30 resultados: ~US$ 0,065
- Anúncio: ~US$ 0,004
- Perfil do vendedor: ~US$ 0,10 (50 avaliações + 20 com foto + 12 anúncios)

O plano grátis do Apify dá US$ 5/mês. **Cloudflare**: Workers e Workers AI têm cota grátis diária.

## Limites

- O bloqueio do Goofish varia por horário. Quando o scraper não consegue, o site avisa e pede pra tentar depois.
- A tradução é automática; o botão **中文 original** mostra o texto original ao lado.
- A primeira consulta de cada link leva de 20 a 60 segundos; as seguintes abrem na hora (cache).
