# Especificação técnica — Clientes PJ/PF, Serviços Contratados e Módulos Folha, Fiscal e Contábil

Hub Vértice G · versão da especificação: 04/11/2026 · situação: **aprovada** (nada implementado)

---

## 1. Premissas

- O **Domínio** é o sistema oficial de execução Fiscal, Contábil e de Folha e prevalece para dados fiscais, contábeis e de folha.
- O **Hub** é a referência para gestão, relacionamento, serviços contratados e o futuro Portal do Cliente.
- **Fora desta especificação:** cálculos, rotinas fiscais, folha, lançamentos contábeis, colaboradores/empregados domésticos, admissões, férias, rescisões, integração ou sincronização com o Domínio.

## 2. Decisões aprovadas

### Navegação e módulos

| # | Decisão |
|---|---|
| B-1 | Folha usa o departamento existente `pessoal`, sem criar outro. |
| B-2 | Fiscal usa `fiscal`. |
| B-3 | Criar o departamento `contabil` para o módulo Contábil. |
| B-4 | Endereços: `/modulos/folha`, `/modulos/fiscal`, `/modulos/contabil`. |
| B-5 | Sem ferramentas: um cartão único **"Em preparação"**. |
| B-6 | Módulos sem permissão ficam escondidos do menu. |
| B-7 | Acesso negado: página HTML com status 403 e registro de auditoria. |
| B-8 | Administração permanece no Início. |
| B-9 | Departamento Contábil e catálogo de serviços criados numa **única operação** no banco real, só após autorização expressa e backup. |

### Clientes

| # | Decisão |
|---|---|
| A-1 | **PJ:** razão social, nome fantasia, CNPJ, inscrição estadual e municipal, endereço, telefone, e-mail, contato responsável, tipo de estabelecimento (Matriz/Filial) e CNPJ da matriz (para filial). Cada CNPJ é um cadastro independente. |
| A-2 | **PF:** nome completo, CPF, data de nascimento, endereço, telefone, WhatsApp, e-mail. PF é cliente, não colaborador. |
| A-3 | **Doméstica** é serviço contratado por cliente PF; empregados domésticos não fazem parte deste módulo. |
| A-4 | Validar CPF e CNPJ; aceitar CNPJ numérico e alfanumérico (padrão oficial da Receita), mantendo compatibilidade com os antigos. |
| A-5 | Catálogo inicial: Folha, Fiscal, Contábil (só PJ) e Doméstica (só PF); catálogo administrado pelo administrador. |
| A-6 | Vários serviços por cliente, com histórico de contratação e encerramento. |
| A-7 | Código no Domínio: opcional, PJ e PF, sem integração/sincronização. |
| A-8 | **Consulta:** administradores e usuários com **pelo menos um departamento liberado**, validado no servidor por mecanismo central. **Cadastro, edição e inativação:** só administradores. |
| A-9 | Nunca excluir cliente; inativar e reativar; inativar encerra automaticamente os serviços em aberto; todo o histórico é preservado. |
| A-10 | Auditoria de todas as operações, **sem CPF nem CNPJ**. |
| A-11 | **Obrigatórios:** tipo de pessoa, documento e nome; em PJ também tipo de estabelecimento e, se Filial, CNPJ da matriz. Os demais campos são opcionais. |
| A-12 | **Correção de documento:** administradores podem corrigir CPF/CNPJ; a auditoria registra só que o campo `documento` foi alterado, sem valor anterior nem novo. |
| A-13 | **Migração explícita:** tabelas novas, departamento Contábil e catálogo inicial nos escritórios existentes só por migração controlada (seção 7): Hub fechado, backup verificado, transação única, validação, reversão total em falha e relatório. Abrir o Hub **nunca** migra o banco existente. |
| A-14 | **Banco na versão 0 (P1):** o Hub inicia normalmente; **Clientes e Contábil ficam ocultos e indisponíveis** até a migração; nenhuma funcionalidade atual é bloqueada; nenhuma migração automática. Proteção detalhada na seção 7.8. |
| A-15 | **Correção do CNPJ de uma matriz (P2):** as filiais **não** são atualizadas automaticamente; permanecem com o CNPJ da matriz que tinham, e o administrador corrige os vínculos manualmente. |
| A-16 | **CNPJ alfanumérico (P3):** o algoritmo de validação deve ser **confirmado com a publicação oficial da Receita Federal** antes da implementação dessa validação (pré-requisito da etapa 4). |

## 3. Interpretações técnicas adotadas

Preenchem lacunas pequenas sem criar regra de negócio. Corrigir se discordar.

