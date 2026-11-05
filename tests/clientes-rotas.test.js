// API de clientes, serviços contratados e catálogo (etapa 9): autenticação, permissões, isolamento, auditoria e versão 0.
// Banco em memória e servidor próprios por teste; só documentos fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { abrirBanco } from '../src/db.js';
import { CAMINHOS_CLIENTES, criarApp } from '../src/app.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';
import { aplicarMigracao001 } from '../src/migracoes.js';
import { abrirBancoVersao0 } from './banco-versao0.js';

const SENHA = 'senha-de-teste-123';
const CNPJ_MATRIZ = '98765432000198';
const CNPJ_FILIAL = '98765432000279';
const CPF = '28001238938';
const HOJE_OU_ANTES = '2026-01-01';

// Todas as rotas novas da etapa 9 (seção 5.5), com números quaisquer nos parâmetros.
const ROTAS_NOVAS = [
  ['GET', '/api/clientes'], ['POST', '/api/clientes'], ['GET', '/api/clientes/1'], ['PUT', '/api/clientes/1'],
  ['POST', '/api/clientes/1/situacao'], ['POST', '/api/clientes/1/servicos'], ['POST', '/api/clientes/1/servicos/1/encerrar'],
  ['GET', '/api/servicos'], ['POST', '/api/servicos'], ['PUT', '/api/servicos/1'],
];

let db, servidor, base, tenantA, tenantB, cookies, ids;

async function montar(banco) {
  db = banco;
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId;
  const adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  ids = {
    adminA: a.usuarioId, adminB: b.usuarioId,
    consulta: criarUsuario(db, adminA, { nome: 'Consulta Fiscal', login: 'consulta', senha: SENHA, departamentos: [{ chave: 'fiscal', nivel: 'consulta' }] }),
    semdep: criarUsuario(db, adminA, { nome: 'Sem Departamento', login: 'semdep', senha: SENHA }),
  };
  servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  cookies = {};
  for (const [nome, escritorio, login] of [['admin', 'escritorio-a', 'admin'], ['consulta', 'escritorio-a', 'consulta'],
    ['semdep', 'escritorio-a', 'semdep'], ['adminB', 'escritorio-b', 'admin']]) {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ escritorio, login, senha: SENHA }) });
    cookies[nome] = r.headers.get('set-cookie').split(';')[0];
  }
}
async function desmontar() {
  await new Promise((ok) => servidor.close(ok));
  db.close();
}
beforeEach(async () => montar(abrirBanco(':memory:')));
afterEach(desmontar);

async function pedir(quem, metodo, caminho, corpo) {
  const headers = { Cookie: quem ? cookies[quem] : '' };
  const opcoes = { method: metodo, headers };
  if (metodo === 'POST' || metodo === 'PUT') { headers['Content-Type'] = 'application/json'; opcoes.body = JSON.stringify(corpo ?? {}); }
  const r = await fetch(`${base}${caminho}`, opcoes);
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch {}
  return { status: r.status, tipo: r.headers.get('content-type'), json, texto };
}
const registros = () => db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;
const auditoria = (acao) => db.prepare('SELECT tenant_id, usuario_id, detalhe FROM registro WHERE acao = ? ORDER BY id').all(acao)
  .map((r) => ({ tenant_id: r.tenant_id, usuario_id: r.usuario_id, ...JSON.parse(r.detalhe) }));
const novoPj = (extra = {}) => ({ tipo: 'PJ', documento: '98.765.432/0001-98', nome: 'Empresa Fictícia Ltda', tipo_estabelecimento: 'matriz', ...extra });
const novoPf = (extra = {}) => ({ tipo: 'PF', documento: '280.012.389-38', nome: 'Pessoa Fictícia da Silva', ...extra });
async function criarCliente(quem, dados) {
  const r = await pedir(quem, 'POST', '/api/clientes', dados);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.id;
}

// --- Autenticação e permissões ---

test('sem login: todas as rotas novas da API respondem 401', async () => {
  for (const [metodo, caminho] of ROTAS_NOVAS) assert.equal((await pedir(null, metodo, caminho, {})).status, 401, `${metodo} ${caminho}`);
});

test('/api/eu informa quem pode consultar clientes: administrador e usuário com departamento sim; sem departamento não', async () => {
  for (const [quem, esperado] of [['admin', true], ['consulta', true], ['semdep', false], ['adminB', true]]) {
    assert.equal((await pedir(quem, 'GET', '/api/eu')).json.podeConsultarClientes, esperado, quem);
  }
});

