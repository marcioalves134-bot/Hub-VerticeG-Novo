# Continuidade — início da Etapa 10 (tela `/clientes`)

Resumo para retomar o Hub Vértice G numa conversa nova. Situação em 04/11/2026, depois do commit `25edccc`.
A fonte de verdade continua sendo `docs/especificacao-clientes-e-modulos.md` (aprovada); este arquivo só aponta o caminho.

---

## 1. Como o trabalho é conduzido

- **Uma etapa por vez, sempre autorizada.** Ciclo: diagnóstico/plano → aprovação → implementar só a etapa → `npm test` → relatório → parar.
- **Commit** só quando o responsável autoriza, com a mensagem exata e apenas os arquivos listados. Conferir `git status` antes e depois e informar o hash. **Push** só com autorização separada.
- Se o pedido divergir da especificação, seguir a especificação e avisar.
- Interpretações em lacunas pequenas são aceitas se forem declaradas no relatório para revisão.
- Ao terminar, dizer o próximo passo e perguntar. Nunca seguir sozinho para a etapa seguinte.
- Relatórios em português, números no padrão brasileiro.

## 2. Arquitetura atual

Node.js 22 (ES modules), servidor `http` puro, SQLite com `better-sqlite3`, testes com `node:test`.

| Arquivo | Conteúdo |
|---|---|
| `src/server.js` | Sobe o Hub em http://127.0.0.1:3200 |
| `src/config.js` | `.env`, porta, caminho do banco (`HUB_DB_PATH`, padrão `data/hub.db`) |
| `src/db.js` | `abrirBanco` (`SCHEMA_BASE` + versão por `PRAGMA user_version`) e `registrar()` (auditoria) |
| `src/migracoes.js`, `src/migrar.js`, `src/cli/migrar.js` | Migração 001 e comando `npm run migrar` (backup, ensaio em cópia, transação única, relatório) |
| `src/auth.js` | Senha (scrypt), sessões (token só no cookie, hash no banco), bloqueio por tentativas |
| `src/escritorios.js` | Escritórios, usuários, departamentos do usuário |
| `src/permissoes.js` | `exigirPermissao` (por departamento), `podeConsultarClientes`, `exigirConsultaClientes` |
| `src/documentos.js` | CPF e CNPJ (numérico e alfanumérico): `preparar*`, `*Valido`, `formatarCpf`, `formatarCnpj` |
| `src/clientes.js` | Cadastro PJ/PF, edição, inativar/reativar, consulta com matriz e filiais, lista paginada, contratos de serviço, catálogo |
| `src/modulos.js` | Lista de módulos: `folha`→`pessoal`, `fiscal`→`fiscal`, `contabil`→`contabil` |
| `src/app.js` | Todas as rotas HTTP; `casarRota` (`:chave` texto, demais parâmetros inteiros positivos); `lerJson` exige JSON (415) |
| `src/telas.js` | `PAGINA_LOGIN`, `PAGINA_PAINEL`, `paginaComLayout({ titulo, conteudo, script })` com cabeçalho, menu e Sair |
| `src/telas-modulos.js` | `paginaModulo`, `paginaSemAcesso` (403), `paginaModuloNaoEncontrado` (404) |
| `src/backup.js`, `src/cli/` | Backup e comandos de terminal |
| `tests/` | Um arquivo por área; `tests/banco-versao0.js` monta banco na versão 0 |

Comandos: `npm start`, `npm run criar-escritorio`, `npm run backup`, `npm run migrar`, `npm test` (sequencial, `--test-concurrency=1`).

### Ordem das verificações em `src/app.js`

1. Rotas públicas (login).
2. **Barreira M2:** se o banco estiver na versão 0 e o caminho começar por `/clientes`, `/api/clientes` ou `/api/servicos` (constante `CAMINHOS_CLIENTES`, comparação por segmento exato), responde 404 (JSON para `/api`, página para `/clientes`), sem auditoria.
3. Sessão (sem sessão: página → login; API → 401).
4. `/api/eu`, painel, módulos, rotas de consulta de clientes (`exigirConsultaClientes`).
5. **Bloqueio de administrador.**
6. Rotas de gravação (usuários, clientes, contratos, catálogo).

## 3. Decisões importantes já tomadas

