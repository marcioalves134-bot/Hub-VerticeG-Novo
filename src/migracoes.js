// Migrações explícitas do banco (docs/especificacao-clientes-e-modulos.md, seção 7).
// A versão fica em PRAGMA user_version. Banco existente nunca é migrado ao abrir: só por comando explícito.
// Este módulo não importa db.js (db.js usa este módulo para criar bancos novos).
import { createHash } from 'node:crypto';

export const VERSAO_ATUAL = 1;

/** Criados pela migração 001 em cada escritório (e por criarEscritorio em bancos na versão 1). */
export const DEPARTAMENTOS_MIGRACAO_001 = [{ chave: 'contabil', nome: 'Contábil' }];
export const SERVICOS_INICIAIS = [
  { chave: 'folha', nome: 'Folha', tipoCliente: 'PJ' },
  { chave: 'fiscal', nome: 'Fiscal', tipoCliente: 'PJ' },
  { chave: 'contabil', nome: 'Contábil', tipoCliente: 'PJ' },
  { chave: 'domestica', nome: 'Doméstica', tipoCliente: 'PF' },
];

// Sem IF NOT EXISTS: se já houver tabela com esse nome, a migração falha e é desfeita.
const ESTRUTURA_001 = `
CREATE TABLE clientes (
  id                     INTEGER PRIMARY KEY,
  tenant_id              INTEGER NOT NULL REFERENCES tenants(id),
  tipo                   TEXT NOT NULL CHECK (tipo IN ('PJ', 'PF')),
  documento              TEXT NOT NULL,
  nome                   TEXT NOT NULL,
  nome_fantasia          TEXT,
  inscricao_estadual     TEXT,
  inscricao_municipal    TEXT,
  tipo_estabelecimento   TEXT CHECK (tipo_estabelecimento IN ('matriz', 'filial')),
  cnpj_matriz            TEXT,
  contato_responsavel    TEXT,
  data_nascimento        TEXT,
  whatsapp               TEXT,
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
`;

const TABELAS_001 = {
  clientes: ['id', 'tenant_id', 'tipo', 'documento', 'nome', 'nome_fantasia', 'inscricao_estadual', 'inscricao_municipal', 'tipo_estabelecimento',
    'cnpj_matriz', 'contato_responsavel', 'data_nascimento', 'whatsapp', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf',
    'telefone', 'email', 'codigo_dominio', 'ativo', 'criado_em', 'atualizado_em'],
  servicos: ['id', 'tenant_id', 'chave', 'nome', 'tipo_cliente', 'ativo'],
  cliente_servicos: ['id', 'tenant_id', 'cliente_id', 'servico_id', 'inicio', 'fim'],
};
const INDICES_001 = ['idx_clientes_dominio', 'idx_clientes_nome', 'idx_clientes_matriz', 'idx_servico_aberto', 'idx_cliente_servicos'];
const TABELAS_BASE = ['tenants', 'usuarios', 'departamentos', 'usuario_departamentos', 'sessoes', 'registro'];

export function versaoDoBanco(db) {
  return db.pragma('user_version', { simple: true });
}

const contar = (db, tabela) => db.prepare(`SELECT COUNT(*) AS n FROM "${tabela}"`).get().n;
const contagensBase = (db) => Object.fromEntries(TABELAS_BASE.map((t) => [t, contar(db, t)]));

/** SHA-256 de todas as linhas da tabela até `ateRowid`, em ordem de rowid. Fica só na memória; nunca vai para relatório. */
function impressaoDigital(db, tabela, ateRowid) {
  const h = createHash('sha256');
  for (const linha of db.prepare(`SELECT rowid AS _rowid_, * FROM "${tabela}" WHERE rowid <= ? ORDER BY rowid`).iterate(ateRowid)) {
    h.update(JSON.stringify(linha)).update('\n');
  }
  return h.digest('hex');
}

/** Retrato das tabelas antigas antes da migração: maior rowid e impressão digital das linhas existentes. */
function retratoTabelasBase(db) {
  return Object.fromEntries(TABELAS_BASE.map((t) => {
    const maxRowid = db.prepare(`SELECT COALESCE(MAX(rowid), 0) AS m FROM "${t}"`).get().m;
    return [t, { maxRowid, impressao: impressaoDigital(db, t, maxRowid) }];
  }));
}

/** Cria em um escritório o que a migração 001 cria (departamento Contábil e catálogo). Não duplica. */
export function criarItensMigracao001(db, tenantId) {
  const dep = db.prepare('INSERT OR IGNORE INTO departamentos (tenant_id, chave, nome) VALUES (?, ?, ?)');
  for (const d of DEPARTAMENTOS_MIGRACAO_001) dep.run(tenantId, d.chave, d.nome);
  const serv = db.prepare('INSERT OR IGNORE INTO servicos (tenant_id, chave, nome, tipo_cliente) VALUES (?, ?, ?, ?)');
  for (const s of SERVICOS_INICIAIS) serv.run(tenantId, s.chave, s.nome, s.tipoCliente);
}

function falhar(motivo) {
  throw new Error(`Validação da migração 001 falhou: ${motivo}`);
}

