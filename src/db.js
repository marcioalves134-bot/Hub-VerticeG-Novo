import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Multi-tenant: cada escritório é um tenant; toda tabela de dados tem tenant_id
// e toda consulta das rotas filtra pelo tenant da sessão.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id         INTEGER PRIMARY KEY,
  codigo     TEXT NOT NULL UNIQUE,
  nome       TEXT NOT NULL,
  ativo      INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id          INTEGER PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  nome        TEXT NOT NULL,
  login       TEXT NOT NULL,
  senha_hash  TEXT NOT NULL,
  perfil      TEXT NOT NULL CHECK (perfil IN ('admin', 'usuario')),
  ativo       INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (tenant_id, login)
);

CREATE TABLE IF NOT EXISTS departamentos (
  id         INTEGER PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  chave      TEXT NOT NULL,
  nome       TEXT NOT NULL,
  UNIQUE (tenant_id, chave)
);

CREATE TABLE IF NOT EXISTS usuario_departamentos (
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),
  departamento_id  INTEGER NOT NULL REFERENCES departamentos(id),
  nivel            TEXT NOT NULL CHECK (nivel IN ('consulta', 'operacao')),
  PRIMARY KEY (usuario_id, departamento_id)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token_hash  TEXT PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  expira_em   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registro (
  id          INTEGER PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  usuario_id  INTEGER REFERENCES usuarios(id),
  acao        TEXT NOT NULL,
  detalhe     TEXT,
  em          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_registro_tenant ON registro (tenant_id, id);
`;

export const DEPARTAMENTOS_INICIAIS = [
  { chave: 'fiscal', nome: 'Fiscal' },
  { chave: 'pessoal', nome: 'Pessoal (DP)' },
];

export function abrirBanco(caminho) {
  if (caminho !== ':memory:') mkdirSync(dirname(caminho), { recursive: true });
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

export function registrar(db, { tenantId, usuarioId = null, acao, detalhe = null }) {
  db.prepare('INSERT INTO registro (tenant_id, usuario_id, acao, detalhe) VALUES (?, ?, ?, ?)')
    .run(tenantId, usuarioId, acao, detalhe == null ? null : JSON.stringify(detalhe));
}
