// Backup automático: tudo em pastas temporárias, banco fictício e "servidor" simulado por uma pasta local.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFile, writeFile as escrever } from 'node:fs/promises';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, registrar } from '../src/db.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';
import { executarBackup, lerStatusBackup, verificarUltimoNoServidor } from '../src/backup.js';
import { criarApp } from '../src/app.js';

const SENHA = 'senha-de-teste-123';
let raiz, dbPath, destino, filaDir, logPath, travaPath, hub, avisos;

const hash = (arq) => createHash('sha256').update(readFileSync(arq)).digest('hex');
const opcoes = (extra = {}) => ({ dbPath, destino, filaDir, logPath, travaPath, avisar: (t) => avisos.push(t), verificarServidor: false, ...extra });
const arquivosServidor = () => (existsSync(destino) ? readdirSync(destino, { recursive: true }).map(String).filter((n) => n.includes('.')).sort() : []);
const fila = () => (existsSync(filaDir) ? readdirSync(filaDir).sort() : []);
const log = () => readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'hub-teste-backup-'));
  dbPath = join(raiz, 'data', 'hub.db');
  destino = join(raiz, 'servidor');
  mkdirSync(destino);
  filaDir = join(raiz, 'local', 'backups-pendentes');
  logPath = join(raiz, 'data', 'logs', 'backup.log');
  travaPath = join(raiz, 'local', 'backup.trava');
  avisos = [];
  // "Hub em funcionamento": conexão de escrita aberta durante o backup, como o servidor real.
  hub = abrirBanco(dbPath);
  criarEscritorio(hub, { codigo: 'ficticio', nome: 'Escritório Fictício', admin: { nome: 'Admin', login: 'admin', senha: SENHA } });
});

afterEach(() => {
  if (hub.open) hub.close();
  rmSync(raiz, { recursive: true, force: true });
});

test('sucesso: cópia conferida no servidor, arquivo único, fila vazia, log ok', async () => {
  const agora = new Date('2026-11-04T15:30:00Z'); // 12:30 em Brasília
  const r = await executarBackup(opcoes({ agora }));
  assert.equal(r.resultado, 'ok');
  assert.equal(r.backup.nome, 'hub_2026-11-04_123000');
  assert.deepEqual(arquivosServidor(), [join('2026-11', 'hub_2026-11-04_123000.db'), join('2026-11', 'hub_2026-11-04_123000.json')]);
  const enviado = join(destino, '2026-11', 'hub_2026-11-04_123000.db');
  const meta = JSON.parse(readFileSync(join(destino, '2026-11', 'hub_2026-11-04_123000.json'), 'utf8'));
  assert.equal(hash(enviado), meta.sha256);
  const c = new Database(enviado, { readonly: true });
  assert.equal(c.pragma('integrity_check', { simple: true }), 'ok');
  assert.equal(c.pragma('journal_mode', { simple: true }), 'delete');
  assert.equal(c.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n, 1);
  c.close();
  assert.deepEqual(fila(), []);
  assert.equal(log().at(-1).resultado, 'ok');
  assert.equal(avisos.length, 0);
  assert.equal(existsSync(travaPath), false);
});

test('banco original não é modificado (com o Hub aberto e com o Hub fechado)', async () => {
  registrar(hub, { tenantId: 1, acao: 'teste.antes' });
  const antes = [dbPath, `${dbPath}-wal`].map(hash);
  await executarBackup(opcoes({ agora: new Date('2026-11-04T15:30:00Z') }));
  assert.deepEqual([dbPath, `${dbPath}-wal`].map(hash), antes);

  hub.close(); // Hub fechado: sem -wal/-shm
  const fechado = hash(dbPath);
  const r = await executarBackup(opcoes({ agora: new Date('2026-11-04T22:00:00Z') }));
  assert.equal(r.resultado, 'ok');
  assert.equal(hash(dbPath), fechado);
});

test('consistente com o Hub gravando durante o backup', async () => {
  let gravadas = 0;
  const relogio = setInterval(() => { registrar(hub, { tenantId: 1, acao: 'teste.durante' }); gravadas++; }, 1);
  try {
    const r = await executarBackup(opcoes({ agora: new Date('2026-11-04T15:30:00Z') }));
    assert.equal(r.resultado, 'ok');
  } finally {
    clearInterval(relogio);
  }
  const c = new Database(join(destino, '2026-11', 'hub_2026-11-04_123000.db'), { readonly: true });
  assert.equal(c.pragma('integrity_check', { simple: true }), 'ok');
  assert.ok(c.prepare('SELECT COUNT(*) AS n FROM registro').get().n >= 1);
  c.close();
});