| # | Interpretação | Motivo |
|---|---|---|
| I-1 | O departamento `pessoal` mantém o nome "Pessoal (DP)"; só o módulo/menu diz "Folha". | B-1, sem gravação extra no banco real. |
| I-2 | Contratar/encerrar serviço é edição do cliente → só administrador. | A-8. |
| I-3 | WhatsApp só em PF; "contato responsável" (PJ) é um nome em texto. | Lista literal de A-1/A-2. |
| I-4 | Filial: CNPJ da matriz válido, diferente do próprio e com a **mesma raiz** (8 primeiras posições); a matriz não precisa estar cadastrada no Hub. | Estrutura do CNPJ; permite filial cuja matriz não é cliente. |
| I-5 | IE e IM: texto livre (aceita "ISENTO"), sem validação por UF. | Domínio prevalece em dados fiscais. |
| I-6 | Endereço em campos separados (CEP 8 dígitos, UF entre as 27); telefone/WhatsApp brasileiros com DDD, gravados só com números. Sem busca automática de CEP. | Validação e formatação; busca de CEP seria integração. |
| I-7 | Início do serviço pode ser retroativo, **não futuro**; fim automático da inativação = hoje no horário de Brasília. | Início futuro tornaria o encerramento automático inválido. |
| I-8 | O mesmo serviço não pode ficar em aberto duas vezes no mesmo cliente; recontratar cria nova linha. | A-6 com histórico limpo. |
| I-9 | Código no Domínio único dentro do escritório, quando preenchido. | Evita duplicidade. |
| I-10 | Catálogo: administrador cria, renomeia e inativa serviços; serviço nunca é excluído; o tipo de cliente de um serviço não muda depois de haver contratos. | A-5 + A-9. |
| I-11 | CNPJ digitado com minúsculas é convertido para maiúsculas. | O padrão usa maiúsculas. |
| I-12 | Auditoria usa o número do cliente; além de CPF/CNPJ, não grava nome de PF, CNPJ da matriz nem código no Domínio. | A-10 com cuidado extra (LGPD). |
| I-13 | Reativar não reabre serviços. | A-9. |
| I-14 | O tipo de pessoa (PJ/PF) nunca muda depois do cadastro; só o documento pode ser corrigido (A-12), passando pelas mesmas validações. | A-12 fala só de documento. |

## 4. Navegação e módulos

**Lista de módulos** (`src/modulos.js`, novo):

| chave | Título | Departamento |
|---|---|---|
| `folha` | Folha | `pessoal` |
| `fiscal` | Fiscal | `fiscal` |
| `contabil` | Contábil | `contabil` |

**Layout comum** (`src/telas.js`): cabeçalho + menu **Início · Clientes · Folha · Fiscal · Contábil · Sair**, usado pelo painel, módulos e Clientes. O menu mostra só o que o usuário pode abrir (B-6), a partir de `/api/eu`; "Clientes" segue A-8. Módulo cujo departamento ainda não exista no escritório (Contábil antes da migração) não aparece.

**Rota `GET /modulos/:chave`** (`src/app.js`):

| Situação | Resposta |
|---|---|
| Sem sessão | Redireciona para o login |
| Chave fora da lista, ou departamento inexistente no escritório | Página HTML 404 "Módulo não encontrado" |
| Sem permissão de leitura no departamento | Página HTML **403** "Sem acesso a este módulo" + `permissao.negada` (gravado por `exigirPermissao`) |
| Com permissão | Título, nível (Consulta/Operação), aviso "Operações oficiais: Domínio." e cartão "Em preparação" |

**Painel:** cartões de departamento viram atalhos para os módulos; administração continua no Início.

**Ferramentas futuras:** cada uma entra como seção do seu módulo, com dados por `/api/dep/<departamento>/...` (já protegidos pela barreira de permissões).

## 5. Clientes

### 5.1 Estrutura (aplicada só pela migração 001 — seção 7)

