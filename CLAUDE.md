# CLAUDE.md — Hub Vértice G (novo)

Regras deste projeto. Valem junto com o CLAUDE.md global do escritório.

## O que é

Fundação nova do **Hub Vértice G**, separada de tudo o que já existe (decisão de 03/11/2026):
- Repositório, aplicação e banco **próprios**. Não lê nem grava o banco do Buscador NFS-e nem o do Robô Fiscal.
- **Multi-tenant**: cada escritório é um tenant (`tenants`); toda tabela de dados tem `tenant_id` e toda consulta das rotas filtra pelo tenant da sessão.
- Terá DP próprio. As integrações de DP que hoje estão no Buscador (Consignados, Convenções) não foram trazidas.
- Comunicação futura com Buscador e Robô Fiscal só por **API segura** — nunca por banco compartilhado.

## Stack e comandos

- Node.js 22 com ES modules, servidor em Node puro, SQLite (`better-sqlite3`).
- `npm start` → http://127.0.0.1:3200 (o usuário abre por `Abrir Hub Vertice G.cmd`)
- `npm run criar-escritorio` → cria escritório + primeiro administrador (pergunta no terminal)
- `npm test` → testes com banco em memória

## Mapa

| Arquivo | O que tem |
|---|---|
| `src/config.js` | `.env`, porta, caminho do banco (`HUB_DB_PATH`, padrão `data/hub.db`) |
| `src/db.js` | schema e `registrar()` (registro de ações) |
| `src/auth.js` | senha (scrypt), sessões (token só no cookie, hash no banco), bloqueio por tentativas |
| `src/escritorios.js` | criar escritório, criar/listar usuários, departamentos do usuário |
| `src/app.js` | rotas HTTP |
| `src/telas.js` | páginas de login e painel |
| `src/cli/` | comandos de terminal |

## Regras

- Toda rota nova que lê ou grava dado filtra por `usuario.tenant_id`. Teste novo cobre o isolamento entre dois escritórios.
- `data/` e `.env` nunca vão para o Git. Testes só com `:memory:` ou banco temporário; dados fictícios.
- Commits em português, padrão `tipo(área): descrição`.
- Textos de tela em português; números no padrão brasileiro.
