// Páginas dos módulos (GET /modulos/:chave). Banco em memória e servidor próprios por teste; dados fictícios.
// Banco na versão 0 (igual ao real antes da migração 001): o departamento Contábil ainda não existe.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBancoVersao0 } from './banco-versao0.js';
import { criarApp } from '../src/app.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
const TABELAS_ATUAIS = ['departamentos', 'registro', 'sessoes', 'tenants', 'usuario_departamentos', 'usuarios'];
let db, servidor, base, tenantA, tenantB, ids;

beforeEach(async () => {
  db = abrirBancoVersao0();
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId;
  const adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  const adminB = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(b.usuarioId);
  ids = {
    consulta: criarUsuario(db, adminA, { nome: 'Consulta Fiscal', login: 'consulta', senha: SENHA, departamentos: [{ chave: 'fiscal', nivel: 'consulta' }] }),
    operacao: criarUsuario(db, adminA, { nome: 'Operação DP', login: 'operacao', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'operacao' }] }),
    semacesso: criarUsuario(db, adminA, { nome: 'Sem Acesso', login: 'semacesso', senha: SENHA }),
    semacessoB: criarUsuario(db, adminB, { nome: 'Sem Acesso B', login: 'semacesso', senha: SENHA }),
  };
  servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

afterEach(() => { servidor.close(); db.close(); });

async function entrar(escritorio, login) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio, login, senha: SENHA }) });
  return (r.headers.get('set-cookie') || '').split(';')[0];
}
async function abrir(cookie, caminho, metodo = 'GET') {
  const r = await fetch(`${base}${caminho}`, { method: metodo, headers: { Cookie: cookie }, redirect: 'manual' });
  return { status: r.status, tipo: r.headers.get('content-type'), local: r.headers.get('location'), cabecalhos: r.headers, html: await r.text() };
}
const negacoes = (tenantId) => db.prepare("SELECT usuario_id, detalhe FROM registro WHERE tenant_id = ? AND acao = 'permissao.negada' ORDER BY id").all(tenantId)
  .map((r) => ({ usuario_id: r.usuario_id, ...JSON.parse(r.detalhe) }));
const totalRegistro = () => db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;
const tabelas = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);

const PAGINA_OK = (titulo, nivel) => (r) => r.status === 200 && r.html.includes(`<h2>${titulo}</h2>`)
  && r.html.includes(`Seu acesso: <strong>${nivel}</strong>`) && r.html.includes('Operações oficiais: Domínio.') && r.html.includes('<h2>Em preparação</h2>');
const NEGADO = (r) => r.status === 403 && r.html.includes('<h2>Sem acesso a este módulo</h2>');
const NAO_ENCONTRADO = (r) => r.status === 404 && r.html.includes('<h2>Módulo não encontrado</h2>');

test('sem login: todas as páginas de módulo vão para o login, sem registro', async () => {
  const antes = totalRegistro();
  for (const chave of ['folha', 'fiscal', 'contabil', 'inexistente']) {
    const r = await abrir('', `/modulos/${chave}`);
    assert.equal(r.status, 302, chave);
    assert.equal(r.local, '/login', chave);
  }
  assert.equal(totalRegistro(), antes);
});

test('acesso por perfil: Folha e Fiscal conforme o departamento; Contábil não existe ainda', async () => {
  const esperado = {
    admin: { folha: PAGINA_OK('Folha', 'Operação'), fiscal: PAGINA_OK('Fiscal', 'Operação'), contabil: NAO_ENCONTRADO },
    consulta: { folha: NEGADO, fiscal: PAGINA_OK('Fiscal', 'Consulta'), contabil: NAO_ENCONTRADO },
    operacao: { folha: PAGINA_OK('Folha', 'Operação'), fiscal: NEGADO, contabil: NAO_ENCONTRADO },
    semacesso: { folha: NEGADO, fiscal: NEGADO, contabil: NAO_ENCONTRADO },
  };
  for (const [login, porModulo] of Object.entries(esperado)) {
    const cookie = await entrar('escritorio-a', login);
    for (const [chave, confere] of Object.entries(porModulo)) {
      const r = await abrir(cookie, `/modulos/${chave}`);
      assert.ok(confere(r), `${login} /modulos/${chave}: status ${r.status}`);
      assert.equal(r.tipo, 'text/html; charset=utf-8', `${login} ${chave}`);
    }
  }
});

test('Folha mostra o departamento de origem; Fiscal não repete o nome', async () => {
  const cookie = await entrar('escritorio-a', 'admin');
  assert.ok((await abrir(cookie, '/modulos/folha')).html.includes('· Departamento: Pessoal (DP)'));
  assert.ok(!(await abrir(cookie, '/modulos/fiscal')).html.includes('· Departamento:'));
});