```sql
CREATE TABLE clientes (
  id                     INTEGER PRIMARY KEY,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  tipo                   TEXT NOT NULL CHECK (tipo IN ('PJ', 'PF')),
  documento              TEXT NOT NULL,            -- sem máscara; CNPJ 14 (maiúsculas), CPF 11
  nome                   TEXT NOT NULL,            -- razão social ou nome completo
  nome_fantasia          TEXT,                     -- PJ
  inscricao_estadual     TEXT,                     -- PJ
  inscricao_municipal    TEXT,                     -- PJ
  tipo_estabelecimento   TEXT CHECK (tipo_estabelecimento IN ('matriz', 'filial')), -- PJ
  cnpj_matriz            TEXT,                     -- PJ filial
  contato_responsavel    TEXT,                     -- PJ
  data_nascimento        TEXT,                     -- PF, AAAA-MM-DD
  whatsapp               TEXT,                     -- PF
  cep TEXT, logradouro TEXT, numero TEXT, complemento TEXT, bairro TEXT, municipio TEXT, uf TEXT,
  telefone               TEXT,
  email                  TEXT,
  codigo_dominio         TEXT,
  ativo                  INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em              TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((tipo = 'PJ' AND length(documento) = 14) OR (tipo = 'PF' AND length(documento) = 11)),
  CHECK (tipo = 'PJ' OR (nome_fantasia IS NULL AND inscricao_estadual IS NULL AND inscricao_municipal IS NULL
                         AND tipo_estabelecimento IS NULL AND cnpj_matriz IS NULL AND contato_responsavel IS NULL)),
  CHECK (tipo = 'PF' OR (data_nascimento IS NULL AND whatsapp IS NULL)),
  CHECK (tipo = 'PF' OR tipo_estabelecimento IS NOT NULL),
  CHECK (tipo = 'PF' OR (tipo_estabelecimento = 'filial') = (cnpj_matriz IS NOT NULL)),
  CHECK (cnpj_matriz IS NULL OR cnpj_matriz <> documento),
  UNIQUE (tenant_id, documento),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX idx_clientes_dominio ON clientes (tenant_id, codigo_dominio) WHERE codigo_dominio IS NOT NULL;
CREATE INDEX idx_clientes_nome   ON clientes (tenant_id, nome);
CREATE INDEX idx_clientes_matriz ON clientes (tenant_id, cnpj_matriz);

CREATE TABLE servicos (
  id            INTEGER PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  chave         TEXT NOT NULL,
  nome          TEXT NOT NULL,
  tipo_cliente  TEXT NOT NULL CHECK (tipo_cliente IN ('PJ', 'PF')),
  ativo         INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  UNIQUE (tenant_id, chave),
  UNIQUE (tenant_id, id)
);

CREATE TABLE cliente_servicos (
  id          INTEGER PRIMARY KEY,
  tenant_id   INTEGER NOT NULL,
  cliente_id  INTEGER NOT NULL,
  servico_id  INTEGER NOT NULL,
  inicio      TEXT NOT NULL,
  fim         TEXT,
  CHECK (fim IS NULL OR fim >= inicio),
  FOREIGN KEY (tenant_id, cliente_id) REFERENCES clientes (tenant_id, id),
  FOREIGN KEY (tenant_id, servico_id) REFERENCES servicos (tenant_id, id)
);
CREATE UNIQUE INDEX idx_servico_aberto  ON cliente_servicos (tenant_id, cliente_id, servico_id) WHERE fim IS NULL;
CREATE INDEX        idx_cliente_servicos ON cliente_servicos (tenant_id, cliente_id);
```

Obrigatórios garantidos pelo banco: tipo, documento, nome, tipo de estabelecimento (PJ) e CNPJ da matriz (filial) — A-11.

### 5.2 Validações (`src/documentos.js`, `src/clientes.js`)

- **CPF:** remove máscara/espaços; 11 dígitos; dois dígitos verificadores (módulo 11); recusa todos iguais.
- **CNPJ:** remove `. / -` e espaços, converte para maiúsculas; 14 posições — 12 primeiras `A–Z`/`0–9`, 2 últimas dígitos; DV em módulo 11 com pesos 5…2/9…2 e 6…2/9…2, valor de cada caractere = código ASCII − 48 (`0`–`9` → 0–9, `A` → 17 … `Z` → 42). CNPJ só numérico continua válido pelo mesmo cálculo. Recusa todos iguais. Vetor conferido à mão: `12.ABC.345/01DE-35` (DV 3 e 5).
  - **Algoritmo ainda não confirmado (A-16).** Antes de implementar a validação de CNPJ, a etapa 4 começa pela conferência com a publicação oficial da Receita Federal: localizar a norma e o documento técnico oficial do CNPJ alfanumérico, comparar regra de formação, tabela de conversão de caracteres, pesos e cálculo dos DV com o descrito acima, e usar os exemplos oficiais como casos de teste. O resultado (fontes, eventuais diferenças e ajustes) é apresentado para aprovação; só depois o código da validação é escrito. A validação de CPF não depende dessa conferência.
- **Filial:** I-4. **Datas, telefone, WhatsApp, e-mail, CEP, UF:** I-6/I-7; nascimento não futuro.
- **Textos:** remove espaços nas pontas; tamanho máximo em todos os campos.
- **Mensagens de erro** nunca repetem o documento (ex.: "Já existe cliente com este CNPJ.").

### 5.3 Regras de operação

| Operação | Regra |
|---|---|
| Cadastrar | Valida por tipo; documento repetido no escritório é recusado (inclusive de cliente inativo — reativar em vez de recadastrar). |
| Editar | Tipo imutável (I-14). **Documento pode ser corrigido** pelo administrador (A-12), com todas as validações e a unicidade; auditoria só com `campos: ['documento', ...]`. **Correção do CNPJ de uma matriz (A-15):** altera só a matriz; as filiais continuam com o `cnpj_matriz` antigo, nenhuma outra linha é alterada e nenhuma auditoria é gerada para elas. Na tela, essas filiais passam a mostrar "Matriz não encontrada no Hub" e a matriz deixa de listá-las, até o administrador corrigir o CNPJ da matriz em cada filial (edição normal da filial). |
| Inativar | Uma transação: cliente inativo + encerra serviços em aberto com a data de hoje + auditoria. |
| Reativar | Volta a ativo; serviços continuam encerrados (I-13). |
| Contratar | Cliente ativo; serviço ativo e do mesmo tipo do cliente; sem duplicidade em aberto (I-8); início não futuro (I-7). |
| Encerrar | Fim ≥ início; nada é apagado. |
| Catálogo | I-10. |
| Excluir | **Não existe** rota nem função. |