test('servidor inacessível: backup fica na fila e é enviado na próxima execução', async () => {
  const fora = join(raiz, 'servidor-desligado');
  const r1 = await executarBackup(opcoes({ destino: fora, agora: new Date('2026-11-04T15:30:00Z') }));
  assert.equal(r1.resultado, 'pendente');
  assert.equal(r1.pendentes, 1);
  assert.deepEqual(fila(), ['hub_2026-11-04_123000.db', 'hub_2026-11-04_123000.json']);
  assert.equal(existsSync(fora), false, 'não cria a pasta do servidor');
  assert.equal(avisos.length, 0, 'menos de 24 h na fila: sem alerta');

  const r2 = await executarBackup(opcoes({ agora: new Date('2026-11-04T22:00:00Z') }));
  assert.equal(r2.resultado, 'ok');
  assert.deepEqual(r2.enviados, ['hub_2026-11-04_123000', 'hub_2026-11-04_190000']);
  assert.deepEqual(fila(), []);
  assert.equal(arquivosServidor().length, 4);
});

test('fila com mais de 24 horas sem envio gera alerta', async () => {
  const fora = join(raiz, 'servidor-desligado');
  await executarBackup(opcoes({ destino: fora, agora: new Date('2026-11-04T15:30:00Z') }));
  const r = await executarBackup(opcoes({ destino: fora, agora: new Date('2026-11-05T16:00:00Z') }));
  assert.equal(r.resultado, 'pendente');
  assert.equal(r.pendentes, 2);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /mais de 24 horas/);
});

test('SHA-256 divergente: nada com nome final no servidor, .parcial apagado, cópia continua na fila', async () => {
  const corrompe = async (de, para) => { await copyFile(de, para); await escrever(para, 'corrompido', { flag: 'a' }); };
  const r = await executarBackup(opcoes({ copiar: corrompe, agora: new Date('2026-11-04T15:30:00Z') }));
  assert.equal(r.resultado, 'falha');
  assert.equal(r.motivo, 'sha_divergente');
  assert.deepEqual(arquivosServidor(), []);
  assert.equal(fila().length, 2);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /FALHOU/);
});

test('falta de espaço: verificada antes e também durante a cópia (ENOSPC)', async () => {
  const r1 = await executarBackup(opcoes({ espacoLivre: async () => 1024, agora: new Date('2026-11-04T15:30:00Z') }));
  assert.equal(r1.motivo, 'sem_espaco');
  assert.deepEqual(arquivosServidor(), []);

  const cheio = async () => { throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); };
  const r2 = await executarBackup(opcoes({ copiar: cheio, agora: new Date('2026-11-04T22:00:00Z') }));
  assert.equal(r2.motivo, 'sem_espaco');
  assert.deepEqual(arquivosServidor(), []);
  assert.equal(r2.pendentes, 2, 'as duas cópias continuam na fila');
  assert.equal(avisos.length, 2);
});

test('banco inválido ou ausente: nada vai para fila nem servidor, e alerta', async () => {
  const lixo = join(raiz, 'lixo.db');
  writeFileSync(lixo, 'isto não é um banco SQLite '.repeat(100));
  const r1 = await executarBackup(opcoes({ dbPath: lixo, agora: new Date('2026-11-04T15:30:00Z') }));
  assert.equal(r1.resultado, 'falha');
  assert.equal(r1.motivo, 'banco_invalido');
  const r2 = await executarBackup(opcoes({ dbPath: join(raiz, 'nao-existe.db'), agora: new Date('2026-11-04T15:31:00Z') }));
  assert.equal(r2.motivo, 'banco_invalido');
  assert.equal(existsSync(join(raiz, 'nao-existe.db')), false, 'não cria banco novo');
  assert.deepEqual(fila(), []);
  assert.deepEqual(arquivosServidor(), []);
  assert.equal(avisos.length, 2);
});

