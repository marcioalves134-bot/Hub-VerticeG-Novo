// Editar nome e perfil de usuários. Cada teste tem banco em memória e servidor próprios; dados fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { alterarSituacaoUsuario, criarEscritorio, criarUsuario, editarUsuario } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
let db, servidor, base, adminA, fulanoId, adminBId, tenantA, tenantB;

beforeEach(async () => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId; adminBId = b.usuarioId;
  adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  fulanoId = criarUsuario(db, adminA, { nome: 'Fulano A', login: 'fulano', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] });
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
const editar = (cookie, id, corpo) => fetch(`${base}/api/usuarios/${id}`, {
  method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
const dados = (id) => db.prepare('SELECT nome, perfil, ativo FROM usuarios WHERE id = ?').get(id);
const edicoes = (tenantId) => db.prepare("SELECT usuario_id, detalhe FROM registro WHERE tenant_id = ? AND acao = 'usuario.editado' ORDER BY id").all(tenantId);

test('editar nome e perfil: vale na hora para a sessão aberta e registra antes/depois', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');

  assert.equal((await editar(admin, fulanoId, { nome: '  Fulano de Tal  ', perfil: 'admin' })).status, 200);
  assert.deepEqual(dados(fulanoId), { nome: 'Fulano de Tal', perfil: 'admin', ativo: 1 });
  const comoAdmin = await eu(fulano);
  assert.equal(comoAdmin.nome, 'Fulano de Tal');
  assert.equal(comoAdmin.perfil, 'admin');
  assert.deepEqual(comoAdmin.departamentos.map((d) => d.chave), ['contabil', 'fiscal', 'pessoal']);

  const [r] = edicoes(tenantA);
  assert.equal(r.usuario_id, adminA.id);
  assert.deepEqual(JSON.parse(r.detalhe), { login: 'fulano', antes: { nome: 'Fulano A', perfil: 'usuario' }, depois: { nome: 'Fulano de Tal', perfil: 'admin' } });
});

test('voltar a usuário comum: departamentos vinculados continuam valendo', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  await editar(admin, fulanoId, { nome: 'Fulano A', perfil: 'admin' });
  assert.equal((await editar(admin, fulanoId, { nome: 'Fulano A', perfil: 'usuario' })).status, 200);

  const comum = await eu(fulano);
  assert.equal(comum.perfil, 'usuario');
  assert.deepEqual(comum.departamentos.map((d) => [d.chave, d.nivel]), [['pessoal', 'consulta']]);
  assert.deepEqual(JSON.parse(edicoes(tenantA).at(-1).detalhe), { login: 'fulano', antes: { perfil: 'admin' }, depois: { perfil: 'usuario' } });
});

test('sem mudança: responde ok e não grava no histórico', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  assert.equal((await editar(admin, fulanoId, { nome: 'Fulano A', perfil: 'usuario' })).status, 200);
  assert.equal(edicoes(tenantA).length, 0);
});

test('administrador pode mudar o próprio nome, mas não tirar o próprio perfil de administrador', async () => {
  criarUsuario(db, adminA, { nome: 'Admin Dois', login: 'admin2', senha: SENHA, perfil: 'admin' });
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  assert.equal((await editar(admin, adminA.id, { nome: 'Admin A Novo', perfil: 'admin' })).status, 200);
  assert.equal(dados(adminA.id).nome, 'Admin A Novo');

  const r = await editar(admin, adminA.id, { nome: 'Admin A Novo', perfil: 'usuario' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /próprio perfil de administrador/);
  assert.equal(dados(adminA.id).perfil, 'admin');
});

test('último administrador ativo não deixa de ser administrador', async () => {
  const admin2Id = criarUsuario(db, adminA, { nome: 'Admin Dois', login: 'admin2', senha: SENHA, perfil: 'admin' });
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  // com dois administradores ativos, rebaixar o outro é permitido
  assert.equal((await editar(admin, admin2Id, { nome: 'Admin Dois', perfil: 'usuario' })).status, 200);
  assert.equal((await editar(admin, admin2Id, { nome: 'Admin Dois', perfil: 'admin' })).status, 200);

  // dois administradores rebaixando um ao outro ao mesmo tempo: o segundo pedido
  // chega com o autor já rebaixado e não pode deixar o escritório sem administrador
  const admin2 = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(admin2Id);
  editarUsuario(db, adminA, admin2Id, { nome: 'Admin Dois', perfil: 'usuario' });
  assert.throws(() => editarUsuario(db, admin2, adminA.id, { nome: 'Admin A', perfil: 'usuario' }), /pelo menos um administrador ativo/);
  assert.equal(dados(adminA.id).perfil, 'admin');
});

test('administrador inativo pode ser rebaixado; o único ativo continua administrador', async () => {
  const admin2Id = criarUsuario(db, adminA, { nome: 'Admin Dois', login: 'admin2', senha: SENHA, perfil: 'admin' });
  alterarSituacaoUsuario(db, adminA, admin2Id, false);
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  assert.equal((await editar(admin, admin2Id, { nome: 'Admin Dois', perfil: 'usuario' })).status, 200);
  assert.deepEqual(dados(admin2Id), { nome: 'Admin Dois', perfil: 'usuario', ativo: 0 });
  assert.equal(dados(adminA.id).perfil, 'admin');
});

test('isolamento: administrador de A não edita usuário de B', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const r = await editar(admin, adminBId, { nome: 'Invasor', perfil: 'usuario' });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { erro: 'Usuário não encontrado.' });
  assert.deepEqual(dados(adminBId), { nome: 'Admin B', perfil: 'admin', ativo: 1 });
  assert.equal(edicoes(tenantA).length + edicoes(tenantB).length, 0);
});

test('acesso: usuário comum recebe 403 e sem login 401', async () => {
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  assert.equal((await editar(fulano, fulanoId, { nome: 'Fulano A', perfil: 'admin' })).status, 403);
  assert.equal((await editar('', fulanoId, { nome: 'X', perfil: 'admin' })).status, 401);
  assert.deepEqual(dados(fulanoId), { nome: 'Fulano A', perfil: 'usuario', ativo: 1 });
});

test('pedidos inválidos: nome, perfil, id e formato', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const casos = [{}, { perfil: 'usuario' }, { nome: '   ', perfil: 'usuario' }, { nome: 123, perfil: 'usuario' },
    { nome: 'Fulano A' }, { nome: 'Fulano A', perfil: 'gerente' }, { nome: 'Fulano A', perfil: 'ADMIN' }];
  for (const corpo of casos) {
    const r = await editar(admin, fulanoId, corpo);
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.ok((await r.json()).erro);
  }
  for (const id of ['0', 'abc', '007', '999999']) {
    assert.equal((await editar(admin, id, { nome: 'X', perfil: 'usuario' })).status, 404, id);
  }
  const semJson = await fetch(`${base}/api/usuarios/${fulanoId}`, {
    method: 'PUT', headers: { Cookie: admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'nome=X' });
  assert.equal(semJson.status, 415);
  assert.deepEqual(dados(fulanoId), { nome: 'Fulano A', perfil: 'usuario', ativo: 1 });
  assert.equal(edicoes(tenantA).length, 0);
});