### 5.4 Permissões (mecanismo central — `src/permissoes.js`)

- `podeConsultarClientes(db, usuario)`: devolve verdadeiro/falso, **sem registrar nada**. Verdadeiro se o administrador ou o usuário tiver pelo menos um vínculo em `usuario_departamentos` com departamento **do próprio escritório** (vínculos inconsistentes com outro escritório não contam). Consulta só tabelas que já existem na versão 0 (`usuario_departamentos`, `departamentos`). Lido do banco a cada chamada.
- `exigirConsultaClientes(db, usuario)`: usa `podeConsultarClientes`; se negado, registra `permissao.negada` com `{ recurso: 'clientes' }` e lança 403.
- Gravação (cadastro, edição, inativação, reativação, contratos, catálogo): bloqueio de administrador já existente em `src/app.js`.
- O menu usa `podeConsultarClientes` **e** a disponibilidade do recurso (seção 7.8) só para mostrar ou esconder "Clientes"; quem decide é o servidor.

### 5.5 Rotas (todas filtram por `tenant_id` da sessão; número de outro escritório → 404)

| Rota | Quem |
|---|---|
| `GET /api/clientes?tipo=&servico=&situacao=&busca=&pagina=` (até 100 por página; `%` e `_` tratados como texto) | `exigirConsultaClientes` |
| `GET /api/clientes/:id` (dados, serviços e histórico, matriz e filiais cadastradas) | `exigirConsultaClientes` |
| `GET /api/servicos` | `exigirConsultaClientes` |
| `POST /api/clientes`, `PUT /api/clientes/:id`, `POST /api/clientes/:id/situacao` | administrador |
| `POST /api/clientes/:id/servicos`, `POST /api/clientes/:id/servicos/:contrato/encerrar` | administrador |
| `POST /api/servicos`, `PUT /api/servicos/:id` | administrador |
| `GET /clientes` (página) | logado; sem sessão → login |

Rotas de consulta ficam **antes** do bloqueio de administrador em `src/app.js`; as de gravação, **depois**. Nenhuma passa pela barreira `/api/dep/...`. **Todas** ficam atrás da barreira de disponibilidade da versão do banco (seção 7.8), que vem antes de qualquer verificação de permissão ou consulta.

### 5.6 Auditoria

| Ação | `detalhe` |
|---|---|
| `cliente.criado` | `{ cliente, tipo }` |
| `cliente.editado` | `{ cliente, campos: [...] }` — só nomes; `documento` aparece como nome de campo, nunca com valor |
| `cliente.inativado` / `cliente.reativado` | `{ cliente, servicosEncerrados }` (na inativação) |
| `servico.contratado` / `servico.encerrado` | `{ cliente, servico: 'fiscal', inicio }` / `{ ..., fim }` |
| `catalogo.servico_criado` / `catalogo.servico_editado` | `{ servico: chave, campos }` |
| `migracao.aplicada` (seção 7) | `{ versao: 1 }`, uma linha por escritório, sem usuário |

Nunca CPF, CNPJ, CNPJ da matriz, código no Domínio ou nome de PF (I-12). Consultas comuns não são registradas.

### 5.7 Tela `/clientes` (layout comum)

Lista com filtros (tipo, serviço, situação), busca e paginação; documento com máscara. Formulário por tipo (Filial mostra "CNPJ da matriz"; obrigatórios conforme A-11). Detalhe: dados, serviços em aberto com "Encerrar", histórico (dd/mm/aaaa), "Contratar serviço" (só do tipo do cliente), "Inativar" (avisa que encerra os serviços) ou "Reativar", links matriz/filiais, aviso "Dados fiscais oficiais: Domínio". Catálogo: bloco só para administrador. Demais usuários autorizados: somente leitura.

## 6. Isolamento entre escritórios

| Ponto | Garantia |
|---|---|
| Consultas de clientes, serviços e contratos | `WHERE tenant_id = ?` da sessão em todas |
| Contrato → cliente / serviço | Chave composta escritório + número: o banco recusa mistura |
| Filial → matriz | Procurada por CNPJ só no mesmo escritório |
| Documento e código no Domínio | Únicos **por escritório** |
| Consulta de clientes | Vínculo só conta se o departamento for do escritório da sessão |
| Páginas de módulo | `exigirPermissao` procura o departamento só no escritório da sessão |
| Auditoria | Gravada no escritório de quem agiu ou tentou |
| Migração | Departamento Contábil e catálogo criados **por escritório**; validação confere cada um |

## 7. Migração explícita e controlada (A-13)

### 7.1 Princípios

