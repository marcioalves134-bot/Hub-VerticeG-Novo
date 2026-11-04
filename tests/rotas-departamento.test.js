// Barreira das rotas /api/dep/:chave/...: permissão antes de qualquer tratador. Ainda não há tratadores,
// então quem passa pela barreira recebe 404 "Rota não encontrada.". Banco em memória e servidor próprios; dados fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
const PASSOU = { erro: 'Rota não encontrada.' };
const NAO_EXISTE = { erro: 'Departamento não encontrado.' };
let db, servidor, base, tenantA, tenantB, ids;

beforeEach(async () => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId;
  const adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  ids = {
    semacesso: criarUsuario(db, adminA, { nome: 'Sem Acesso', login: 'semacesso', senha: SENHA }),
    consulta: criarUsuario(db, adminA, { nome: 'Só Consulta', login: 'consulta', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] }),
    operacao: criarUsuario(db, adminA, { nome: 'Operação', login: 'operacao', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'operacao' }] }),
  };
  // departamento que só existe no escritório B
  db.prepare("INSERT INTO departamentos (tenant_id, chave, nome) VALUES (?, 'contabil', 'Contábil')").run(tenantB);
  servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterEach(() => { servidor.close(); db.close(); });

async function entrar(escritorio, login) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio, login, senha: SENHA }) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function pedir(cookie, metodo, caminho) {
  const opcoes = { method: metodo, headers: { Cookie: cookie } };
  if (metodo === 'POST' || metodo === 'PUT') { opcoes.headers['Content-Type'] = 'application/json'; opcoes.body = '{}'; }
  const r = await fetch(`${base}${caminho}`, opcoes);
  return { status: r.status, corpo: await r.json() };
}
const negacoes = (tenantId) => db.prepare("SELECT usuario_id, detalhe FROM registro WHERE tenant_id = ? AND acao = 'permissao.negada' ORDER BY id").all(tenantId)
  .map((r) => ({ usuario_id: r.usuario_id, ...JSON.parse(r.detalhe) }));
const totalRegistro = () => db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;

test('sem login: 401 antes de qualquer verificação', async () => {
  const antes = totalRegistro();
  assert.equal((await pedir('', 'GET', '/api/dep/pessoal/x')).status, 401);
  assert.equal(totalRegistro(), antes);
});

test('níveis por método: GET = ler, POST/PUT = gravar, DELETE = excluir', async () => {
  const esperado = {
    semacesso: { GET: 403, POST: 403, PUT: 403, DELETE: 403 },
    consulta: { GET: 404, POST: 403, PUT: 403, DELETE: 403 },
    operacao: { GET: 404, POST: 404, PUT: 404, DELETE: 403 },
    admin: { GET: 404, POST: 404, PUT: 404, DELETE: 404 },
  };
  for (const [login, porMetodo] of Object.entries(esperado)) {
    const cookie = await entrar('escritorio-a', login);
    for (const [metodo, status] of Object.entries(porMetodo)) {
      const r = await pedir(cookie, metodo, '/api/dep/pessoal/qualquer');
      assert.equal(r.status, status, `${login} ${metodo}`);
      if (status === 404) assert.deepEqual(r.corpo, PASSOU, `${login} ${metodo} passou pela barreira`);
      if (status === 403) assert.match(r.corpo.erro, /Pessoal \(DP\)/);
    }
  }
});

test('negadas entram no histórico; permitidas não', async () => {
  const consulta = await entrar('escritorio-a', 'consulta');
  const antes = totalRegistro();
  await pedir(consulta, 'GET', '/api/dep/pessoal/x');
  assert.equal(totalRegistro(), antes, 'consulta permitida não gera registro');
  await pedir(consulta, 'POST', '/api/dep/pessoal/x');
  await pedir(consulta, 'DELETE', '/api/dep/pessoal/x/1');
  await pedir(consulta, 'GET', '/api/dep/fiscal/x');
  assert.deepEqual(negacoes(tenantA), [
    { usuario_id: ids.consulta, departamento: 'pessoal', acao: 'gravar' },
    { usuario_id: ids.consulta, departamento: 'pessoal', acao: 'excluir' },
    { usuario_id: ids.consulta, departamento: 'fiscal', acao: 'ler' },
  ]);
  assert.deepEqual(negacoes(tenantB), []);
});

test('isolamento: departamento só de outro escritório responde "não encontrado" e não registra', async () => {
  const antes = totalRegistro();
  for (const login of ['admin', 'operacao']) {
    const r = await pedir(await entrar('escritorio-a', login), 'GET', '/api/dep/contabil/x');
    assert.equal(r.status, 404);
    assert.deepEqual(r.corpo, NAO_EXISTE);
  }
  assert.equal(totalRegistro(), antes + 2, 'só os dois logins');
  // no escritório B o mesmo departamento existe e o administrador passa pela barreira
  assert.deepEqual((await pedir(await entrar('escritorio-b', 'admin'), 'DELETE', '/api/dep/contabil/x')).corpo, PASSOU);
});

test('isolamento: vínculo com "pessoal" de A não vale para o "pessoal" de B', async () => {
  // usuário de B sem vínculo é negado, mesmo existindo usuário de A com Operação em "pessoal"
  const adminB = db.prepare('SELECT * FROM usuarios WHERE id = (SELECT id FROM usuarios WHERE tenant_id = ? AND login = ?)').get(tenantB, 'admin');
  criarUsuario(db, adminB, { nome: 'Sem Acesso B', login: 'semacesso', senha: SENHA });
  const r = await pedir(await entrar('escritorio-b', 'semacesso'), 'GET', '/api/dep/pessoal/x');
  assert.equal(r.status, 403);
  assert.equal(negacoes(tenantB).length, 1);
  assert.equal(negacoes(tenantA).length, 0);
});

test('chave inválida, caminho incompleto ou método não previsto: 404 sem verificar e sem registrar', async () => {
  const cookie = await entrar('escritorio-a', 'semacesso');
  const antes = totalRegistro();
  for (const caminho of ['/api/dep/', '/api/dep//x', '/api/dep/PESSOAL/x', '/api/dep/pes.soal/x', '/api/dep/%70essoal/x', `/api/dep/${'a'.repeat(41)}/x`]) {
    const r = await pedir(cookie, 'GET', caminho);
    assert.equal(r.status, 404, caminho);
    assert.deepEqual(r.corpo, PASSOU, caminho);
  }
  const patch = await fetch(`${base}/api/dep/pessoal/x`, { method: 'PATCH', headers: { Cookie: cookie } });
  assert.equal(patch.status, 404);
  assert.equal(totalRegistro(), antes);
});

test('rotas atuais continuam iguais: usuário comum barrado na administração, /api/eu liberado', async () => {
  const cookie = await entrar('escritorio-a', 'operacao');
  for (const caminho of ['/api/usuarios', '/api/departamentos', '/api/registro', '/api/backup/status']) {
    assert.equal((await pedir(cookie, 'GET', caminho)).status, 403, caminho);
  }
  assert.equal((await pedir(cookie, 'GET', '/api/eu')).status, 200);
  assert.equal((await pedir(cookie, 'GET', '/api/depx')).status, 403, '/api/depx não é rota de departamento');
});