- **Banco próprio e multi-tenant:** toda tabela tem `tenant_id`; toda consulta filtra pelo escritório da sessão; número de outro escritório responde 404.
- **Versão do banco:** `SCHEMA_BASE` nunca é ampliado; estrutura nova só por migração. Banco novo nasce na versão 1. Abrir o Hub nunca migra. A versão é lida uma vez em `criarApp` (`recursos.clientes = versao >= 1`).
- **Permissões de Clientes (A-8):** consulta para administrador ou usuário com pelo menos um departamento do próprio escritório; cadastro, edição, situação, contratos e catálogo só administrador. Não existe rota de exclusão (A-9).
- **Auditoria:** nunca CPF, CNPJ, CNPJ da matriz, código no Domínio ou nome de PF; o documento aparece só como nome de campo alterado.
- **CNPJ alfanumérico:** algoritmo conferido com as fontes oficiais (Receita e Serpro) e aprovado. Testes só com documentos fictícios gerados por cálculo.
- **Escolhas da Etapa 7:** edição parcial; lista padrão só ativos; campos desconhecidos recusados.
- **Escolhas da Etapa 8:** início de serviço pode ser retroativo, nunca futuro; fim não pode ser futuro; inativar encerra os serviços abertos na mesma transação; reativar não reabre.
- **Escolhas da Etapa 9:**
  - Chave do serviço: `^[a-z0-9_-]{2,30}$`, imutável.
  - Nome do serviço: até 60 caracteres.
  - Tipo de cliente do serviço não muda se houver contratos.
  - Serviço inativo só impede novas contratações.
  - Filtro `servico` da lista significa "com esse serviço em aberto".
  - Valor vazio na query conta como ausente.
  - `pagina` aceita até 6 dígitos.

## 4. API disponível para a tela (Etapa 9, pronta e testada)

| Rota | Quem | Resposta |
|---|---|---|
| `GET /api/clientes?tipo=&servico=&situacao=&busca=&pagina=` | consulta | `{ itens, total, pagina, porPagina: 100 }` |
| `GET /api/clientes/:id` | consulta | dados + `servicos` (abertos e histórico) + `matriz` + `filiais` |
| `GET /api/servicos` | consulta | catálogo inteiro, inclusive inativos |
| `POST /api/clientes` | admin | 201 `{ id }` |
| `PUT /api/clientes/:id` | admin | 200 (edição parcial) |
| `POST /api/clientes/:id/situacao` | admin | 200 (inativar/reativar) |
| `POST /api/clientes/:id/servicos` | admin | 201 `{ contrato }` |
| `POST /api/clientes/:id/servicos/:contrato/encerrar` | admin | 200 |
| `POST /api/servicos` | admin | 201 `{ id }` |
| `PUT /api/servicos/:id` | admin | 200 |

Mensagens de erro de validação já vêm prontas em português (`ErroDeUso`, status 400/403/404/409/415). Os nomes exatos dos campos estão em `src/clientes.js` e nos testes `tests/clientes.test.js` e `tests/clientes-rotas.test.js`.

## 5. Estado do banco e do servidor

- **Banco real `data/hub.db`: versão 1** (migração 001 aplicada na Etapa 6, em 04/11/2026 às 20:29). Escritório com 3 departamentos (`pessoal`, `fiscal`, `contabil`) e 4 serviços no catálogo (Folha, Fiscal, Contábil, Doméstica).
- Backups da Etapa 6:
  - backup do servidor `hub_2026-11-04_202751`;
  - backup da migração `data/backups-migracao/hub_antes_migracao_001_2026-11-04_202915.db`;
  - relatório `data/logs/migracao-001-2026-11-04_202915.json`.
- **Hub em execução** na porta 3200 (processo 3908), aberto na Etapa 6. Ele roda o código carregado naquele momento, sem as rotas da Etapa 9. **Não reiniciar antes de a Etapa 10 estar pronta:** com o código atual, o menu já mostraria "Clientes" e o link daria "Página não encontrada."
- **Git:** `main` = `origin/main` = `25edccc` (`feat(clientes): rotas, permissões e catálogo de serviços`). Working tree limpo antes deste arquivo.
- **Testes:** 249 passando, 0 falhas.

## 6. Etapas concluídas

| Etapa | Commit |
|---|---|
| Especificação aprovada | `de2d881` |
| 1 — Layout comum e menu | `516b5ca` |
| 2 — Páginas dos módulos | `e88e699` |
| 3 — Cartões do painel como atalhos | `690b1d4` |
| 4 — CPF e CNPJ numérico/alfanumérico | `f67034b` |
| 5a — Versão do banco e migração 001 | `0da25f9` |
| 5b — `npm run migrar` | `6dfa0dd` |
| 5c — Versão lida ao iniciar e aviso | `3b2278c` |
| 6 — Migração 001 no banco real | sem commit (operação no banco) |
| 7 — Cadastro de clientes | `2076e7e` |
| 8 — Serviços contratados | `c8d2b58` |
| 9 — Rotas, permissões, catálogo, M2/M3 | `25edccc` |

Todas enviadas ao GitHub.

## 7. Restrições de segurança (não negociáveis)