- **Nenhuma migração implícita.** Abrir o Hub, criar escritório ou fazer backup nunca altera a estrutura de um banco existente.
- **Versão do banco** controlada por `PRAGMA user_version` (recurso nativo do SQLite, gravado dentro da transação). Banco atual = versão **0**. Esta migração leva à versão **1**.
- **Um único caminho de estrutura:** a mesma definição da migração 001 é usada para criar bancos novos, garantindo que banco novo e banco migrado fiquem idênticos.

### 7.2 Comportamento de `src/db.js` (`abrirBanco`)

| Banco aberto | Comportamento |
|---|---|
| **Novo** (arquivo sem nenhuma tabela, ou `:memory:` nos testes) | Cria a estrutura base + todas as migrações e grava a versão atual. Nenhum escritório existe ainda, então não há dados a carregar. |
| **Existente** | Só abre (a estrutura base atual continua com `CREATE TABLE IF NOT EXISTS`, que não muda nada num banco já criado). **Nunca** aplica migração. |

**Departamentos e catálogo de escritórios novos — conforme a versão do banco:**

| Versão do banco | `criarEscritorio` cria |
|---|---|
| 0 (não migrado) | Exatamente o que cria hoje: `fiscal` e `pessoal`. **Não** toca em `servicos` (a tabela não existe). |
| 1 (novo ou migrado) | `fiscal`, `pessoal`, `contabil` e o catálogo inicial de serviços. |

`DEPARTAMENTOS_INICIAIS` continua com `fiscal` e `pessoal`; o Contábil e o catálogo ficam numa lista própria da migração 001, aplicada por `criarEscritorio` só na versão 1. Um escritório criado na versão 0 recebe o Contábil e o catálogo quando a migração rodar (ela trata todos os escritórios existentes).

**Banco desatualizado (A-14):** o Hub (`npm start`), `npm run criar-escritorio` e `npm run backup` funcionam normalmente na versão 0. O Hub apenas mostra no terminal, ao iniciar: "Banco na versão 0: Clientes e Contábil ficam indisponíveis até a migração 001 (`npm run migrar`, com o Hub fechado e após backup)." Nada é gravado e nenhuma migração é feita.

### 7.3 Comando `npm run migrar` (`src/cli/migrar.js` + `src/migracoes.js`)

Sequência, na ordem; qualquer falha interrompe sem alterar o banco real:

1. **Hub fechado:** consulta `http://127.0.0.1:<porta>/saude`; se responder, aborta ("Feche o Hub antes de migrar.").
2. **Versão:** lê `user_version`. Se já estiver na versão 1 → informa "Migração 001 já aplicada", gera relatório e termina **sem alterar nada**. Se for diferente de 0 ou 1 → aborta.
3. **Saúde do banco atual:** `integrity_check = ok` e `foreign_key_check` vazio; senão aborta.
4. **Backup verificado:** cópia pela API de backup do SQLite para `data/backups-migracao/hub_antes_migracao_001_<data-hora>.db`, aberta e conferida (`integrity_check = ok` e mesmas contagens de linhas de todas as tabelas do original), com SHA-256 anotado. Sem backup conferido, aborta. (Recomenda-se também rodar `npm run backup` antes, para ter cópia no servidor — item do roteiro 7.5.)
5. **Ensaio na cópia:** aplica a migração inteira (passo 6) numa **segunda cópia de trabalho** e roda todas as validações. Se o ensaio falhar, aborta sem tocar no banco real.
6. **Aplicação no banco real — uma única transação `BEGIN EXCLUSIVE`** (bloqueia qualquer outra escrita):
   1. cria `clientes`, `servicos`, `cliente_servicos` e índices (seção 5.1);
   2. cria o departamento `contabil` ("Contábil") em cada escritório que ainda não o tenha;
   3. cria o catálogo inicial em cada escritório: `folha`/Folha/PJ, `fiscal`/Fiscal/PJ, `contabil`/Contábil/PJ, `domestica`/Doméstica/PF;
   4. registra `migracao.aplicada` `{ versao: 1 }` em cada escritório;
   5. grava `user_version = 1`;
   6. **valida dentro da transação** (seção 7.4);
   7. se tudo passar → `COMMIT`; se qualquer passo ou validação falhar → `ROLLBACK` **integral** (tabelas, departamentos, serviços, registros e versão voltam ao estado anterior).
7. **Pós-confirmação:** `wal_checkpoint(TRUNCATE)`, novo `integrity_check` e relatório.

### 7.4 Validações dentro da transação

| Verificação | Esperado |
|---|---|
| Tabelas e índices novos | Existem, com as colunas da seção 5.1 |
| Departamento Contábil | Exatamente **1** `contabil` por escritório, com o `tenant_id` do próprio escritório |
| Catálogo | Exatamente as **4** chaves por escritório, com `tipo_cliente` correto (3 PJ, 1 PF), todas ativas |
| Vínculos | `foreign_key_check` vazio; nenhum serviço ou departamento ligado a escritório inexistente |
| Dados existentes intocados | Contagens de `tenants`, `usuarios`, `usuario_departamentos`, `sessoes` iguais às de antes; `departamentos` = antes + nº de escritórios sem Contábil; `registro` = antes + nº de escritórios |
| Ligações de usuários | Nenhum usuário ganhou acesso novo (Contábil nasce sem vínculos) |
| Versão | `user_version = 1` |
| Integridade | `integrity_check = ok` |

