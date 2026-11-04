// Versão do banco no Hub (etapa 5c): leitura em criarApp e aviso no terminal na versão 0, sem bloquear nada.
// Só bancos em memória ou em pastas temporárias; dados fictícios. Nunca data/hub.db nem a porta 3200.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { abrirBanco } from '../src/db.js';
import { avisoVersaoBanco, criarApp } from '../src/app.js';
import { criarEscritorio } from '../src/escritorios.js';
import { abrirBancoVersao0 } from './banco-versao0.js';

const SENHA = 'senha-de-teste-123';
const pastas = [];
afterEach(() => { while (pastas.length) rmSync(pastas.pop(), { recursive: true, force: true }); });
const tabelas = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);

// --- criarApp identifica a versão ---

test('criarApp identifica a versão do banco: 0 sem Clientes, 1 com Clientes', () => {
  const v0 = abrirBancoVersao0();
  const app0 = criarApp(v0);
  assert.equal(app0.versaoBanco, 0);
  assert.deepEqual(app0.recursos, { clientes: false });
  v0.close();

  const v1 = abrirBanco(':memory:');
  const app1 = criarApp(v1);
  assert.equal(app1.versaoBanco, 1);
  assert.deepEqual(app1.recursos, { clientes: true });
  v1.close();
});

test('aviso: texto claro na versão 0; nenhum aviso na versão atual', () => {
  const aviso = avisoVersaoBanco(0);
  assert.match(aviso, /o banco está na versão 0; esta versão do Hub usa a versão 1/);
  assert.match(aviso, /A migração 001 está pendente/);
  assert.match(aviso, /Clientes e o módulo Contábil ficam indisponíveis/);
  assert.match(aviso, /Nada é migrado automaticamente/);
  assert.match(aviso, /somente com autorização: feche o Hub, rode "npm run backup" e depois "npm run migrar"/);
  assert.equal(avisoVersaoBanco(1), null);
});

test('Hub na versão 0 funciona normalmente e criarApp não migra nem grava nada', async () => {
  const db = abrirBancoVersao0();
  criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const tabelasAntes = tabelas(db);
  const servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    assert.equal((await fetch(`${base}/saude`)).status, 200);
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escritorio: 'escritorio-a', login: 'admin', senha: SENHA }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    for (const caminho of ['/', '/api/eu', '/api/usuarios', '/modulos/folha', '/modulos/fiscal']) {
      assert.equal((await fetch(`${base}${caminho}`, { headers: { Cookie: cookie } })).status, 200, caminho);
    }
    assert.equal((await fetch(`${base}/modulos/contabil`, { headers: { Cookie: cookie } })).status, 404, 'Contábil indisponível na versão 0');
  } finally {
    await new Promise((ok) => servidor.close(ok));
  }
  assert.equal(db.pragma('user_version', { simple: true }), 0);
  assert.deepEqual(tabelas(db), tabelasAntes);
  db.close();
});

// --- Servidor de verdade (src/server.js) em processo separado, com banco temporário e porta livre ---

async function portaLivre() {
  const s = createServer();
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const porta = s.address().port;
  await new Promise((ok) => s.close(ok));
  return porta;
}

/** Sobe src/server.js, espera ele anunciar o endereço, confere /saude e encerra. Devolve as saídas do terminal. */
async function subirServidor(dbPath) {
  const porta = await portaLivre();
  assert.notEqual(porta, 3200);
  const filho = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, HUB_DB_PATH: dbPath, HUB_HOST: '127.0.0.1', HUB_PORT: String(porta) } });
  let saida = '', erros = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { erros += d; });
  try {
    const limite = Date.now() + 15_000;
    while (!saida.includes('Hub Vértice G em') && Date.now() < limite && filho.exitCode === null) await new Promise((r) => setTimeout(r, 50));
    assert.match(saida, /Hub Vértice G em/, `o Hub não iniciou: ${erros}`);
    await new Promise((r) => setTimeout(r, 100)); // o aviso é escrito logo depois do anúncio
    const saude = await fetch(`http://127.0.0.1:${porta}/saude`);
    return { saida, erros: erros, saudeStatus: saude.status };
  } finally {
    filho.kill();
    await new Promise((ok) => (filho.exitCode !== null ? ok() : filho.once('exit', ok)));
  }
}

test('servidor com banco na versão 0: inicia, responde e mostra o aviso da migração pendente, sem migrar', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'hub-teste-versao-'));
  pastas.push(pasta);
  const dbPath = join(pasta, 'hub.db');
  const v0 = abrirBancoVersao0(dbPath);
  criarEscritorio(v0, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const tabelasAntes = tabelas(v0);
  v0.close();

  const r = await subirServidor(dbPath);
  assert.ok(r.saida.includes(`Banco: ${dbPath}`), 'o servidor tem de usar o banco temporário, nunca data/hub.db');
  assert.equal(r.saudeStatus, 200, 'o aviso não impede o Hub de funcionar');
  assert.match(r.erros, /ATENÇÃO: o banco está na versão 0/);
  assert.match(r.erros, /A migração 001 está pendente/);

  const depois = new Database(dbPath, { readonly: true });
  assert.equal(depois.pragma('user_version', { simple: true }), 0, 'nada foi migrado automaticamente');
  assert.deepEqual(tabelas(depois), tabelasAntes);
  depois.close();
});

test('servidor com banco na versão 1: inicia sem aviso', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'hub-teste-versao-'));
  pastas.push(pasta);
  const dbPath = join(pasta, 'hub.db');
  abrirBanco(dbPath).close(); // banco novo nasce na versão 1

  const r = await subirServidor(dbPath);
  assert.ok(r.saida.includes(`Banco: ${dbPath}`));
  assert.equal(r.saudeStatus, 200);
  assert.doesNotMatch(r.erros + r.saida, /ATENÇÃO|migração 001 está pendente/);
});
