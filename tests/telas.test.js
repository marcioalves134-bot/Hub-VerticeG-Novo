// Conferências estruturais das telas (sem navegador): sintaxe do script, elementos usados e rotas chamadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import vm from 'node:vm';
import { abrirBanco } from '../src/db.js';
import { criarApp } from '../src/app.js';
import { criarEscritorio } from '../src/escritorios.js';
import { PAGINA_LOGIN, PAGINA_PAINEL } from '../src/telas.js';

const scriptDe = (html) => html.match(/<script>([\s\S]*)<\/script>/)[1];

test('telas: o script do login e do painel não tem erro de sintaxe', () => {
  for (const html of [PAGINA_LOGIN, PAGINA_PAINEL]) assert.doesNotThrow(() => new Function(scriptDe(html)));
});

test('painel: todo elemento usado pelo script existe no HTML', () => {
  const script = scriptDe(PAGINA_PAINEL);
  const ids = new Set([...script.matchAll(/getElementById\('([A-Za-z]+)'\)/g)].map((m) => m[1]));
  // elementos usados direto pelo nome e os montados por prefixo ('gDados' + 'Erro' etc.)
  for (const id of ['gTitulo', 'gNome', 'gPerfil', 'gDepsLista', 'gSituacao', 'gSituacaoBotao', 'gNovaSenha']) ids.add(id);
  for (const p of ['gDados', 'gDeps', 'gSituacao', 'gSenha']) { ids.add(p + 'Erro'); ids.add(p + 'Ok'); }
  for (const id of ids) assert.ok(PAGINA_PAINEL.includes(`id="${id}"`), `falta o elemento #${id}`);
});