- Não alterar `data/` nem o banco real. Testes só com `:memory:` ou banco temporário, dados fictícios.
- Não reiniciar o Hub da porta 3200 sem autorização.
- Nada de CPF, CNPJ, senha, certificado ou chave real em código, log, print ou commit. `.env` e `data/` nunca vão para o Git.
- Nunca excluir arquivo, registro, tabela, branch ou deploy sem autorização expressa.
- Antes de qualquer mudança em banco real, mostrar o SQL e esperar aprovação.
- Toda rota nova filtra por `usuario.tenant_id`, com teste de isolamento entre dois escritórios. Toda rota ou tela nova que use clientes ou serviços fica atrás da barreira M2.
- Textos de tela em português; datas dd/mm/aaaa; números no padrão brasileiro.
- Commits em português, padrão `tipo(área): descrição`.

## 8. Escopo da Etapa 10 (seção 9 e 5.7 da especificação)

**Etapa 10 — Tela `/clientes` + "Clientes" no menu; conferência no navegador.** Depende da 9. Não toca no banco real.

### Rota

- `GET /clientes` (página): exige login; sem sessão vai para o login. Já está na lista `CAMINHOS_CLIENTES`, então na versão 0 responde 404 pela barreira M2 (teste existente). A rota em si ainda **não existe**. Ela deve servir a página para qualquer usuário logado; quem decide o acesso aos dados são as rotas `/api` (403 para quem não pode consultar).

### Menu

- `montarMenu` em `src/telas.js` já mostra "Clientes" quando `/api/eu` traz `podeConsultarClientes: true`. Isso foi preparado na Etapa 1, e `/api/eu` passou a informar o valor na Etapa 9. Conferir e cobrir com teste; não duplicar.

### Tela (seção 5.7), usando `paginaComLayout`

- **Lista:**
  - filtros por tipo (PJ/PF), serviço e situação, busca e paginação de 100;
  - documento exibido com máscara (CPF `000.000.000-00`; CNPJ `00.000.000/0000-00`, inclusive alfanumérico).
- **Formulário por tipo:**
  - PJ: razão social, nome fantasia, CNPJ, IE, IM, endereço, telefone, e-mail, contato responsável, tipo de estabelecimento. Filial mostra "CNPJ da matriz".
  - PF: nome, CPF, data de nascimento, endereço, telefone, WhatsApp, e-mail.
  - Código no Domínio é opcional nos dois.
  - Obrigatórios conforme A-11: tipo de pessoa, documento e nome; em PJ também tipo de estabelecimento e, se filial, CNPJ da matriz.
- **Detalhe:**
  - dados do cliente;
  - serviços em aberto com botão "Encerrar";
  - histórico com datas dd/mm/aaaa;
  - "Contratar serviço", oferecendo só serviços ativos do tipo do cliente;
  - "Inativar", com aviso de que encerra os serviços em aberto, ou "Reativar";
  - links para a matriz e as filiais (aviso "Matriz não encontrada no Hub" quando a matriz não está cadastrada, conforme riscos da seção 10);
  - aviso "Dados fiscais oficiais: Domínio".
- **Catálogo:** bloco visível só para administrador (criar, renomear, inativar/reativar serviço).
- **Demais usuários autorizados:** somente leitura, sem botões de gravação.
- **Sem permissão de consulta:** a página mostra a mensagem do 403 da API, sem quebrar.

### Testes e conferência

- **Testes da página:**
  - sintaxe do script;
  - elementos presentes;
  - rota `/clientes` (logado → 200; sem sessão → login; versão 0 → 404);
  - menu por perfil;
  - comportamento simulado (somente leitura para não administrador; catálogo só para administrador).
- **Atualizar** o teste de `tests/clientes-rotas.test.js` que confere a barreira na versão 0, se algum ponto assumir que `/clientes` não existe na versão 1.
- **Conferência no navegador:**
  - instância separada na porta 3299, banco em memória, dados fictícios, Edge headless via script na pasta temporária;
  - nunca usar `data/hub.db` nem a porta 3200;
  - confirmar no fim que `data/` não mudou.

### Fora da Etapa 10

- Atualizar `CLAUDE.md` e `README.md` (é a Etapa 11).
- Ferramentas dos módulos, Portal do Cliente, integrações.
- Qualquer mudança nas regras de `src/clientes.js` ou nas rotas da Etapa 9, salvo correção necessária e declarada.

## 9. Pendências fora do código

- Conferência do usuário, com login real, do módulo Contábil depois da migração (menu, Início e página "Em preparação"). Ainda não confirmada.
- Tarefa agendada "Hub Vertice G - Backup": execuções de 04/11 terminaram como "pendente" (destino do servidor provavelmente inacessível). Não investigado.
- Depois da Etapa 10: reiniciar o Hub real (com autorização) e repetir a conferência da tela no Hub real.

## 10. Próximo passo

Na conversa nova: ler este arquivo e as seções 5.5, 5.7, 7.8 e 9 da especificação, apresentar o plano da Etapa 10 e **esperar autorização** antes de implementar.
