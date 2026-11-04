// Editar departamentos de um usuário. Cada teste tem banco em memória e servidor próprios; dados fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
let db, servidor, base, adminA, fulanoId, adminBId, sicranoBId, tenantA, tenantB;

beforeEach(async () => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId; adminBId = b.usuarioId;
  adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  const adminB = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(b.usuarioId);
  fulanoId = criarUsuario(db, adminA, { nome: 'Fulano A', login: 'fulano', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] });
  sicranoBId = criarUsuario(db, adminB, { nome: 'Sicrano B', login: 'sicrano', senha: SENHA, departamentos: [{ chave: 'fiscal', nivel: 'operacao' }] });
  // departamento que só existe no escritório B
  db.prepare("INSERT INTO departamentos (tenant_id, chave, nome) VALUES (?, 'contabil', 'Contábil')").run(tenantB);
  servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterEach(() => { servidor.close(); db.close(); });

async function entrar(escritorio, login) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio, login, senha: SENHA }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const eu = async (cookie) => (await fetch(`${base}/api/eu`, { headers: { Cookie: cookie } })).json();
const trocar = (cookie, id, corpo) => fetch(`${base}/api/usuarios/${id}/departamentos`, {
  method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
const vinculos = (id) => db.prepare(`SELECT d.chave, d.tenant_id, ud.nivel FROM usuario_departamentos ud
  JOIN departamentos d ON d.id = ud.departamento_id WHERE ud.usuario_id = ? ORDER BY d.chave`).all(id);
const historico = (tenantId) => db.prepare("SELECT usuario_id, detalhe FROM registro WHERE tenant_id = ? AND acao = 'usuario.departamentos' ORDER BY id").all(tenantId);

test('troca todos os vínculos, vale na hora para a sessão aberta e registra antes/depois', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  const novos = [{ chave: 'pessoal', nivel: 'operacao' }, { chave: 'fiscal', nivel: 'consulta' }];

  assert.equal((await trocar(admin, fulanoId, { departamentos: novos })).status, 200);
  assert.deepEqual(vinculos(fulanoId), [
    { chave: 'fiscal', tenant_id: tenantA, nivel: 'consulta' },
    { chave: 'pessoal', tenant_id: tenantA, nivel: 'operacao' },
  ]);
  assert.deepEqual((await eu(fulano)).departamentos.map((d) => [d.chave, d.nivel]), [['fiscal', 'consulta'], ['pessoal', 'operacao']]);

  const [r] = historico(tenantA);
  assert.equal(r.usuario_id, adminA.id);
  assert.deepEqual(JSON.parse(r.detalhe), {
    login: 'fulano',
    antes: [{ chave: 'pessoal', nivel: 'consulta' }],
    depois: [{ chave: 'fiscal', nivel: 'consulta' }, { chave: 'pessoal', nivel: 'operacao' }],
  });
});

test('lista vazia tira o acesso a todos os departamentos', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  assert.equal((await trocar(admin, fulanoId, { departamentos: [] })).status, 200);
  assert.deepEqual(vinculos(fulanoId), []);
  assert.deepEqual((await eu(fulano)).departamentos, []);
  assert.deepEqual(JSON.parse(historico(tenantA)[0].detalhe).depois, []);
});

test('sem mudança (mesmo conjunto em outra ordem): responde ok e não grava no histórico', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  await trocar(admin, fulanoId, { departamentos: [{ chave: 'fiscal', nivel: 'consulta' }, { chave: 'pessoal', nivel: 'operacao' }] });
  assert.equal((await trocar(admin, fulanoId, { departamentos: [{ chave: 'pessoal', nivel: 'operacao' }, { chave: 'fiscal', nivel: 'consulta' }] })).status, 200);
  assert.equal(historico(tenantA).length, 1);
});

test('atômico: um item inválido no meio não altera nenhum vínculo', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const casos = [
    [{ chave: 'fiscal', nivel: 'operacao' }, { chave: 'nao-existe', nivel: 'consulta' }],
    [{ chave: 'fiscal', nivel: 'operacao' }, { chave: 'pessoal', nivel: 'gerente' }],
    [{ chave: 'fiscal', nivel: 'operacao' }, { chave: 'fiscal', nivel: 'consulta' }],
  ];
  for (const departamentos of casos) {
    const r = await trocar(admin, fulanoId, { departamentos });
    assert.equal(r.status, 400, JSON.stringify(departamentos));
    assert.ok((await r.json()).erro);
  }
  assert.deepEqual(vinculos(fulanoId), [{ chave: 'pessoal', tenant_id: tenantA, nivel: 'consulta' }]);
  assert.equal(historico(tenantA).length, 0);
});

test('isolamento: departamento que só existe em outro escritório é recusado', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const r = await trocar(admin, fulanoId, { departamentos: [{ chave: 'contabil', nivel: 'consulta' }] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /Departamento desconhecido: contabil/);
  assert.deepEqual(vinculos(fulanoId), [{ chave: 'pessoal', tenant_id: tenantA, nivel: 'consulta' }]);
});

test('isolamento: vínculo novo aponta para o departamento do próprio escritório', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  await trocar(admin, fulanoId, { departamentos: [{ chave: 'fiscal', nivel: 'operacao' }] });
  assert.deepEqual(vinculos(fulanoId), [{ chave: 'fiscal', tenant_id: tenantA, nivel: 'operacao' }]);
});

test('isolamento: administrador de A não altera usuário de B', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  for (const id of [sicranoBId, adminBId]) {
    const r = await trocar(admin, id, { departamentos: [] });
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { erro: 'Usuário não encontrado.' });
  }
  assert.deepEqual(vinculos(sicranoBId), [{ chave: 'fiscal', tenant_id: tenantB, nivel: 'operacao' }]);
  assert.equal(historico(tenantA).length + historico(tenantB).length, 0);
});

test('acesso: usuário comum recebe 403 e sem login 401', async () => {
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  const tudo = { departamentos: [{ chave: 'fiscal', nivel: 'operacao' }, { chave: 'pessoal', nivel: 'operacao' }] };
  assert.equal((await trocar(fulano, fulanoId, tudo)).status, 403);
  assert.equal((await trocar('', fulanoId, tudo)).status, 401);
  assert.deepEqual(vinculos(fulanoId), [{ chave: 'pessoal', tenant_id: tenantA, nivel: 'consulta' }]);
});

test('pedidos inválidos: formato da lista, itens, id e tipo do pedido', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const casos = [{}, { departamentos: null }, { departamentos: 'fiscal' }, { departamentos: { chave: 'fiscal', nivel: 'consulta' } },
    { departamentos: [null] }, { departamentos: ['fiscal'] }, { departamentos: [{ chave: 'fiscal' }] }, { departamentos: [{ nivel: 'consulta' }] },
    { departamentos: [{ chave: 'FISCAL', nivel: 'consulta' }] }, { departamentos: [{ chave: 'fiscal', nivel: 'Consulta' }] }];
  for (const corpo of casos) {
    const r = await trocar(admin, fulanoId, corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.ok((await r.json()).erro);
  }
  for (const id of ['0', 'abc', '007', '999999']) {
    assert.equal((await trocar(admin, id, { departamentos: [] })).status, 404, id);
  }
  const semJson = await fetch(`${base}/api/usuarios/${fulanoId}/departamentos`, {
    method: 'PUT', headers: { Cookie: admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'departamentos=' });
  assert.equal(semJson.status, 415);
  assert.deepEqual(vinculos(fulanoId), [{ chave: 'pessoal', tenant_id: tenantA, nivel: 'consulta' }]);
  assert.equal(historico(tenantA).length, 0);
});
