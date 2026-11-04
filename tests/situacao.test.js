// Desativar e reativar usuários. Cada teste tem banco em memória e servidor próprios; dados fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { alterarSituacaoUsuario, criarEscritorio, criarUsuario } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
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

async function entrar(escritorio, login) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio, login, senha: SENHA }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const chamar = (cookie, caminho) => fetch(`${base}${caminho}`, { headers: { Cookie: cookie } });
const situacao = (cookie, id, corpo) => fetch(`${base}/api/usuarios/${id}/situacao`, {
  method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
const ativo = (id) => db.prepare('SELECT ativo FROM usuarios WHERE id = ?').get(id).ativo;
const acoes = (tenantId) => db.prepare('SELECT acao, usuario_id, detalhe FROM registro WHERE tenant_id = ? ORDER BY id').all(tenantId);

test('desativar: bloqueia login e sessão aberta, mantém cadastro e registra no histórico', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');

  assert.equal((await situacao(admin, fulanoId, { ativo: false })).status, 200);
  assert.equal(ativo(fulanoId), 0);
  assert.equal((await chamar(fulano, '/api/eu')).status, 401);
  assert.equal((await entrar('escritorio-a', 'fulano')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessoes WHERE usuario_id = ?').get(fulanoId).n, 0);

  const lista = await (await chamar(admin, '/api/usuarios')).json();
  assert.equal(lista.find((u) => u.login === 'fulano').ativo, 0);
  const ultima = acoes(tenantA).at(-1);
  assert.equal(ultima.acao, 'usuario.desativado');
  assert.equal(ultima.usuario_id, adminA.id);
  assert.deepEqual(JSON.parse(ultima.detalhe), { login: 'fulano', sessoesEncerradas: 1 });
  // o histórico anterior do usuário continua lá
  assert.ok(acoes(tenantA).some((r) => r.acao === 'login' && r.usuario_id === fulanoId));
});

test('reativar: volta a entrar com login novo; cookie antigo continua inválido', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: antigo } = await entrar('escritorio-a', 'fulano');
  await situacao(admin, fulanoId, { ativo: false });

  assert.equal((await situacao(admin, fulanoId, { ativo: true })).status, 200);
  assert.equal(ativo(fulanoId), 1);
  assert.equal((await chamar(antigo, '/api/eu')).status, 401);
  const novo = await entrar('escritorio-a', 'fulano');
  assert.equal(novo.status, 200);
  assert.equal((await chamar(novo.cookie, '/api/eu')).status, 200);
  assert.equal(acoes(tenantA).at(-2).acao, 'usuario.reativado');
});

test('reativar encerra sessão que tenha sobrado de desativação feita fora da rota', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const { cookie: antigo } = await entrar('escritorio-a', 'fulano');
  db.prepare('UPDATE usuarios SET ativo = 0 WHERE id = ?').run(fulanoId);

  assert.equal((await situacao(admin, fulanoId, { ativo: true })).status, 200);
  assert.equal((await chamar(antigo, '/api/eu')).status, 401);
});

test('administrador não desativa o próprio usuário', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const r = await situacao(admin, adminA.id, { ativo: false });
  assert.equal(r.status, 400);
  assert.match((await r.json()).erro, /próprio usuário/);
  assert.equal(ativo(adminA.id), 1);
});

test('último administrador ativo não pode ser desativado', async () => {
  const admin2Id = criarUsuario(db, adminA, { nome: 'Admin Dois', login: 'admin2', senha: SENHA, perfil: 'admin' });
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  // com dois administradores, desativar o outro é permitido
  assert.equal((await situacao(admin, admin2Id, { ativo: false })).status, 200);
  assert.equal((await situacao(admin, admin2Id, { ativo: true })).status, 200);

  // dois administradores desativando um ao outro ao mesmo tempo: o segundo pedido
  // chega com o autor já desativado e não pode deixar o escritório sem administrador
  const admin2 = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(admin2Id);
  alterarSituacaoUsuario(db, adminA, admin2Id, false);
  assert.throws(() => alterarSituacaoUsuario(db, admin2, adminA.id, false), /pelo menos um administrador ativo/);
  assert.equal(ativo(adminA.id), 1);
});

test('isolamento: administrador de A não desativa nem reativa usuário de B', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  const antes = acoes(tenantB).length;
  for (const corpo of [{ ativo: false }, { ativo: true }]) {
    const r = await situacao(admin, adminBId, corpo);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { erro: 'Usuário não encontrado.' });
  }
  assert.equal(ativo(adminBId), 1);
  assert.equal(acoes(tenantB).length, antes);
  assert.ok(!acoes(tenantA).some((r) => r.acao.startsWith('usuario.desativado') || r.acao.startsWith('usuario.reativado')));
});

test('acesso: usuário comum recebe 403 e sem login 401', async () => {
  const { cookie: fulano } = await entrar('escritorio-a', 'fulano');
  assert.equal((await situacao(fulano, adminA.id, { ativo: false })).status, 403);
  assert.equal((await situacao('', fulanoId, { ativo: false })).status, 401);
  assert.equal(ativo(adminA.id), 1);
  assert.equal(ativo(fulanoId), 1);
});

test('pedidos inválidos: situação errada, id inválido, sem JSON e estado repetido', async () => {
  const { cookie: admin } = await entrar('escritorio-a', 'admin');
  for (const corpo of [{}, { ativo: 'false' }, { ativo: 0 }, { ativo: null }]) {
    assert.equal((await situacao(admin, fulanoId, corpo)).status, 400, JSON.stringify(corpo));
  }
  for (const id of ['0', 'abc', '007', '999999']) {
    assert.equal((await situacao(admin, id, { ativo: false })).status, 404, id);
  }
  const semJson = await fetch(`${base}/api/usuarios/${fulanoId}/situacao`, {
    method: 'POST', headers: { Cookie: admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'ativo=false' });
  assert.equal(semJson.status, 415);
  assert.equal(ativo(fulanoId), 1);

  const ja = await situacao(admin, fulanoId, { ativo: true });
  assert.equal(ja.status, 400);
  assert.match((await ja.json()).erro, /já está ativo/);
  await situacao(admin, fulanoId, { ativo: false });
  assert.match((await (await situacao(admin, fulanoId, { ativo: false })).json()).erro, /já está inativo/);
});
