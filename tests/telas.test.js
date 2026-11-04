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