test('painel: gerenciar usuário chama as quatro rotas com o método certo', () => {
  const script = scriptDe(PAGINA_PAINEL);
  assert.match(script, /api\('\/api\/usuarios\/' \+ gId \+ sufixo/);
  assert.match(script, /acaoGerenciar\('gDados', 'PUT', '',/);
  assert.match(script, /acaoGerenciar\('gDeps', 'PUT', '\/departamentos',/);
  assert.match(script, /acaoGerenciar\('gSituacao', 'POST', '\/situacao',/);
  assert.match(script, /acaoGerenciar\('gSenha', 'POST', '\/senha',/);
  assert.match(script, /'Content-Type': 'application\/json'/);
});

test('painel servido em / tem a coluna Ações e o cartão Gerenciar usuário', async () => {
  const db = abrirBanco(':memory:');
  criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: 'senha-de-teste-123' } });
  const servidor = createServer(criarApp(db));
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  try {
    const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escritorio: 'escritorio-a', login: 'admin', senha: 'senha-de-teste-123' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const html = await (await fetch(`${base}/`, { headers: { Cookie: cookie } })).text();
    assert.ok(html.includes('<th>Ações</th>'));
    assert.ok(html.includes('id="gerenciar" hidden'));
  } finally {
    servidor.close();
    db.close();
  }
});

test('painel: edição de nome/perfil recusada volta os campos aos dados salvos e mantém o erro', async () => {
  // Elementos simulados com os mesmos ids do HTML (o navegador expõe cada id como variável global).
  const elementos = {};
  const novoElemento = () => {
    const ouvintes = {};
    return { value: '', textContent: '', innerHTML: '', hidden: false, className: '', dataset: {}, ouvintes,
      addEventListener: (tipo, fn) => { ouvintes[tipo] = fn; }, scrollIntoView() {} };
  };
  for (const [, id] of PAGINA_PAINEL.matchAll(/id="([A-Za-z]+)"/g)) elementos[id] = novoElemento();

  // Servidor simulado: o PUT de nome/perfil é recusado; a lista devolve o que está salvo.
  const salvos = [
    { id: 1, nome: 'Admin A', login: 'admin', perfil: 'admin', ativo: 1, departamentos: [] },
    { id: 2, nome: 'Fulano A', login: 'fulano', perfil: 'usuario', ativo: 1, departamentos: [] },
  ];
  const pedidos = [];
  const respostas = {
    'GET /api/eu': [200, { nome: 'Admin A', perfil: 'admin', escritorio: 'Escritório A (fictício)', departamentos: [] }],
    'GET /api/usuarios': [200, salvos],
    'GET /api/registro': [200, []],
    'GET /api/departamentos': [200, []],
    'GET /api/backup/status': [200, {}],
    'PUT /api/usuarios/1': [400, { erro: 'Você não pode tirar o próprio perfil de administrador.' }],
  };
  const fetch = async (caminho, opcoes = {}) => {
    const chave = `${opcoes.method || 'GET'} ${caminho}`;
    pedidos.push(chave);
    const [status, corpo] = respostas[chave];
    return { status, ok: status < 400, json: async () => structuredClone(corpo) };
  };
  const document = { getElementById: (id) => elementos[id], querySelectorAll: () => [] };
  const contexto = vm.createContext({ ...elementos, document, fetch, confirm: () => true, location: { href: '' } });
  vm.runInContext(scriptDe(PAGINA_PAINEL), contexto);
  const esperar = () => new Promise((r) => setTimeout(r, 20));
  await esperar();

  // Abre o cartão do administrador e tenta tirar o próprio perfil, mudando também o nome.
  elementos.usuarios.ouvintes.click({ target: { closest: () => ({ dataset: { gerenciar: '1' } }) } });
  elementos.gNome.value = 'Nome Não Salvo';
  elementos.gPerfil.value = 'usuario';
  elementos.gDados.ouvintes.submit({ preventDefault() {} });
  await esperar();

  assert.ok(pedidos.includes('PUT /api/usuarios/1'));
  assert.equal(pedidos.at(-1), 'GET /api/usuarios', 'depois da recusa, a tela busca os dados salvos');
  assert.equal(elementos.gNome.value, 'Admin A');
  assert.equal(elementos.gPerfil.value, 'admin');
  assert.equal(elementos.gDadosErro.textContent, 'Você não pode tirar o próprio perfil de administrador.');
  assert.equal(elementos.gDadosOk.textContent, '');
});

// --- Layout comum e menu (Etapa 1 da Fase 1) ---

/** Roda o script do painel com elementos simulados e o /api/eu informado; devolve elementos e pedidos. */
async function rodarPainel(eu) {
  const elementos = {};
  for (const [, id] of PAGINA_PAINEL.matchAll(/id="([A-Za-z]+)"/g)) {
    const ouvintes = {};
    elementos[id] = { value: '', textContent: '', innerHTML: '', hidden: false, className: '', dataset: {}, ouvintes,
      addEventListener: (tipo, fn) => { ouvintes[tipo] = fn; }, scrollIntoView() {} };
  }
  const pedidos = [];
  const respostas = {
    'GET /api/eu': eu, 'GET /api/usuarios': [], 'GET /api/registro': [], 'GET /api/departamentos': [], 'GET /api/backup/status': {},
    'POST /api/logout': { ok: true },
  };
  const fetch = async (caminho, opcoes = {}) => {
    const chave = `${opcoes.method || 'GET'} ${caminho}`;
    pedidos.push(chave);
    return { status: 200, ok: true, json: async () => structuredClone(respostas[chave]) };
  };
  const location = { href: '', pathname: '/' };
  const document = { getElementById: (id) => elementos[id], querySelectorAll: () => [] };
  vm.runInContext(scriptDe(PAGINA_PAINEL), vm.createContext({ ...elementos, document, fetch, confirm: () => true, location }));
  await new Promise((r) => setTimeout(r, 20));
  return { elementos, pedidos, location };
}

const itensDoMenu = (elementos) => [...elementos.menuPrincipal.innerHTML.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[2], m[1]]);
const dep = (chave, nivel = 'consulta') => ({ chave, nome: chave, nivel });
const euBase = { nome: 'Pessoa Teste', perfil: 'usuario', escritorio: 'Escritório A (fictício)' };

test('layout: painel tem um único bloco de script, cabeçalho com menu e os ids de antes', () => {
  assert.equal(PAGINA_PAINEL.match(/<script>/g).length, 1);
  assert.equal(PAGINA_PAINEL.match(/<\/script>/g).length, 1);
  assert.match(PAGINA_PAINEL, /<header><h1 id="titulo">Hub Vértice G<\/h1><nav class="menu" id="menuPrincipal" aria-label="Menu principal"><\/nav>/);
  for (const id of ['titulo', 'quem', 'sair', 'deps', 'admin', 'backupTexto', 'usuarios', 'gerenciar', 'novo', 'registro']) {
    assert.equal(PAGINA_PAINEL.split(`id="${id}"`).length - 1, 1, `id ${id} deve existir uma única vez`);
  }
});

test('layout: a lista de módulos embutida na página é a de src/modulos.js', async () => {
  const { MODULOS } = await import('../src/modulos.js');
  assert.ok(scriptDe(PAGINA_PAINEL).includes(`const MODULOS = ${JSON.stringify(MODULOS)};`));
});

test('menu: administrador vê Início, Folha e Fiscal (Contábil não existe ainda)', async () => {
  const { elementos } = await rodarPainel({ ...euBase, perfil: 'admin', departamentos: [dep('fiscal', 'operacao'), dep('pessoal', 'operacao')] });
  assert.deepEqual(itensDoMenu(elementos), [['Início', '/'], ['Folha', '/modulos/folha'], ['Fiscal', '/modulos/fiscal']]);
});

test('menu: cada usuário vê só os módulos dos departamentos liberados', async () => {
  const casos = [
    [[dep('fiscal')], [['Início', '/'], ['Fiscal', '/modulos/fiscal']]],
    [[dep('pessoal', 'operacao')], [['Início', '/'], ['Folha', '/modulos/folha']]],
    [[], [['Início', '/']]],
  ];
  for (const [departamentos, esperado] of casos) {
    const { elementos } = await rodarPainel({ ...euBase, departamentos });
    assert.deepEqual(itensDoMenu(elementos), esperado, JSON.stringify(departamentos));
  }
});

test('menu: Contábil aparece quando o departamento existir; Clientes só com permissão informada pelo servidor', async () => {
  const comContabil = await rodarPainel({ ...euBase, departamentos: [dep('contabil'), dep('fiscal')] });
  assert.deepEqual(itensDoMenu(comContabil.elementos), [['Início', '/'], ['Fiscal', '/modulos/fiscal'], ['Contábil', '/modulos/contabil']]);

  const comClientes = await rodarPainel({ ...euBase, departamentos: [dep('fiscal')], podeConsultarClientes: true });
  assert.deepEqual(itensDoMenu(comClientes.elementos), [['Início', '/'], ['Clientes', '/clientes'], ['Fiscal', '/modulos/fiscal']]);
  for (const valor of [false, 'true', 1, undefined]) {
    const { elementos } = await rodarPainel({ ...euBase, departamentos: [], podeConsultarClientes: valor });
    assert.deepEqual(itensDoMenu(elementos), [['Início', '/']], String(valor));
  }
});

test('menu: página atual marcada e texto dos itens escapado', async () => {
  const { elementos } = await rodarPainel({ ...euBase, departamentos: [dep('fiscal')] });
  assert.match(elementos.menuPrincipal.innerHTML, /<a href="\/" aria-current="page">Início<\/a>/);
  assert.doesNotMatch(elementos.menuPrincipal.innerHTML, /href="\/modulos\/fiscal" aria-current/);
});

test('cabeçalho e Sair continuam funcionando como antes', async () => {
  const comum = await rodarPainel({ ...euBase, departamentos: [] });
  assert.equal(comum.elementos.titulo.textContent, 'Hub Vértice G — Escritório A (fictício)');
  assert.equal(comum.elementos.quem.textContent, 'Pessoa Teste');
  assert.ok(!comum.pedidos.includes('GET /api/usuarios'), 'usuário comum não carrega a administração');

  const admin = await rodarPainel({ ...euBase, perfil: 'admin', departamentos: [] });
  assert.equal(admin.elementos.quem.textContent, 'Pessoa Teste (administrador)');
  assert.ok(admin.pedidos.includes('GET /api/usuarios'), 'administrador carrega a administração');

  await admin.elementos.sair.ouvintes.click();
  assert.equal(admin.pedidos.at(-1), 'POST /api/logout');
  assert.equal(admin.location.href, '/login');
});

// --- Páginas dos módulos (Etapa 2 da Fase 1) ---

test('páginas de módulo, 403 e 404: um único script, sem erro de sintaxe e com os elementos do layout', async () => {
  const { paginaModulo, paginaSemAcesso, paginaModuloNaoEncontrado } = await import('../src/telas-modulos.js');
  const paginas = [
    paginaModulo({ chave: 'folha', titulo: 'Folha', departamento: 'pessoal' }, { nome: 'Pessoal (DP)', nivel: 'consulta' }),
    paginaSemAcesso('Sem permissão para consultar o departamento Fiscal.'),
    paginaModuloNaoEncontrado(),
  ];
  for (const html of paginas) {
    assert.equal(html.match(/<script>/g).length, 1);
    assert.doesNotThrow(() => new Function(scriptDe(html)));
    for (const id of ['titulo', 'menuPrincipal', 'quem', 'sair']) assert.ok(html.includes(`id="${id}"`), id);
  }
});

// --- Cartões do painel como atalhos (Etapa 3 da Fase 1) ---

const cartoes = (elementos) => [...elementos.deps.innerHTML.matchAll(
  /<(a|div) class="dep"(?: href="([^"]*)")?><strong>([^<]*)<\/strong><br><small>([^<]*)<\/small>(?:<br><span class="abrir">([^<]*)<\/span>)?<\/\1>/g)]
  .map((m) => ({ tag: m[1], href: m[2] ?? null, nome: m[3], nivel: m[4], abrir: m[5] ?? null }));

test('cartões: Pessoal (DP) leva à Folha e Fiscal ao Fiscal, mantendo nome e nível', async () => {
  const { elementos } = await rodarPainel({ ...euBase, perfil: 'admin', departamentos: [
    { chave: 'fiscal', nome: 'Fiscal', nivel: 'operacao' }, { chave: 'pessoal', nome: 'Pessoal (DP)', nivel: 'operacao' }] });
  assert.deepEqual(cartoes(elementos), [
    { tag: 'a', href: '/modulos/fiscal', nome: 'Fiscal', nivel: 'Operação', abrir: 'Abrir →' },
    { tag: 'a', href: '/modulos/folha', nome: 'Pessoal (DP)', nivel: 'Operação', abrir: 'Abrir →' },
  ]);
});

test('cartões: cada perfil vê só os seus departamentos, com o nível certo', async () => {
  const consulta = await rodarPainel({ ...euBase, departamentos: [{ chave: 'fiscal', nome: 'Fiscal', nivel: 'consulta' }] });
  assert.deepEqual(cartoes(consulta.elementos), [{ tag: 'a', href: '/modulos/fiscal', nome: 'Fiscal', nivel: 'Consulta', abrir: 'Abrir →' }]);
  const operacao = await rodarPainel({ ...euBase, departamentos: [{ chave: 'pessoal', nome: 'Pessoal (DP)', nivel: 'operacao' }] });
  assert.deepEqual(cartoes(operacao.elementos), [{ tag: 'a', href: '/modulos/folha', nome: 'Pessoal (DP)', nivel: 'Operação', abrir: 'Abrir →' }]);
  const semDep = await rodarPainel({ ...euBase, departamentos: [] });
  assert.equal(semDep.elementos.deps.innerHTML, '<p>Nenhum departamento liberado. Fale com o administrador.</p>');
});

test('cartões: departamento sem módulo continua cartão simples; nome vindo do banco é escapado', async () => {
  const { elementos } = await rodarPainel({ ...euBase, departamentos: [
    { chave: 'outro', nome: 'Outro', nivel: 'consulta' }, { chave: 'fiscal', nome: '<b>Fiscal</b>', nivel: 'consulta' }] });
  assert.deepEqual(cartoes(elementos), [
    { tag: 'div', href: null, nome: 'Outro', nivel: 'Consulta', abrir: null },
    { tag: 'a', href: '/modulos/fiscal', nome: '&lt;b&gt;Fiscal&lt;/b&gt;', nivel: 'Consulta', abrir: 'Abrir →' },
  ]);
  assert.equal(elementos.deps.innerHTML.split('Abrir →').length - 1, 1, '"Abrir →" só no atalho');
});
