# 闲鱼 Viewer — anúncios do Xianyu em português

Pesquise no Goofish/Xianyu em português: lista de anúncios, anúncio completo traduzido, perfil do vendedor com avaliações e fotos das avaliações, e link pronto pra copiar pro agente de compras.

**Site:** https://izacbertin.github.io/xianyu-viewer/

## Como funciona

```
Navegador ──> index.html (GitHub Pages)          extension/ (Chrome)
                  │                                  │ leva do goofish.com pro site
                  │  /api/search  /api/item  /api/seller  /api/seller-photos
                  ▼
            Cloudflare Worker (worker/)
              • guarda o token do Apify (secret)
              • chama os scrapers com proxy na China
              • traduz zh → pt com Workers AI
              • cache permanente em Workers KV
                  ▼
               Apify
```

| Parte | Onde | Arquivos |
|---|---|---|
| Site | GitHub Pages | `index.html` |
| Backend | Cloudflare Workers | `worker/src/index.js`, `worker/wrangler.toml` |
| Extensão | Chrome (carregada sem a loja) | `extension/` |

## Rotas do backend

| Rota | O que faz | Cache |
|---|---|---|
| `/api/search?q=…&sort=…&min=…&max=…` | Traduz a busca pra chinês e lista 20 anúncios (`&more=1`: 40) | 6 h |
| `/api/item?id=…` | Anúncio completo traduzido | 24 h |
| `/api/seller?id=…` | Perfil, 25 avaliações recentes e 12 anúncios | 3 dias |
| `/api/seller-photos?id=…` | Avaliações com foto (só quando o visitante pede) | 3 dias |
| `/api/health?diag=1` | Estado do serviço e um teste rápido da tradução | — |

Scrapers (Apify): `dami_studio/goofish-scraper` (anúncio), `zen-studio/goofish-xianyu-seller-scraper` (perfil), `unitbytes/goofish-scraper` (busca e avaliações com foto). Tradução: `@cf/google/gemma-4-26b-a4b-it`, com `m2m100` de reserva.

## Custos (Apify, por consulta nova; repetidas saem do cache sem custo)

| Consulta | Custo aproximado |
|---|---|
| Busca (20 resultados) | US$ 0,045 |
| "Ver mais" (40 resultados) | US$ 0,085 |
| Anúncio | US$ 0,004 |
| Perfil do vendedor | US$ 0,05 |
| Avaliações com foto (botão) | US$ 0,03 |

O plano grátis do Apify dá US$ 5/mês. Defina um limite de gasto mensal no console do Apify (Billing) para nunca ter surpresa. Cloudflare Workers, Workers AI e KV têm cota grátis diária.

## Extensão do Chrome

Reconhece anúncio, vendedor ou busca no goofish.com e abre no Viewer (automático, ou por um botão amarelo na página). Também adiciona ao clique direito "Abrir no Viewer" (em links do Goofish) e "Buscar no Viewer" (em texto selecionado).

Instalar: `chrome://extensions` → ligar **Modo do desenvolvedor** → **Carregar sem compactação** → escolher a pasta `extension`. A pasta precisa continuar no lugar: o Chrome carrega a extensão dela a cada abertura.

O botão "Abrir no Goofish" do Viewer adiciona `#xv-stay` ao link, para a extensão não mandar de volta.

## Publicar o backend

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create xianyu-viewer-cache   # coloque o id em wrangler.toml
npx wrangler secret put APIFY_TOKEN                    # cole o token do Apify quando pedir
npx wrangler deploy
```

Depois, coloque a URL do Worker em `API_BASE`, no começo do script do `index.html`. `ALLOW_ORIGIN` (em `wrangler.toml`) lista os sites que podem usar o backend.

## Limites

- O bloqueio do Goofish varia por horário. Quando o scraper não consegue, o site avisa e pede pra tentar depois.
- A tradução é automática; o botão **中文 original** mostra o texto original ao lado.
- A primeira consulta de cada busca, anúncio ou vendedor leva de 10 a 60 segundos; as seguintes abrem na hora.
