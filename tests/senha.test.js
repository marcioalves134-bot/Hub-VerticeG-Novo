// Redefinição de senha pelo administrador. Cada teste tem banco em memória e servidor próprios; dados fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
const NOVA = 'nova-senha-ficticia-456';
let db, servidor, base, adminA, fulanoId, adminBId, tenantA, tenantB;

beforeEach(async () => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId; adminBId = b.usuarioId;
  adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  fulanoId = criarUsuario(db, adminA, { nome: 'Fulano A', login: 'fulano', senha: SENHA });
  servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterEach(() => { servidor.close(); db.close(); });

async function entrar(escritorio, login, senha = SENHA) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio, login, senha }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const chamar = (cookie, caminho) => fetch(`${base}${caminho}`, { headers: { Cookie: cookie } });
const redefinir = (cookie, id, corpo) => fetch(`${base}/api/usuarios/${id}/senha`, {
  method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
const hash = (id) => db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(id).senha_hash;
const redefinicoes = (tenantId) => db.prepare("SELECT usuario_id, detalhe FROM registro WHERE tenant_id = ? AND acao = 'usuario.senha_redefinida' ORDER BY id").all(tenantId);

test('redefinir: senha antiga deixa de valer, nova passa a valer e sessões abertas são encerradas', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: fulano1 } = await entrar('escritorio-a', 'fulano');
  const { cookie: fulano2 } = await entrar('escritorio-a', 'fulano');
  const hashAntes = hash(fulanoId);

  const r = await redefinir(admin, fulanoId, { senha: NOVA });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.notEqual(hash(fulanoId), hashAntes);
  assert.ok(hash(fulanoId).startsWith('scrypt$'));

  assert.equal((await chamar(fulano1, '/api/eu')).status, 401);
  assert.equal((await chamar(fulano2, '/api/eu')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?').get(fulanoId).n, 0);
  assert.equal((await entrar('escritorio-a', 'fulano', SENHA)).status, 401);
  assert.equal((await entrar('escritorio-a', 'fulano', NOVA)).status, 200);
  // a sessão do administrador que redefiniu continua valendo
  assert.equal((await chamar(admin, '/api/eu')).status, 200);
});

test('auditoria: registra quem redefiniu e para quem, nunca a senha', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  await entrar('escritorio-a', 'fulano');
  await redefinir(admin, fulanoId, { senha: NOVA });

  const [r] = redefinicoes(tenantA);
  assert.equal(r.usuario_id, adminA.id);
  assert.deepEqual(JSON.parse(r.detalhe), { login: 'fulano', sessoesEncerradas: 1 });
  const tudo = JSON.stringify(db.prepare('SELECT * FROM registro').all());
  assert.ok(!tudo.includes(NOVA), 'a senha nova apareceu no registro');
  assert.ok(!tudo.includes(SENHA), 'a senha antiga apareceu no registro');
  assert.ok(!tudo.includes(hash(fulanoId)), 'o hash da senha apareceu no registro');
  const tela = await (await chamar(admin, '/api/registro')).text();
  assert.ok(!tela.includes(NOVA));
});

test('administrador não redefine a própria senha por esta rota', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const hashAntes = hash(adminA.id);
  const sessoesAntes = db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?').get(adminA.id).n;
  const registroAntes = db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;

  const r = await redefinir(admin, adminA.id, { senha: NOVA });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { erro: 'Você não pode redefinir a própria senha por aqui.' });
  assert.equal(hash(adminA.id), hashAntes);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?').get(adminA.id).n, sessoesAntes);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registro').get().n, registroAntes);
  assert.equal((await chamar(admin, '/api/eu')).status, 200);
  assert.equal((await entrar('escritorio-a', 'admin', NOVA)).status, 401);
  assert.equal((await entrar('escritorio-a', 'admin', SENHA)).status, 200);
});

test('usuário inativo: senha é redefinida, mas ele continua sem acesso', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  db.prepare('UPDATE usuarios SET ativo = 0 WHERE id = ?').run(fulanoId);
  assert.equal((await redefinir(admin, fulanoId, { senha: NOVA })).status, 200);
  assert.equal((await entrar('escritorio-a', 'fulano', NOVA)).status, 401);
});

test('senha inválida: recusada sem alterar nada', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  const hashAntes = hash(fulanoId);
  for (const corpo of [{}, { senha: '' }, { senha: 'curta' }, { senha: '123456789' }, { senha: 1234567890123 }, { senha: null }, { senha: ['x'.repeat(12)] }]) {
    const r = await redefinir(admin, fulanoId, corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.match((await r.json()).erro, /10 caracteres/);
  }
  assert.equal(hash(fulanoId), hashAntes);
  assert.equal((await chamar(fulano, '/api/eu')).status, 200);
  assert.equal(redefinicoes(tenantA).length, 0);
});

test('isolamento: administrador de A não redefine senha de usuário de B', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: adminB } = await entrar('escritorio-b', 'admin');
  const hashAntes = hash(adminBId);

  const r = await redefinir(admin, adminBId, { senha: NOVA });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { erro: 'Usuário não encontrado.' });
  assert.equal(hash(adminBId), hashAntes);
  assert.equal((await chamar(adminB, '/api/eu')).status, 200);
  assert.equal((await entrar('escritorio-b', 'admin', NOVA)).status, 401);
  assert.equal(redefinicoes(tenantA).length + redefinicoes(tenantB).length, 0);
});

test('acesso: usuário comum recebe 403 e sem login 401', async () => {
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  const hashAdmin = hash(adminA.id);
  assert.equal((await redefinir(fulano, adminA.id, { senha: NOVA })).status, 403);
  assert.equal((await redefinir(fulano, fulanoId, { senha: NOVA })).status, 403);
  assert.equal((await redefinir('', fulanoId, { senha: NOVA })).status, 401);
  assert.equal(hash(adminA.id), hashAdmin);
  assert.equal((await entrar('escritorio-a', 'fulano', SENHA)).status, 200);
});

test('pedidos inválidos: id e tipo do pedido', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const hashAntes = hash(fulanoId);
  for (const id of ['0', 'abc', '007', '999999']) {
    assert.equal((await redefinir(admin, id, { senha: NOVA })).status, 404, id);
  }
  const semJson = await fetch(`${base}/api/usuarios/${fulanoId}/senha`, {
    method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `senha=${NOVA}` });
  assert.equal(semJson.status, 415);
  assert.equal((await chamar(admin, `/api/usuarios/${fulanoId}/senha`)).status, 404);
  assert.equal(hash(fulanoId), hashAntes);
});
