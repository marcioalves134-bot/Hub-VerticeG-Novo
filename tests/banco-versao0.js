// Auxiliar de teste: banco igual ao real de hoje (versão 0, só a estrutura base, sem migrações).
// abrirBanco cria bancos novos já na versão atual; para testar a versão 0, use esta função.
import Database from 'better-sqlite3';
import { SCHEMA_BASE } from '../src/db.js';

export function abrirBancoVersao0(caminho = ':memory:') {
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_BASE);
  return db;
}