test('acesso negado: página com a mensagem da permissão e registro no histórico; permitido e não encontrado não registram', async () => {
  const consulta = await entrar('escritorio-a', 'consulta');
  const semacesso = await entrar('escritorio-a', 'semacesso');
  const antes = totalRegistro();
  await abrir(consulta, '/modulos/fiscal');
  await abrir(consulta, '/modulos/contabil');
  await abrir(consulta, '/modulos/inexistente');
  assert.equal(totalRegistro(), antes, 'acesso permitido e módulo inexistente não geram registro');

  const r = await abrir(consulta, '/modulos/folha');
  assert.ok(r.html.includes('Sem permissão para consultar o departamento Pessoal (DP).'));
  await abrir(semacesso, '/modulos/fiscal');
  assert.deepEqual(negacoes(tenantA), [
    { usuario_id: ids.consulta, departamento: 'pessoal', acao: 'ler' },
    { usuario_id: ids.semacesso, departamento: 'fiscal', acao: 'ler' },
  ]);
  assert.deepEqual(negacoes(tenantB), []);
});

test('isolamento: vínculo de outro escritório não abre módulo e a negação fica no escritório de quem tentou', async () => {
  // dado inválido gravado direto: usuário de A ligado ao "fiscal" de B com Operação
  const fiscalB = db.prepare("SELECT id FROM departamentos WHERE tenant_id = ? AND chave = 'fiscal'").get(tenantB).id;
  db.prepare("INSERT INTO usuario_departamentos (usuario_id, departamento_id, nivel) VALUES (?, ?, 'operacao')").run(ids.semacesso, fiscalB);
  assert.ok(NEGADO(await abrir(await entrar('escritorio-a', 'semacesso'), '/modulos/fiscal')));

  // usuário de B sem vínculo não aproveita os vínculos dos usuários de A
  assert.ok(NEGADO(await abrir(await entrar('escritorio-b', 'semacesso'), '/modulos/fiscal')));
  assert.deepEqual(negacoes(tenantA).map((n) => n.usuario_id), [ids.semacesso]);
  assert.deepEqual(negacoes(tenantB).map((n) => n.usuario_id), [ids.semacessoB]);
});

test('Contábil: abre quando o departamento existir no escritório, só nele', async () => {
  // simula, só neste banco de teste, o departamento que a migração 001 criará
  db.prepare("INSERT INTO departamentos (tenant_id, chave, nome) VALUES (?, 'contabil', 'Contábil')").run(tenantA);
  assert.ok(PAGINA_OK('Contábil', 'Operação')(await abrir(await entrar('escritorio-a', 'admin'), '/modulos/contabil')));
  assert.ok(NEGADO(await abrir(await entrar('escritorio-a', 'semacesso'), '/modulos/contabil')));
  assert.ok(NAO_ENCONTRADO(await abrir(await entrar('escritorio-b', 'admin'), '/modulos/contabil')), 'em B o departamento não existe');
});

test('endereços inválidos e outros métodos: 404, sem registro', async () => {
  const cookie = await entrar('escritorio-a', 'semacesso');
  const antes = totalRegistro();
  assert.ok(NAO_ENCONTRADO(await abrir(cookie, '/modulos/inexistente')));
  for (const caminho of ['/modulos/', '/modulos', '/modulos/FOLHA', '/modulos/folha/', '/modulos/folha/x', '/modulos/%66olha']) {
    assert.equal((await abrir(cookie, caminho)).status, 404, caminho);
  }
  for (const metodo of ['POST', 'PUT', 'DELETE']) assert.equal((await abrir(cookie, '/modulos/fiscal', metodo)).status, 404, metodo);
  assert.equal(totalRegistro(), antes);
});

test('páginas de módulo: cabeçalhos de segurança, layout com menu e texto do banco escapado', async () => {
  db.prepare("UPDATE departamentos SET nome = '<b>DP</b>' WHERE tenant_id = ? AND chave = 'pessoal'").run(tenantA);
  const cookie = await entrar('escritorio-a', 'admin');
  const r = await abrir(cookie, '/modulos/folha');
  assert.ok(r.html.includes('Departamento: &lt;b&gt;DP&lt;/b&gt;'));
  assert.ok(!r.html.includes('<b>DP</b>'));
  for (const [nome, valor] of [['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff'], ['cache-control', 'no-store']]) {
    assert.equal(r.cabecalhos.get(nome), valor, nome);
  }
  assert.match(r.cabecalhos.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const caminho of ['/modulos/folha', '/modulos/contabil']) {
    const html = (await abrir(cookie, caminho)).html;
    assert.ok(html.includes('id="menuPrincipal"') && html.includes('id="sair"'), caminho);
  }
});

test('versão 0: nenhuma tabela nova é criada ou consultada pelas páginas de módulo', async () => {
  assert.deepEqual(tabelas(), TABELAS_ATUAIS);
  for (const login of ['admin', 'consulta', 'semacesso']) {
    const cookie = await entrar('escritorio-a', login);
    for (const chave of ['folha', 'fiscal', 'contabil']) assert.notEqual((await abrir(cookie, `/modulos/${chave}`)).status, 500);
  }
  assert.deepEqual(tabelas(), TABELAS_ATUAIS);
  assert.equal(db.pragma('user_version', { simple: true }), 0);
});