test('consulta: usuário com departamento lê lista, detalhe e catálogo, mas não grava nada (403 de administrador)', async () => {
  const id = await criarCliente('admin', novoPj());
  for (const caminho of ['/api/clientes', `/api/clientes/${id}`, '/api/servicos']) assert.equal((await pedir('consulta', 'GET', caminho)).status, 200, caminho);
  const antes = registros();
  for (const [metodo, caminho] of ROTAS_NOVAS.filter(([m]) => m !== 'GET')) {
    const r = await pedir('consulta', metodo, caminho.replace('/1', `/${id}`), {});
    assert.equal(r.status, 403, `${metodo} ${caminho}`);
    assert.equal(r.json.erro, 'Acesso só para administrador.');
  }
  assert.equal(registros(), antes);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 1);
});

test('sem departamento: consulta negada (403) com registro "permissao.negada" de recurso clientes', async () => {
  const id = await criarCliente('admin', novoPj());
  for (const caminho of ['/api/clientes', `/api/clientes/${id}`, '/api/servicos']) {
    const r = await pedir('semdep', 'GET', caminho);
    assert.equal(r.status, 403, caminho);
    assert.equal(r.json.erro, 'Sem permissão para consultar clientes.');
  }
  assert.deepEqual(auditoria('permissao.negada'), [1, 2, 3].map(() => ({ tenant_id: tenantA, usuario_id: ids.semdep, recurso: 'clientes' })));
});

test('vínculo inconsistente com departamento de outro escritório não dá consulta de clientes', async () => {
  const fiscalB = db.prepare("SELECT id FROM departamentos WHERE tenant_id = ? AND chave = 'fiscal'").get(tenantB).id;
  db.prepare("INSERT INTO usuario_departamentos (usuario_id, departamento_id, nivel) VALUES (?, ?, 'operacao')").run(ids.semdep, fiscalB);
  assert.equal((await pedir('semdep', 'GET', '/api/clientes')).status, 403);
  assert.equal((await pedir('semdep', 'GET', '/api/eu')).json.podeConsultarClientes, false);
});

test('a permissão de consulta é lida a cada pedido: liberar um departamento passa a permitir na hora', async () => {
  assert.equal((await pedir('semdep', 'GET', '/api/clientes')).status, 403);
  const r = await pedir('admin', 'PUT', `/api/usuarios/${ids.semdep}/departamentos`, { departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] });
  assert.equal(r.status, 200);
  assert.equal((await pedir('semdep', 'GET', '/api/clientes')).status, 200);
});

// --- Clientes pela API ---

test('cadastro, detalhe (com serviços, matriz e filiais), edição e situação pela API', async () => {
  const idMatriz = await criarCliente('admin', novoPj());
  const idFilial = await criarCliente('admin', novoPj({ documento: CNPJ_FILIAL, nome: 'Filial Fictícia', tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  const d = (await pedir('consulta', 'GET', `/api/clientes/${idMatriz}`)).json;
  assert.equal(d.documento, CNPJ_MATRIZ);
  assert.deepEqual(d.filiais.map((f) => f.id), [idFilial]);
  assert.deepEqual(d.servicos, { abertos: [], encerrados: [] });
  assert.equal((await pedir('admin', 'GET', `/api/clientes/${idFilial}`)).json.matriz.id, idMatriz);

  assert.equal((await pedir('admin', 'PUT', `/api/clientes/${idMatriz}`, { telefone: '(11) 3333-4444' })).status, 200);
  assert.equal((await pedir('admin', 'GET', `/api/clientes/${idMatriz}`)).json.telefone, '1133334444');
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${idMatriz}/situacao`, { ativo: false })).status, 200);
  assert.equal((await pedir('admin', 'GET', `/api/clientes/${idMatriz}`)).json.ativo, 0);
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${idMatriz}/situacao`, { ativo: true })).status, 200);
});

