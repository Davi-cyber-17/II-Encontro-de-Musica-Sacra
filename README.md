# II Encontro de Música Sacra — IBBVBM

Site + backend real (Node/Express + SQLite) para o evento. Substitui o antigo
`local-api.js`, que só salvava dados no navegador de cada visitante.

## O que mudou

- Antes: `local-api.js` simulava uma API usando `localStorage`/`IndexedDB` —
  cada visitante só via os próprios dados, e o painel admin não enxergava
  ninguém.
- Agora: `server.js` é um servidor Node/Express de verdade, com banco SQLite
  (`data/ibbvbm.sqlite`) e upload de comprovantes salvo em disco
  (`uploads/`). Todos os visitantes gravam no mesmo banco, o painel admin
  vê tudo, e nada se perde se a pessoa trocar de celular ou limpar o
  navegador.
- O front-end (`index.html`, `admin.html`, `script.js`, `style.css`, imagens)
  não mudou nenhuma lógica — ele já falava com `/api/...`, então continua
  funcionando sem alteração, só que agora contra um servidor real.

## Estrutura

```
server.js           → o servidor (toda a lógica da API)
package.json        → dependências (express, better-sqlite3, multer)
public/             → todo o front-end (é o que o navegador carrega)
data/                → banco SQLite (criado automaticamente na 1ª execução)
uploads/             → comprovantes de pagamento enviados pelos inscritos
```

## Rodando localmente (para testar antes de publicar)

Pré-requisito: [Node.js](https://nodejs.org) 18 ou mais recente instalado.

```bash
npm install
npm start
```

Abra `http://localhost:3000` no navegador. O painel administrativo fica em
`http://localhost:3000/admin.html` — na primeira vez que você abrir, ele vai
pedir para você **criar** a conta de administrador (isso agora fica salvo no
servidor, não mais "por navegador").

## Publicando de verdade (antes de divulgar o link)

A forma mais simples e gratuita para este projeto é o **Render**
(render.com). Passo a passo:

1. Suba esta pasta inteira para um repositório no GitHub (pode ser privado).
2. Em [render.com](https://render.com), crie uma conta gratuita e clique em
   **New → Web Service**, conectando o repositório do GitHub.
3. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Importante — persistência dos dados:** no plano gratuito, o disco do
   Render é apagado a cada novo deploy. Para os dados (inscrições, contas,
   comprovantes) sobreviverem entre atualizações do site, adicione um
   **Persistent Disk** (Render → seu serviço → Disks → Add Disk), montado em
   `/opt/render/project/src/data` e outro em `.../uploads` — ou monte um
   único disco em `/opt/render/project/src` cobrindo ambas as pastas. Isso
   tem custo baixo (poucos dólares/mês); se preferir 100% gratuito, dá para
   aceitar que os dados são perdidos a cada deploy, desde que você **não
   redeploye** durante o período de inscrições.
5. Quando o deploy terminar, o Render te dá uma URL do tipo
   `https://seu-projeto.onrender.com`. É essa URL que você deve colocar no
   lugar de `SEU-DOMINIO-AQUI` em: `index.html` (meta tags Open Graph,
   canonical, JSON-LD), `robots.txt` e `sitemap.xml`.
6. Se tiver domínio próprio (ex: `ibbvbm.org.br`), o Render permite apontar
   um domínio customizado de graça — aí a URL final fica ainda melhor para
   divulgar.

**Alternativas ao Render**, se preferir: Railway, Fly.io ou um VPS simples
(qualquer um roda `npm install && npm start` da mesma forma — a única
diferença prática é como cada um trata disco persistente).

## Segurança básica já incluída

- Senhas nunca são salvas em texto puro (hash com `scrypt` + salt aleatório).
- Limite de tentativas de login (5 erradas = bloqueio de 2 minutos), tanto
  para usuários quanto para o admin.
- Sessões expiram (12h para inscritos, 8h para admin).
- `admin.html` tem `noindex` para não aparecer no Google.
- Upload de comprovante limitado a 8 MB.

## O que ainda vale considerar (fora do escopo deste backend)

- Confirmação por e-mail após a inscrição — exigiria configurar um serviço
  de envio de e-mail (ex: Resend, SendGrid) com uma chave de API; o servidor
  já está estruturado para isso ser adicionado depois, se quiser.
- Backup periódico do arquivo `data/ibbvbm.sqlite` (por exemplo, um cron job
  simples copiando o arquivo para outro lugar).