/** Conferências da seção 7.4, executadas dentro da transação da migração. */
function validarMigracao001(db, antes, semContabilAntes, retratoAntes) {
  for (const [tabela, colunas] of Object.entries(TABELAS_001)) {
    const reais = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(tabela).map((c) => c.name);
    if (JSON.stringify(reais) !== JSON.stringify(colunas)) falhar(`colunas de ${tabela} diferentes do esperado`);
  }
  const indices = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((i) => i.name));
  for (const i of INDICES_001) if (!indices.has(i)) falhar(`índice ${i} ausente`);

  for (const { id } of db.prepare('SELECT id FROM tenants').all()) {
    for (const d of DEPARTAMENTOS_MIGRACAO_001) {
      if (db.prepare('SELECT COUNT(*) AS n FROM departamentos WHERE tenant_id = ? AND chave = ?').get(id, d.chave).n !== 1) {
        falhar(`escritório ${id} sem exatamente um departamento ${d.chave}`);
      }
    }
    const catalogo = db.prepare('SELECT chave, tipo_cliente, ativo FROM servicos WHERE tenant_id = ? ORDER BY chave').all(id);
    const esperado = [...SERVICOS_INICIAIS].sort((a, b) => (a.chave < b.chave ? -1 : 1)).map((s) => ({ chave: s.chave, tipo_cliente: s.tipoCliente, ativo: 1 }));
    if (JSON.stringify(catalogo) !== JSON.stringify(esperado)) falhar(`catálogo de serviços do escritório ${id} diferente do esperado`);
  }
  if (contar(db, 'servicos') !== SERVICOS_INICIAIS.length * antes.tenants) falhar('quantidade total de serviços diferente do esperado');
  if (db.pragma('foreign_key_check').length) falhar('vínculos inconsistentes (foreign_key_check)');

  const depois = contagensBase(db);
  for (const t of ['tenants', 'usuarios', 'usuario_departamentos', 'sessoes']) {
    if (depois[t] !== antes[t]) falhar(`a tabela ${t} mudou (${antes[t]} → ${depois[t]})`);
  }
  if (depois.departamentos !== antes.departamentos + semContabilAntes) falhar('quantidade de departamentos diferente do esperado');
  if (depois.registro !== antes.registro + antes.tenants) falhar('quantidade de registros diferente do esperado');

  // Conteúdo: toda linha que existia antes continua idêntica (nenhum campo alterado, nenhuma linha removida).
  for (const [t, { maxRowid, impressao }] of Object.entries(retratoAntes)) {
    if (impressaoDigital(db, t, maxRowid) !== impressao) falhar(`registros já existentes da tabela ${t} foram alterados`);
  }
  // Linhas novas (rowid maior que o de antes) só podem ser as que a migração cria.
  const depsNovos = db.prepare('SELECT chave FROM departamentos WHERE rowid > ?').all(retratoAntes.departamentos.maxRowid);
  if (depsNovos.some((d) => !DEPARTAMENTOS_MIGRACAO_001.some((m) => m.chave === d.chave))) falhar('departamento novo inesperado');
  const regNovos = db.prepare('SELECT acao, usuario_id FROM registro WHERE rowid > ?').all(retratoAntes.registro.maxRowid);
  if (regNovos.some((r) => r.acao !== 'migracao.aplicada' || r.usuario_id !== null)) falhar('registro novo inesperado');
  const acessoContabil = db.prepare(`SELECT COUNT(*) AS n FROM usuario_departamentos ud JOIN departamentos d ON d.id = ud.departamento_id
    WHERE d.chave IN (${DEPARTAMENTOS_MIGRACAO_001.map(() => '?').join(',')})`).get(...DEPARTAMENTOS_MIGRACAO_001.map((d) => d.chave)).n;
  if (acessoContabil !== 0) falhar('algum usuário ganhou acesso a departamento novo');
  if (versaoDoBanco(db) !== 1) falhar('user_version diferente de 1');
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') falhar('integrity_check');
  return depois;
}

/**
 * Migração 001 (versão 0 → 1) numa única transação exclusiva: estrutura, Contábil e catálogo em cada escritório,
 * registro por escritório, versão e validação. Qualquer falha desfaz tudo. Devolve o resumo para o relatório.
 */
export function aplicarMigracao001(db) {
  const versaoAntes = versaoDoBanco(db);
  if (versaoAntes !== 0) throw new Error(`A migração 001 exige o banco na versão 0; versão atual: ${versaoAntes}.`);
  const antes = contagensBase(db);
  const retratoAntes = retratoTabelasBase(db);
  const escritorios = db.prepare('SELECT id, codigo FROM tenants ORDER BY id').all();
  const semContabilAntes = db.prepare(`SELECT COUNT(*) AS n FROM tenants t WHERE NOT EXISTS
    (SELECT 1 FROM departamentos d WHERE d.tenant_id = t.id AND d.chave = 'contabil')`).get().n;

  const depois = db.transaction(() => {
    db.exec(ESTRUTURA_001);
    const registrar = db.prepare("INSERT INTO registro (tenant_id, usuario_id, acao, detalhe) VALUES (?, NULL, 'migracao.aplicada', ?)");
    for (const { id } of escritorios) {
      criarItensMigracao001(db, id);
      registrar.run(id, JSON.stringify({ versao: 1 }));
    }
    db.pragma('user_version = 1');
    return validarMigracao001(db, antes, semContabilAntes, retratoAntes);
  }).exclusive();

  return { versaoAntes, versaoDepois: versaoDoBanco(db), escritorios: escritorios.map((e) => e.codigo), contagensAntes: antes, contagensDepois: depois,
    tabelasConferidas: TABELAS_BASE };
}