test('validações chegam como 400 com a mensagem do módulo, sem repetir o documento', async () => {
  await criarCliente('admin', novoPj());
  const casos = [
    [{ ...novoPj(), documento: '98765432000189' }, /^CNPJ inválido\.$/],
    [novoPj(), /Já existe cliente com este CNPJ/],
    [{ ...novoPf(), nome_fantasia: 'X' }, /não se aplica a pessoa física/],
    [{ ...novoPj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial' }) }, /Informe o CNPJ da matriz/],
    [{ ...novoPf(), tenant_id: tenantB }, /Campo desconhecido: tenant_id/],
  ];
  for (const [dados, padrao] of casos) {
    const r = await pedir('admin', 'POST', '/api/clientes', dados);
    assert.equal(r.status, 400, JSON.stringify(dados));
    assert.match(r.json.erro, padrao);
    assert.ok(!r.texto.includes(CNPJ_MATRIZ) && !r.texto.includes(CNPJ_FILIAL));
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 1);
});

test('lista: filtros por tipo, serviço em aberto, situação, busca com máscara e páginas', async () => {
  const idPj = await criarCliente('admin', novoPj());
  const idPf = await criarCliente('admin', novoPf());
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${idPf}/servicos`, { servico: 'domestica', inicio: HOJE_OU_ANTES })).status, 201);
  const lista = async (q) => (await pedir('consulta', 'GET', `/api/clientes${q}`)).json;
  assert.deepEqual((await lista('')).itens.map((c) => c.id), [idPj, idPf]);
  assert.deepEqual((await lista('?tipo=PF')).itens.map((c) => c.id), [idPf]);
  assert.deepEqual((await lista('?servico=domestica')).itens.map((c) => c.id), [idPf]);
  assert.deepEqual((await lista('?servico=fiscal')).itens, []);
  assert.deepEqual((await lista(`?busca=${encodeURIComponent('98.765.432/0001')}`)).itens.map((c) => c.id), [idPj]);
  assert.deepEqual((await lista('?busca=%25')).itens, [], '% é texto');
  const p = await lista('?pagina=1&tipo=&situacao=todos');
  assert.equal(p.total, 2);
  assert.equal(p.porPagina, 100);
  for (const q of ['?pagina=0', '?pagina=abc', '?pagina=-1', '?tipo=XX', '?situacao=qualquer']) {
    assert.equal((await pedir('consulta', 'GET', `/api/clientes${q}`)).status, 400, q);
  }
  // encerrar o serviço tira o cliente do filtro "em aberto"
  const contrato = (await pedir('admin', 'GET', `/api/clientes/${idPf}`)).json.servicos.abertos[0].contrato;
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${idPf}/servicos/${contrato}/encerrar`, { fim: HOJE_OU_ANTES })).status, 200);
  assert.deepEqual((await lista('?servico=domestica')).itens, []);
});

// --- Serviços contratados pela API ---

test('contratar, encerrar e histórico pela API; inativar encerra os abertos', async () => {
  const id = await criarCliente('admin', novoPj());
  const r = await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'fiscal', inicio: HOJE_OU_ANTES });
  assert.equal(r.status, 201);
  const contrato = r.json.contrato;
  assert.match((await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'fiscal', inicio: HOJE_OU_ANTES })).json.erro, /já está em aberto/);
  assert.match((await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'domestica', inicio: HOJE_OU_ANTES })).json.erro, /só para pessoa física/);
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'folha', inicio: HOJE_OU_ANTES })).status, 201);
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${id}/servicos/${contrato}/encerrar`, { fim: '2026-02-01' })).status, 200);
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${id}/servicos/${contrato}/encerrar`, { fim: '2026-02-01' })).status, 400);
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${id}/servicos/999999/encerrar`, { fim: '2026-02-01' })).status, 404);
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${id}/situacao`, { ativo: false })).status, 200);
  const s = (await pedir('admin', 'GET', `/api/clientes/${id}`)).json.servicos;
  assert.deepEqual(s.abertos, []);
  assert.equal(s.encerrados.length, 2);
  assert.equal(auditoria('cliente.inativado')[0].servicosEncerrados, 1);
});

// --- Catálogo pela API ---