### 7.5 Roteiro de execução no banco real (exige autorização expressa)

1. Autorização expressa do responsável, por escrito, para a migração 001.
2. Fechar o Hub.
3. `npm run backup` (cópia no servidor) e conferir que terminou com sucesso.
4. `npm run migrar` (faz o backup local verificado, o ensaio e a aplicação).
5. Ler o relatório com o responsável.
6. Abrir o Hub e conferir: login, menu, Contábil disponível para administradores.

**Se a migração falhar:** o banco real fica exatamente como antes (rollback) e o relatório diz em qual passo e por quê. **Se for preciso voltar depois de confirmada:** restaurar o arquivo de backup local do passo 4 — operação que também exige autorização.

### 7.6 Relatório

Gravado em `data/logs/migracao-001-<data-hora>.json` e resumido na tela: versão antes/depois; início e fim; caminho, tamanho e SHA-256 do backup; resultado de cada verificação (antes, ensaio, transação, pós); contagens por escritório (código do escritório e números, sem dados pessoais); resultado final (`aplicada`, `ja_aplicada` ou `revertida` + passo e motivo técnico). Nunca contém CPF, CNPJ, nomes de pessoas ou senhas.

### 7.7 Testes da migração (somente bancos em memória ou temporários, dados fictícios)

- Banco **versão 0** com dados fictícios (2 escritórios, usuários, vínculos, sessões, registro) → migra → todas as verificações de 7.4 conferidas uma a uma.
- **Idempotência:** rodar duas vezes → a segunda informa "já aplicada" e não altera nada (nem `registro`).
- **Reversão total:** provocar falha no meio (ex.: banco com uma tabela `servicos` pré-existente incompatível) → nenhuma tabela nova, nenhum Contábil, nenhum serviço, nenhum registro, `user_version = 0`, contagens iguais às de antes.
- **Hub aberto:** com servidor respondendo em `/saude`, a migração aborta antes de qualquer cópia ou gravação.
- **Backup:** gerado, íntegro, contagens iguais ao original; falha no backup aborta sem gravar.
- **Ensaio:** falha no ensaio não toca no banco real.
- **Banco novo** (`abrirBanco` em arquivo vazio e em `:memory:`) nasce na versão 1 com toda a estrutura; `criarEscritorio` cria 3 departamentos e 4 serviços.
- **Banco versão 0 aberto por `abrirBanco`:** continua na versão 0, sem nenhuma tabela nova e sem nenhuma gravação; `criarEscritorio` cria só `fiscal` e `pessoal`; escritório criado na versão 0 recebe Contábil e catálogo na migração.
- **Relatório:** sem CPF, CNPJ, nomes ou senhas.
- **Montagem de banco versão 0 nos testes:** como `abrirBanco` cria bancos novos já na versão 1, os testes da versão 0 usam um auxiliar de teste que cria um banco só com a estrutura base atual (exportada por `src/db.js`), reproduzindo o banco real de hoje.

### 7.8 Proteção enquanto o banco estiver na versão 0 (A-14)

**Conferência feita sobre o código atual:** a aplicação consegue proteger todas as rotas e telas novas sem consultar tabelas inexistentes, com os cinco mecanismos abaixo.

**Quando cada mecanismo entra (revisado no diagnóstico da etapa 5):** M1 e M5 entram na etapa 5; M4 já funciona sem código novo. **M2 e M3 entram na etapa 9**, junto com as rotas de Clientes. Motivo: se M3 entrasse antes, depois da migração real (etapa 6) o menu mostraria "Clientes" apontando para uma página que só existe na etapa 10; e M2 só tem o que proteger quando as rotas existirem.

