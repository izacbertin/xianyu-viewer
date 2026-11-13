# 闲鱼 Viewer — ver anúncio do Goofish/Xianyu por link

Um site com a cara do Xianyu, hospedável no **GitHub Pages**, onde você cola o **link (ou o ID)** de um anúncio e vê **fotos, preço e dados do vendedor** — e copia o link. Sem precisar comprar e sem logar no Xianyu.

## Por que precisa de um "motor"

O Goofish bloqueia acesso de fora da China e de servidores de terceiros (controle de risco, que varia por horário). Um site **estático** (GitHub Pages) **não** consegue puxar o Goofish sozinho — faltam CORS, IP chinês e a assinatura deles.

Então o site delega a busca a um **motor com proxy residencial chinês**. Aqui usamos uma **API de scraping** (ex.: um actor de "Goofish/Xianyu detail" no [Apify Store](https://apify.com/store?search=goofish)). O motor é a única parte paga/externa; o resto é grátis.

> As **imagens** vêm do CDN da Alibaba (`*.alicdn.com`), que **não é geobloqueado** — então as fotos abrem normal do Brasil.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | O site inteiro (front-end). Funciona sozinho em GitHub Pages. |
| `worker.js` | Backend opcional (Cloudflare Worker) para o **modo proxy**, que esconde o token. |

## Modo 1 — Direto (mais simples, sem backend)

O próprio navegador chama a API, com o token guardado **só no seu navegador** (localStorage).

1. Crie o repositório no GitHub e suba o `index.html`.
2. **Settings → Pages →** Branch `main` / `/root` → salvar. Seu site fica em `https://SEU-USUARIO.github.io/SEU-REPO/`.
3. Crie uma conta no [Apify](https://apify.com), pegue o **token** em *Settings → API tokens*, e escolha um **actor** de Goofish/Xianyu detail no [Store](https://apify.com/store?search=goofish).
4. No site, clique no **⚙️** → aba **Direto (Apify)** → cole token, actor (`usuario/actor`) e, se preciso, ajuste o **template de input** conforme a página *Input* do actor.
5. Cole o link do anúncio e clique **Ver**.

> ⚠️ Nesse modo o token fica no navegador de quem usa o site. Para uso **pessoal** tudo bem. Se for compartilhar o site publicamente, use o Modo 2.

## Modo 2 — Proxy (token escondido no Cloudflare Worker, grátis)

1. Suba o `index.html` no GitHub Pages (passos acima).
2. Crie um Worker em [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Worker**, cole o conteúdo de `worker.js` e faça deploy.
3. No Worker, **Settings → Variables and Secrets**, defina:
   - `APIFY_TOKEN` (Secret) = seu token do Apify
   - `APIFY_ACTOR` = `usuario/actor`
   - `APIFY_INPUT` (opcional) = template, ex.: `{"startUrls":[{"url":"{{url}}"}]}`
   - `ALLOW_ORIGIN` (opcional) = a URL do seu GitHub Pages
4. No site, **⚙️ → aba Proxy** → cole a URL do Worker (`https://...workers.dev`).
5. Cole o link e **Ver**.

## Adaptando ao actor escolhido

Cada actor do Apify tem um **input** e um **output** próprios. O site é tolerante: ele vasculha o JSON e acha imagens, preço, título e vendedor sozinho, e sempre mostra o **JSON bruto** (no fim do resultado) pra você conferir.

- Se não vier nada: abra a página *Input* do actor e ajuste o **template** (alguns usam `urls`, `itemId`, `keyword`, etc.).
- Se faltar um campo: veja o JSON bruto pra descobrir o nome real do campo naquele actor.

## Limite honesto

Nenhum truque de cliente vence o bloqueio do Goofish — quem vence é o **proxy chinês do motor**. Se até o motor vier vazio num horário de bloqueio forte, tente mais tarde (a janela da **madrugada chinesa** costuma liberar). Trocar de actor/provedor com proxy residencial melhor também ajuda.