test('catálogo: lista, cria, renomeia, inativa e reativa; auditoria só com chave e campos', async () => {
  const lista = (await pedir('consulta', 'GET', '/api/servicos')).json;
  assert.deepEqual(lista.map((s) => [s.chave, s.tipo_cliente, s.ativo]),
    [['contabil', 'PJ', 1], ['domestica', 'PF', 1], ['fiscal', 'PJ', 1], ['folha', 'PJ', 1]]);
  const r = await pedir('admin', 'POST', '/api/servicos', { chave: 'consultoria', nome: 'Consultoria', tipo_cliente: 'PJ' });
  assert.equal(r.status, 201);
  const idServico = r.json.id;
  assert.equal((await pedir('admin', 'PUT', `/api/servicos/${idServico}`, { nome: 'Consultoria Tributária' })).status, 200);
  assert.equal((await pedir('admin', 'PUT', `/api/servicos/${idServico}`, { ativo: false })).status, 200);
  const id = await criarCliente('admin', novoPj());
  assert.match((await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'consultoria', inicio: HOJE_OU_ANTES })).json.erro, /está inativo no catálogo/);
  assert.equal((await pedir('admin', 'PUT', `/api/servicos/${idServico}`, { ativo: true })).status, 200);
  assert.equal((await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'consultoria', inicio: HOJE_OU_ANTES })).status, 201);
  assert.deepEqual(auditoria('catalogo.servico_criado'), [{ tenant_id: tenantA, usuario_id: ids.adminA, servico: 'consultoria', campos: ['chave', 'nome', 'tipo_cliente'] }]);
  assert.deepEqual(auditoria('catalogo.servico_editado').map((a) => a.campos), [['nome'], ['ativo'], ['ativo']]);
});

test('catálogo: chave inválida ou repetida, nome e tipo inválidos, campo desconhecido', async () => {
  const casos = [
    [{ chave: 'Fiscal', nome: 'X', tipo_cliente: 'PJ' }, /Chave do serviço/],
    [{ chave: 'a', nome: 'X', tipo_cliente: 'PJ' }, /Chave do serviço/],
    [{ chave: 'fiscal', nome: 'Outro Fiscal', tipo_cliente: 'PJ' }, /Já existe serviço com esta chave/],
    [{ chave: 'novo', nome: '  ', tipo_cliente: 'PJ' }, /Informe o nome do serviço/],
    [{ chave: 'novo', nome: 'x'.repeat(61), tipo_cliente: 'PJ' }, /no máximo 60/],
    [{ chave: 'novo', nome: 'Novo', tipo_cliente: 'pj' }, /PJ ou PF/],
    [{ chave: 'novo', nome: 'Novo', tipo_cliente: 'PJ', ativo: false }, /Campo desconhecido: ativo/],
  ];
  for (const [dados, padrao] of casos) {
    const r = await pedir('admin', 'POST', '/api/servicos', dados);
    assert.equal(r.status, 400, JSON.stringify(dados));
    assert.match(r.json.erro, padrao);
  }
  const fiscal = db.prepare("SELECT id FROM servicos WHERE tenant_id = ? AND chave = 'fiscal'").get(tenantA).id;
  assert.match((await pedir('admin', 'PUT', `/api/servicos/${fiscal}`, { chave: 'outra' })).json.erro, /Campo desconhecido: chave/);
  assert.match((await pedir('admin', 'PUT', `/api/servicos/${fiscal}`, { ativo: 'false' })).json.erro, /Situação do serviço inválida/);
});

test('catálogo: tipo de cliente só muda se o serviço nunca teve contratação (I-10)', async () => {
  const semUso = (await pedir('admin', 'POST', '/api/servicos', { chave: 'consultoria', nome: 'Consultoria', tipo_cliente: 'PJ' })).json.id;
  assert.equal((await pedir('admin', 'PUT', `/api/servicos/${semUso}`, { tipo_cliente: 'PF' })).status, 200);
  const fiscal = db.prepare("SELECT id FROM servicos WHERE tenant_id = ? AND chave = 'fiscal'").get(tenantA).id;
  const id = await criarCliente('admin', novoPj());
  const contrato = (await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'fiscal', inicio: HOJE_OU_ANTES })).json.contrato;
  await pedir('admin', 'POST', `/api/clientes/${id}/servicos/${contrato}/encerrar`, { fim: HOJE_OU_ANTES });
  const r = await pedir('admin', 'PUT', `/api/servicos/${fiscal}`, { tipo_cliente: 'PF' });
  assert.equal(r.status, 400);
  assert.match(r.json.erro, /já tem contratações/);
  assert.equal(db.prepare('SELECT tipo_cliente FROM servicos WHERE id = ?').get(fiscal).tipo_cliente, 'PJ');
});

