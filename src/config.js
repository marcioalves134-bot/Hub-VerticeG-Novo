import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// .env simples (CHAVE=valor); variável já definida no ambiente tem prioridade.
const arquivoEnv = join(RAIZ, '.env');
if (existsSync(arquivoEnv)) {
  for (const linha of readFileSync(arquivoEnv, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const HOST = process.env.HUB_HOST || '127.0.0.1';
export const PORTA = Number(process.env.HUB_PORT || 3200);
export const DB_PATH = process.env.HUB_DB_PATH ? resolve(RAIZ, process.env.HUB_DB_PATH) : join(RAIZ, 'data', 'hub.db');
export const SESSAO_HORAS = Number(process.env.HUB_SESSAO_HORAS || 10);