test('execuções simultâneas: só uma roda; trava esquecida há mais de 30 min é retomada', async () => {
  const agora = new Date();
  const [a, b] = await Promise.all([executarBackup(opcoes({ agora })), executarBackup(opcoes({ agora: new Date(agora.getTime() + 1000) }))]);
  assert.deepEqual([a.resultado, b.resultado].sort(), ['ignorado', 'ok']);

  mkdirSync(join(raiz, 'local'), { recursive: true });
  writeFileSync(travaPath, '999');
  assert.equal((await executarBackup(opcoes({ agora: new Date() }))).resultado, 'ignorado');
  assert.ok(existsSync(travaPath), 'não apaga trava de outra execução em andamento');

  const velha = new Date(Date.now() - 31 * 60_000);
  utimesSync(travaPath, velha, velha);
  assert.equal((await executarBackup(opcoes({ agora: new Date(Date.now() + 5000) }))).resultado, 'ok');
});

test('nunca sobrescreve arquivo do servidor com conteúdo diferente; limpa .parcial de envio interrompido', async () => {
  mkdirSync(join(destino, '2026-11'));
  writeFileSync(join(destino, '2026-11', 'hub_2026-11-04_123000.db'), 'outro conteúdo');
  writeFileSync(join(destino, '2026-11', 'hub_2026-11-01_120000.db.parcial'), 'sobra');
  const r = await executarBackup(opcoes({ agora: new Date('2026-11-04T15:30:00Z') }));
  assert.equal(r.motivo, 'conflito');
  assert.equal(readFileSync(join(destino, '2026-11', 'hub_2026-11-04_123000.db'), 'utf8'), 'outro conteúdo');
  assert.equal(existsSync(join(destino, '2026-11', 'hub_2026-11-01_120000.db.parcial')), false);
  assert.equal(fila().length, 2);
});

test('conferência semanal: relê do servidor e detecta backup adulterado', async () => {
  await executarBackup(opcoes({ agora: new Date('2026-11-04T15:30:00Z') }));
  const temp = join(raiz, 'verif');
  assert.deepEqual(await verificarUltimoNoServidor({ destino, tempDir: temp }), { nome: 'hub_2026-11-04_123000', ok: true });
  writeFileSync(join(destino, '2026-11', 'hub_2026-11-04_123000.db'), 'adulterado', { flag: 'a' });
  const v = await verificarUltimoNoServidor({ destino, tempDir: temp });
  assert.equal(v.ok, false);
  assert.deepEqual(readdirSync(temp), [], 'não deixa cópia temporária');
  // No domingo a execução normal faz a conferência e alerta se falhar.
  const r = await executarBackup(opcoes({ verificarServidor: true, agora: new Date('2026-11-08T15:30:00Z') }));
  assert.equal(r.verificacaoSemanal.ok, true, 'o mais recente agora é o de domingo, íntegro');
});

test('status para o painel: atraso de 26 horas e último erro', async () => {
  assert.deepEqual(lerStatusBackup(logPath), { registrado: false, atrasado: true });
  await executarBackup(opcoes({ agora: new Date('2026-11-04T15:30:00Z') }));
  await executarBackup(opcoes({ destino: join(raiz, 'fora'), agora: new Date('2026-11-04T22:00:00Z') }));
  const s1 = lerStatusBackup(logPath, new Date('2026-11-05T12:00:00Z'));
  assert.equal(s1.ultimoOkEm, '2026-11-04T15:30:00.000Z');
  assert.equal(s1.ultimo.resultado, 'pendente');
  assert.equal(s1.ultimo.pendentes, 1);
  assert.equal(s1.atrasado, false);
  assert.equal(lerStatusBackup(logPath, new Date('2026-11-05T18:00:00Z')).atrasado, true);
});

test('rota /api/backup/status: só administrador', async () => {
  await executarBackup(opcoes({ agora: new Date('2026-11-04T15:30:00Z') }));
  const servidor = createServer(criarApp(hub, { backupLogPath: logPath }));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const entrar = async (login) => (await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escritorio: 'ficticio', login, senha: SENHA }) })).headers.get('set-cookie').split(';')[0];
    const admin = await entrar('admin');
    const s = await (await fetch(`${base}/api/backup/status`, { headers: { Cookie: admin } })).json();
    assert.equal(s.ultimo.resultado, 'ok');
    criarUsuario(hub, hub.prepare("SELECT * FROM usuarios WHERE login = 'admin'").get(), { nome: 'Comum', login: 'comum', senha: SENHA });
    assert.equal((await fetch(`${base}/api/backup/status`, { headers: { Cookie: await entrar('comum') } })).status, 403);
    assert.equal((await fetch(`${base}/api/backup/status`)).status, 401);
  } finally {
    servidor.close();
  }
});