test('nada é excluído: não há rota de exclusão de cliente, contratação ou serviço', async () => {
  const id = await criarCliente('admin', novoPj());
  const contrato = (await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'fiscal', inicio: HOJE_OU_ANTES })).json.contrato;
  const fiscal = db.prepare("SELECT id FROM servicos WHERE tenant_id = ? AND chave = 'fiscal'").get(tenantA).id;
  for (const caminho of [`/api/clientes/${id}`, `/api/clientes/${id}/servicos/${contrato}`, `/api/servicos/${fiscal}`]) {
    assert.equal((await pedir('admin', 'DELETE', caminho)).status, 404, caminho);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cliente_servicos').get().n, 1);
});

// --- Isolamento entre escritórios ---

test('isolamento: administrador de B não lê, edita, inativa, contrata nem encerra em cliente de A (404, nada muda)', async () => {
  const id = await criarCliente('admin', novoPj());
  const contrato = (await pedir('admin', 'POST', `/api/clientes/${id}/servicos`, { servico: 'fiscal', inicio: HOJE_OU_ANTES })).json.contrato;
  const idB = await criarCliente('adminB', novoPj());
  const antes = { clientes: db.prepare('SELECT * FROM clientes ORDER BY id').all(), contratos: db.prepare('SELECT * FROM cliente_servicos ORDER BY id').all() };
  const auditoriaA = db.prepare('SELECT COUNT(*) AS n FROM registro WHERE tenant_id = ?').get(tenantA).n;
  const tentativas = [
    ['GET', `/api/clientes/${id}`], ['PUT', `/api/clientes/${id}`, { nome: 'Invasão' }], ['POST', `/api/clientes/${id}/situacao`, { ativo: false }],
    ['POST', `/api/clientes/${id}/servicos`, { servico: 'folha', inicio: HOJE_OU_ANTES }],
    ['POST', `/api/clientes/${id}/servicos/${contrato}/encerrar`, { fim: HOJE_OU_ANTES }],
    ['POST', `/api/clientes/${idB}/servicos/${contrato}/encerrar`, { fim: HOJE_OU_ANTES }],
  ];
  for (const [metodo, caminho, corpo] of tentativas) assert.equal((await pedir('adminB', metodo, caminho, corpo)).status, 404, `${metodo} ${caminho}`);
  assert.deepEqual((await pedir('adminB', 'GET', '/api/clientes?situacao=todos')).json.itens.map((c) => c.id), [idB]);
  assert.deepEqual((await pedir('adminB', 'GET', '/api/clientes?servico=fiscal')).json.itens, []);
  assert.deepEqual({ clientes: db.prepare('SELECT * FROM clientes ORDER BY id').all(), contratos: db.prepare('SELECT * FROM cliente_servicos ORDER BY id').all() }, {
    clientes: antes.clientes, contratos: antes.contratos,
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registro WHERE tenant_id = ?').get(tenantA).n, auditoriaA);
});

test('isolamento: catálogo de cada escritório é separado; B não edita serviço de A', async () => {
  const fiscalA = db.prepare("SELECT id FROM servicos WHERE tenant_id = ? AND chave = 'fiscal'").get(tenantA).id;
  assert.equal((await pedir('adminB', 'PUT', `/api/servicos/${fiscalA}`, { nome: 'Invasão' })).status, 404);
  assert.equal(db.prepare('SELECT nome FROM servicos WHERE id = ?').get(fiscalA).nome, 'Fiscal');
  await pedir('adminB', 'POST', '/api/servicos', { chave: 'so-de-b', nome: 'Só de B', tipo_cliente: 'PJ' });
  assert.ok(!(await pedir('admin', 'GET', '/api/servicos')).json.some((s) => s.chave === 'so-de-b'));
  const idA = await criarCliente('admin', novoPj());
  assert.match((await pedir('admin', 'POST', `/api/clientes/${idA}/servicos`, { servico: 'so-de-b', inicio: HOJE_OU_ANTES })).json.erro, /não encontrado no catálogo/);
});

// --- Segurança dos pedidos ---

test('gravação só aceita JSON (proteção contra formulário de outro site) e números inválidos dão 404', async () => {
  const r = await fetch(`${base}/api/clientes`, { method: 'POST', headers: { Cookie: cookies.admin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'tipo=PJ' });
  assert.equal(r.status, 415);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 0);
  for (const caminho of ['/api/clientes/abc', '/api/clientes/0', '/api/clientes/007', '/api/servicos/abc']) {
    assert.equal((await pedir('admin', 'GET', caminho)).status, 404, caminho);
  }
  assert.equal((await pedir('admin', 'GET', '/api/clientes/999999')).json.erro, 'Cliente não encontrado.');
});

test('auditoria pela API: nenhum CPF, CNPJ, código no Domínio ou nome de PF no registro', async () => {
  const idPf = await criarCliente('admin', novoPf({ codigo_dominio: 'DOM-77' }));
  await pedir('admin', 'PUT', `/api/clientes/${idPf}`, { documento: '305.112.468-03', nome: 'Nome Novo Fictício' });
  const c = (await pedir('admin', 'POST', `/api/clientes/${idPf}/servicos`, { servico: 'domestica', inicio: HOJE_OU_ANTES })).json.contrato;
  await pedir('admin', 'POST', `/api/clientes/${idPf}/servicos/${c}/encerrar`, { fim: HOJE_OU_ANTES });
  await pedir('admin', 'POST', `/api/clientes/${idPf}/situacao`, { ativo: false });
  await criarCliente('admin', novoPj({ codigo_dominio: 'DOM-88' }));
  await pedir('semdep', 'GET', '/api/clientes');
  const tudo = JSON.stringify(db.prepare('SELECT * FROM registro').all());
  for (const s of [CPF, '30511246803', CNPJ_MATRIZ, '280.012', '98.765', 'DOM-77', 'DOM-88', 'Pessoa Fictícia da Silva', 'Nome Novo Fictício']) {
    assert.ok(!tudo.includes(s), `registro contém: ${s}`);
  }
});

// --- Versão 0 (barreira M2 e M3) ---

test('barreira: a lista de caminhos protegidos cobre todas as rotas novas e a página /clientes', () => {
  const coberto = (caminho) => CAMINHOS_CLIENTES.some((c) => caminho === c || caminho.startsWith(`${c}/`));
  for (const [, caminho] of [...ROTAS_NOVAS, ['GET', '/clientes']]) assert.ok(coberto(caminho), caminho);
  assert.ok(!coberto('/api/clientesx') && !coberto('/clientesx') && !coberto('/api/servicosx'));
});

test('versão 0: todas as rotas novas respondem 404 (nunca 500), sem auditoria, para todos; /api/eu sem Clientes', async () => {
  await desmontar();
  await montar(abrirBancoVersao0());
  const errosNoConsole = [];
  const original = console.error;
  console.error = (...a) => errosNoConsole.push(a);
  try {
    const antes = registros();
    for (const quem of [null, 'admin', 'consulta', 'semdep']) {
      for (const [metodo, caminho] of ROTAS_NOVAS) {
        const r = await pedir(quem, metodo, caminho, {});
        assert.equal(r.status, 404, `${quem} ${metodo} ${caminho}`);
        assert.deepEqual(r.json, { erro: 'Rota não encontrada.' });
      }
      const pagina = await pedir(quem, 'GET', '/clientes');
      assert.equal(pagina.status, 404);
      assert.equal(pagina.texto, 'Página não encontrada.');
    }
    assert.equal(registros(), antes, 'nenhuma auditoria');
    for (const quem of ['admin', 'consulta', 'semdep']) assert.equal((await pedir(quem, 'GET', '/api/eu')).json.podeConsultarClientes, false, quem);
    // caminho parecido não é capturado pela barreira
    assert.equal((await pedir('consulta', 'GET', '/api/clientesx')).status, 403);
  } finally {
    console.error = original;
  }
  assert.deepEqual(errosNoConsole, [], 'nenhum erro interno');
  assert.equal(db.pragma('user_version', { simple: true }), 0);
  assert.ok(!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'clientes'").get(), 'nenhuma tabela nova');
});

test('versão 0 → migrada: depois da migração e de reabrir o Hub, as rotas passam às regras normais', async () => {
  const v0 = abrirBancoVersao0();
  await desmontar();
  await montar(v0);
  assert.equal((await pedir('admin', 'GET', '/api/clientes')).status, 404);
  aplicarMigracao001(db);
  // "reabrir o Hub": nova aplicação sobre o mesmo banco
  await new Promise((ok) => servidor.close(ok));
  servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  assert.equal((await pedir('admin', 'GET', '/api/clientes')).status, 200);
  assert.equal((await pedir('consulta', 'GET', '/api/servicos')).status, 200);
  assert.equal((await pedir('semdep', 'GET', '/api/clientes')).status, 403);
  assert.equal((await pedir('admin', 'GET', '/api/eu')).json.podeConsultarClientes, true);
});