| # | Mecanismo | Como funciona | Tabelas consultadas na versão 0 |
|---|---|---|---|
| M1 | **Leitura da versão** | `criarApp` lê `PRAGMA user_version` uma vez, ao montar a aplicação, e calcula `recursos = { clientes: versao >= 1 }`. Basta ler uma vez porque a migração só roda com o Hub fechado (seção 7.3, passo 1); ao reabrir, o Hub lê a versão nova. | nenhuma (cabeçalho do arquivo) |
| M2 | **Barreira de disponibilidade** | Logo após as rotas de login e **antes** de qualquer verificação de permissão ou consulta: se `recursos.clientes` for falso e o caminho for `/clientes`, `/api/clientes`, `/api/clientes/...`, `/api/servicos` ou `/api/servicos/...` (comparação por segmento exato — `/api/clientesx` não casa), responde **404** igual ao de rota inexistente (JSON para `/api/...`, página HTML para `/clientes`). Não registra auditoria (não é tentativa de acesso indevido, é recurso inexistente). | nenhuma |
| M3 | **`/api/eu` e menu** | `/api/eu` passa a informar `podeConsultarClientes`, calculado como `recursos.clientes && podeConsultarClientes(db, usuario)`. Na versão 0 a segunda parte nem é executada; o menu esconde "Clientes". | nenhuma nova |
| M4 | **Contábil** | Na versão 0 o departamento `contabil` não existe. `departamentosDoUsuario` (base do menu) não o lista, nem para administrador; `GET /modulos/contabil` e `/api/dep/contabil/...` caem no "departamento não encontrado" de `exigirPermissao` → 404, sem auditoria. Não precisa de verificação de versão. | `departamentos`, `usuario_departamentos` (existentes) |
| M5 | **`criarEscritorio`** | Consulta a versão antes de gravar; na versão 0 não toca em `servicos` nem cria `contabil` (seção 7.2). | nenhuma nova |

**Funcionalidades atuais na versão 0:** login, painel, gerenciamento de usuários, permissões por departamento, módulos Folha e Fiscal, backup, registro e `criar-escritorio` não usam nenhuma tabela nova e continuam iguais.

**Ponto de atenção para a implementação:** toda rota ou tela futura que use `clientes`, `servicos` ou `cliente_servicos` precisa entrar na lista de caminhos da barreira M2. Para não depender de memória, a lista fica numa constante única e um teste percorre todas as rotas novas na versão 0 (abaixo).

**Testes obrigatórios da versão 0** (banco montado com o auxiliar de 7.7, dados fictícios; os itens de rotas novas, `/api/eu` e menu entram na etapa 9, com M2 e M3):

- Cada rota nova (`GET/POST /api/clientes`, `GET/PUT /api/clientes/:id`, `POST /api/clientes/:id/situacao`, `POST /api/clientes/:id/servicos`, `POST /api/clientes/:id/servicos/:contrato/encerrar`, `GET/POST /api/servicos`, `PUT /api/servicos/:id`) e a página `GET /clientes`, com administrador e com usuário comum: **404**, nunca 500 — um 500 indicaria consulta a tabela inexistente. Também confere que nada foi escrito no console de erros.
- Nenhuma dessas chamadas grava em `registro`.
- `/api/eu` traz `podeConsultarClientes: false` para todos, inclusive administrador; o menu (comportamento simulado) não mostra "Clientes" nem "Contábil".
- `GET /modulos/contabil` e `/api/dep/contabil/x`: 404 para administrador e usuário comum, sem registro.
- Funcionalidades atuais: login, `/api/eu`, usuários (criar, editar, desativar, senha, departamentos), `/modulos/folha`, `/modulos/fiscal`, `/api/registro`, `/api/backup/status` e `criarEscritorio` funcionam na versão 0 exatamente como nos testes atuais.
- `user_version` continua 0 e nenhuma tabela nova existe depois de toda a bateria.
- O mesmo conjunto de rotas, depois de migrar o banco do teste para a versão 1 e montar a aplicação de novo, deixa de responder 404 (passa às regras normais de permissão).

## 8. Testes funcionais (resumo)

| Área | Conferir |
|---|---|
| Documentos | CPF/CNPJ válidos e inválidos (inclui alfanumérico e o vetor oficial, minúsculas, todos iguais, tamanhos errados); sempre fictícios gerados por cálculo |
| Banco | CHECKs de tipo, campos por tipo, filial/matriz, contrato entre escritórios, serviço aberto duplicado, fim < início, código no Domínio repetido |
| Regras | Cadastro, correção de documento (validação, unicidade, auditoria sem valores), inativação com encerramento automático, reativação sem reabrir, tipo serviço × tipo cliente |
| Permissões | `exigirConsultaClientes`: administrador, usuário com 1+ departamento, sem departamento (403 + registro), vínculo inconsistente com outro escritório não conta, mudança vale na hora; gravação só administrador |
| Isolamento | A não lê, edita, inativa nem contrata para cliente de B; lista/busca nunca trazem B; catálogo de B recusado em A; filial de A não encontra matriz de B |
| Auditoria | Cada operação registrada; nenhum CPF/CNPJ/código no Domínio/nome de PF no `registro`, com ou sem máscara |
| Módulos | Por módulo e perfil: login, 403 HTML + registro, 404, nível exibido; menu por perfil; Contábil escondido antes da migração |
| Telas | Sintaxe, elementos, rotas, comportamento simulado; conferência no navegador em instância separada com banco em memória |

## 9. Sequência de implementação

Cada etapa: testes + commit próprio + aprovação. 🔒 = toca no banco real e exige autorização expressa específica.

