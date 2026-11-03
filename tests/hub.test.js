// Testes com banco em memória (':memory:'): não tocam em nenhum arquivo de dados.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { conferirSenha, criarSessao, gerarHashSenha, usuarioDaSessao } from '../src/auth.js';
import { criarEscritorio } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
let db, servidor, base;

before(async () => {
  db = abrirBanco(':memory:');
  criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => { servidor.close(); db.close(); });

async function entrar(escritorio, login, senha = SENHA) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio, login, senha }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

const chamar = (cookie, caminho, opcoes = {}) => fetch(`${base}${caminho}`, { ...opcoes, headers: { Cookie: cookie, ...(opcoes.headers || {}) } });
const postar = (cookie, caminho, corpo) => chamar(cookie, caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

test('senha: hash confere só com a senha certa e recusa senha curta', () => {
  const h = gerarHashSenha(SENHA);
  assert.ok(conferirSenha(SENHA, h));
  assert.ok(!conferirSenha('outra-senha-qualquer', h));
  assert.throws(() => gerarHashSenha('curta'), /10 caracteres/);
});

test('login: certo cria sessão com cookie HttpOnly; errado dá 401', async () => {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio: 'escritorio-a', login: 'admin', senha: SENHA }) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await entrar('escritorio-a', 'admin', 'senha-errada-000')).status, 401);
  assert.equal((await entrar('nao-existe', 'admin')).status, 401);
});

test('login: 5 erros seguidos bloqueiam aquele usuário', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await entrar('escritorio-b', 'admin', 'senha-errada-000')).status, 401);
  assert.equal((await entrar('escritorio-b', 'admin')).status, 429);
});

test('sem sessão: painel vai para o login e API dá 401', async () => {
  const r = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login');
  assert.equal((await fetch(`${base}/api/eu`)).status, 401);
});

test('multi-tenant: admin de A só vê e cria usuários de A', async () => {
  const { cookie } = await entrar('escritorio-a', 'admin');
  const lista = await (await chamar(cookie, '/api/usuarios')).json();
  assert.deepEqual(lista.map((u) => u.nome), ['Admin A']);

  const r = await postar(cookie, '/api/usuarios', { nome: 'Fulano A', login: 'fulano', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] });
  assert.equal(r.status, 201);
  const idNovo = (await r.json()).id;
  const tenantA = db.prepare("SELECT id FROM tenants WHERE codigo = 'escritorio-a'").get().id;
  assert.equal(db.prepare('SELECT tenant_id FROM usuarios WHERE id = ?').get(idNovo).tenant_id, tenantA);
  // o vínculo aponta para o departamento do próprio escritório
  const dep = db.prepare(`SELECT d.tenant_id FROM usuario_departamentos ud JOIN departamentos d ON d.id = ud.departamento_id WHERE ud.usuario_id = ?`).get(idNovo);
  assert.equal(dep.tenant_id, tenantA);

  // o usuário de A não entra pelo código de B
  assert.equal((await entrar('escritorio-b', 'fulano')).status, 401);
  const registroB = db.prepare(`SELECT COUNT(*) AS n FROM registro r JOIN tenants t ON t.id = r.tenant_id WHERE t.codigo = 'escritorio-b' AND r.acao = 'usuario.criado'`).get().n;
  assert.equal(registroB, 0);
});

test('usuário comum: vê só os departamentos dele e não acessa administração', async () => {
  const { cookie } = await entrar('escritorio-a', 'fulano');
  const eu = await (await chamar(cookie, '/api/eu')).json();
  assert.deepEqual(eu.departamentos.map((d) => [d.chave, d.nivel]), [['pessoal', 'consulta']]);
  assert.equal(eu.escritorio, 'Escritório A (fictício)');
  for (const caminho of ['/api/usuarios', '/api/registro', '/api/departamentos']) assert.equal((await chamar(cookie, caminho)).status, 403);
  assert.equal((await postar(cookie, '/api/usuarios', { nome: 'X', login: 'xxx', senha: SENHA })).status, 403);
});

test('criar usuário: dados inválidos dão 400 com mensagem', async () => {
  const { cookie } = await entrar('escritorio-a', 'admin');
  const casos = [
    { nome: 'Y', login: 'fulano', senha: SENHA },
    { nome: 'Y', login: 'Maiusculo', senha: SENHA },
    { nome: 'Y', login: 'yyy', senha: 'curta' },
    { nome: 'Y', login: 'yyy', senha: SENHA, departamentos: [{ chave: 'nao-existe', nivel: 'consulta' }] },
  ];
  for (const c of casos) {
    const r = await postar(cookie, '/api/usuarios', c);
    assert.equal(r.status, 400);
    assert.ok((await r.json()).erro);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE login = 'yyy'").get().n, 0);
});

test('POST sem JSON é recusado (proteção contra formulário de outro site)', async () => {
  const { cookie } = await entrar('escritorio-a', 'admin');
  const r = await chamar(cookie, '/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'nome=a' });
  assert.equal(r.status, 415);
});

test('sessão: sair invalida o cookie; sessão vencida deixa de valer', async () => {
  const { cookie } = await entrar('escritorio-a', 'admin');
  assert.equal((await postar(cookie, '/api/logout', {})).status, 200);
  assert.equal((await chamar(cookie, '/api/eu')).status, 401);

  const u = db.prepare("SELECT * FROM usuarios WHERE login = 'fulano'").get();
  const token = criarSessao(db, u, 1, new Date('2026-01-01T00:00:00Z'));
  assert.ok(usuarioDaSessao(db, token, new Date('2026-01-01T00:30:00Z')));
  assert.equal(usuarioDaSessao(db, token, new Date('2026-01-01T01:00:01Z')), null);
});

test('usuário desativado perde o acesso na hora', async () => {
  const { cookie } = await entrar('escritorio-a', 'fulano');
  db.prepare("UPDATE usuarios SET ativo = 0 WHERE login = 'fulano'").run();
  assert.equal((await chamar(cookie, '/api/eu')).status, 401);
  assert.equal((await entrar('escritorio-a', 'fulano')).status, 401);
});