| # | Etapa | Depende de | Banco real |
|---|---|---|---|
| **Fase 1 — Navegação** | | | |
| 1 | Layout comum + menu no painel atual, sem mudar comportamento | — | Não |
| 2 | `src/modulos.js` + `GET /modulos/:chave` (Em preparação, 403 e 404 em HTML); Folha e Fiscal funcionam; Contábil escondido | 1 | Não |
| 3 | Cartões do painel como atalhos; conferência no navegador | 2 | Não |
| **Fase 2 — Base de Clientes (só bancos em memória)** | | | |
| 4 | `src/documentos.js` (CPF, CNPJ numérico e alfanumérico, máscaras). **Começa pela conferência do algoritmo do CNPJ alfanumérico com a publicação oficial da Receita (A-16), apresentada para aprovação antes do código da validação de CNPJ** | — | Não |
| 5a | Controle de versão em `abrirBanco` (`SCHEMA_BASE` + banco novo já na versão 1) + `src/migracoes.js` (estrutura, dados e validação da migração 001, sem comando); `criarEscritorio` conforme a versão (M5); auxiliar de banco versão 0 para testes; ajuste dos testes atuais | 4 | Não |
| 5b | Comando `npm run migrar`: Hub fechado, backup conferido, ensaio em cópia, transação única e relatório (7.3–7.6), com os testes de 7.7 | 5a | Não |
| 5c | Leitura da versão em `criarApp` (M1) e aviso no terminal ao iniciar o Hub na versão 0 | 5b | Não |
| 6 | 🔒 **Migração 001 no banco real** — roteiro 7.5 | 5c + autorização | **Sim** |
| 7 | `src/clientes.js` — cadastro, correção de documento, consulta, inativar/reativar | 6 | Não |
| 8 | Serviços contratados e encerramento automático | 7 | Não |
| **Fase 3 — Uso** | | | |
| 9 | `exigirConsultaClientes` + rotas de clientes e catálogo (isolamento, permissões, pedidos inválidos, auditoria) + barreira de disponibilidade (M2) e `podeConsultarClientes` em `/api/eu` (M3), com os testes de rotas novas na versão 0 (7.8) | 8 | Não |
| 10 | Tela `/clientes` + "Clientes" no menu; conferência no navegador | 9 | Não |
| 11 | Atualizar `CLAUDE.md` (mapa, regra de migrações) e `README.md` | 10 | Não |

**Nota da etapa 5 (5a–5c):** depois desses commits, o Hub continua abrindo normalmente o banco real na versão 0, com Contábil oculto e Clientes ainda inexistente (A-14, seção 7.8). A etapa 6 pode esperar o momento que o responsável escolher. Depois da etapa 6, o Contábil aparece no menu com a página "Em preparação"; "Clientes" só aparece na etapa 9.

**Testes na etapa 5a:** como `abrirBanco` passa a criar bancos novos já na versão 1, os testes que conferem o comportamento da versão 0 usam o auxiliar `tests/banco-versao0.js`; nos demais, o departamento fictício que "só existe em outro escritório" passa de `contabil` para `auditoria`, porque `contabil` agora existe em todo escritório de teste.

**Nota das etapas 7 a 10:** o código de clientes pode ser escrito e testado em bancos de teste na versão 1 mesmo antes da etapa 6; no banco real, ele só fica visível depois da migração, pela barreira M2. A ordem 6 → 7 continua recomendada para que a conferência no navegador (etapa 10) possa ser repetida no Hub real logo após a liberação.

**Etapas futuras (fora desta especificação):** ferramentas em cada módulo; ligar serviços a módulos; Portal do Cliente; integrações por API segura (Domínio, Buscador, Robô Fiscal); criptografia de banco e backups; separar rotas de `src/app.js`.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Dados pessoais de PF em banco sem criptografia e nos backups | Só campos aprovados; auditoria e relatório sem documentos e nomes de PF; destino de backup protegido |
| Divergência de dados fiscais com o Domínio | Aviso na tela; Domínio prevalece |
| Migração no banco real | Hub fechado, backup verificado, ensaio em cópia, transação única com validação e rollback, relatório, autorização expressa |
| Rota nova esquecida fora da barreira da versão 0 | Lista única de caminhos em constante + teste que percorre todas as rotas novas na versão 0 (7.8) |
| Código novo convivendo com banco na versão 0 | Barreira M2 antes de qualquer consulta; testes de 404 (nunca 500) e de funcionalidades atuais na versão 0 |
| Mudança no painel (etapa 1) | Testes atuais da tela antes/depois + navegador |
| Filiais com CNPJ de matriz desatualizado após correção da matriz (A-15) | Aviso "Matriz não encontrada no Hub" na filial; correção manual pelo administrador |
| Algoritmo do CNPJ alfanumérico divergente do oficial | Conferência com a publicação oficial antes do código (A-16) |

## 11. Pendências de decisão

Nenhuma pendência de negócio em aberto. P1, P2 e P3 foram decididas (A-14, A-15, A-16).

Condição de execução que permanece: a **conferência do algoritmo do CNPJ alfanumérico** (A-16) será apresentada para aprovação no início da etapa 4, e a **migração no banco real** (etapa 6) só ocorre com autorização expressa.
