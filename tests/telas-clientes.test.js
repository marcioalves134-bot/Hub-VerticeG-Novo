// Tela /clientes (Etapa 10): estrutura da página e comportamento simulado (sem navegador), com dados fictícios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { formatarCnpj, formatarCpf } from '../src/documentos.js';
import { PAGINA_CLIENTES } from '../src/telas-clientes.js';

const scriptDe = (html) => html.match(/<script>([\s\S]*)<\/script>/)[1];
const IDS = [...PAGINA_CLIENTES.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
const esperar = () => new Promise((r) => setTimeout(r, 20));

// Documentos fictícios: CNPJ alfanumérico do vetor conferido na etapa 4 e CPF gerado por cálculo.
const CNPJ_ALFA = '12ABC34501DE35';
const CNPJ_FILIAL = '12ABC34502DE06';
const CPF = '28001238938';

const CATALOGO = [
  { id: 1, chave: 'contabil', nome: 'Contábil', tipo_cliente: 'PJ', ativo: 1 },
  { id: 2, chave: 'domestica', nome: 'Doméstica', tipo_cliente: 'PF', ativo: 1 },
  { id: 3, chave: 'fiscal', nome: 'Fiscal', tipo_cliente: 'PJ', ativo: 1 },
  { id: 4, chave: 'folha', nome: 'Folha', tipo_cliente: 'PJ', ativo: 0 },
];
const EU_ADMIN = { nome: 'Admin A', perfil: 'admin', escritorio: 'Escritório A (fictício)', departamentos: [], podeConsultarClientes: true };
const EU_CONSULTA = { nome: 'Consulta A', perfil: 'usuario', escritorio: 'Escritório A (fictício)',
  departamentos: [{ chave: 'fiscal', nome: 'Fiscal', nivel: 'consulta' }], podeConsultarClientes: true };
const LISTA = { itens: [
  { id: 1, tipo: 'PJ', documento: CNPJ_ALFA, nome: 'Empresa Fictícia Ltda', nome_fantasia: 'Fictícia', tipo_estabelecimento: 'matriz', municipio: 'Cidade Teste', uf: 'SP', ativo: 1 },
  { id: 2, tipo: 'PF', documento: CPF, nome: 'Pessoa Fictícia', nome_fantasia: null, tipo_estabelecimento: null, municipio: null, uf: null, ativo: 0 },
], total: 1234, pagina: 1, porPagina: 100 };
const CLIENTE_PJ = {
  id: 1, tipo: 'PJ', documento: CNPJ_ALFA, nome: 'Empresa Fictícia Ltda', nome_fantasia: 'Fictícia', inscricao_estadual: null, inscricao_municipal: null,
  tipo_estabelecimento: 'matriz', cnpj_matriz: null, contato_responsavel: null, data_nascimento: null, whatsapp: null, cep: '01001000',
  logradouro: 'Rua Teste', numero: '10', complemento: null, bairro: 'Centro', municipio: 'Cidade Teste', uf: 'SP', telefone: '1133334444',
  email: null, codigo_dominio: '77', ativo: 1, matriz: null,
  filiais: [{ id: 3, nome: 'Empresa Fictícia Filial', documento: CNPJ_FILIAL, ativo: 1 }],
  servicos: { abertos: [{ contrato: 10, servico: 'fiscal', nome: 'Fiscal', inicio: '2026-01-05', fim: null }],
    encerrados: [{ contrato: 9, servico: 'contabil', nome: 'Contábil', inicio: '2025-02-01', fim: '2025-12-31' }] },
};
const CLIENTE_FILIAL = { ...CLIENTE_PJ, id: 3, documento: CNPJ_FILIAL, nome: 'Empresa Fictícia Filial', tipo_estabelecimento: 'filial',
  cnpj_matriz: CNPJ_ALFA, matriz: null, filiais: [], servicos: { abertos: [], encerrados: [] } };

/**
 * Roda o script da página com elementos simulados. `respostas` mapeia "MÉTODO caminho" para [status, corpo]
 * (ou função que recebe o corpo enviado). getElementById falha se o id não existir no HTML.
 */
async function rodar({ eu = EU_ADMIN, search = '', respostas = {}, confirmar = true, nomeNovo = null } = {}) {
  const elementos = {};
  for (const id of IDS) {
    const ouvintes = {};
    elementos[id] = { id, value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, className: '', dataset: {}, ouvintes,
      addEventListener: (tipo, fn) => { ouvintes[tipo] = fn; } };
  }
  const pedidos = [];
  const perguntas = [];
  const tabela = {
    'GET /api/eu': [200, eu], 'GET /api/servicos': [200, CATALOGO], 'GET /api/clientes/1': [200, CLIENTE_PJ],
    'GET /api/clientes/3': [200, CLIENTE_FILIAL], 'POST /api/logout': [200, { ok: true }], ...respostas,
  };
  const fetch = async (caminho, opcoes = {}) => {
    const metodo = opcoes.method || 'GET';
    const corpo = opcoes.body ? JSON.parse(opcoes.body) : undefined;
    pedidos.push({ metodo, caminho, corpo });
    const chave = `${metodo} ${caminho.startsWith('/api/clientes?') ? '/api/clientes?' : caminho}`;
    let resposta = tabela[chave];
    if (typeof resposta === 'function') resposta = resposta(corpo, caminho);
    if (!resposta) throw new Error(`pedido inesperado: ${chave}`);
    const [status, json] = resposta;
    return { status, ok: status < 400, json: async () => structuredClone(json) };
  };
  const document = {
    getElementById: (id) => { if (!elementos[id]) throw new Error(`id inexistente no HTML: ${id}`); return elementos[id]; },
  };
  const location = { href: '', pathname: '/clientes', search };
  const contexto = vm.createContext({
    ...elementos, document, fetch, location, URLSearchParams,
    confirm: (texto) => { perguntas.push(texto); return confirmar; },
    prompt: (texto) => { perguntas.push(texto); return nomeNovo; },
  });
  vm.runInContext(scriptDe(PAGINA_CLIENTES), contexto);
  await esperar();
  const clicar = async (id, dataset) => {
    elementos[id].ouvintes.click({ target: { closest: () => (dataset ? { dataset } : null) } });
    await esperar();
  };
  const enviarForm = async (id) => { elementos[id].ouvintes.submit({ preventDefault() {} }); await esperar(); };
  return { elementos, pedidos, perguntas, location, clicar, enviarForm };
}
const listaPadrao = { 'GET /api/clientes?': [200, LISTA] };

// --- Estrutura ---

test('tela clientes: um único script, sem erro de sintaxe, ids únicos e layout comum', () => {
  assert.equal(PAGINA_CLIENTES.match(/<script>/g).length, 1);
  assert.doesNotThrow(() => new Function(scriptDe(PAGINA_CLIENTES)));
  assert.equal(new Set(IDS).size, IDS.length, 'ids repetidos');
  for (const id of ['titulo', 'menuPrincipal', 'quem', 'sair', 'secLista', 'secDetalhe', 'secForm', 'secCatalogo', 'lista', 'filtros']) {
    assert.ok(IDS.includes(id), id);
  }
  assert.ok(PAGINA_CLIENTES.includes('Dados fiscais oficiais: Domínio.'));
  assert.ok(PAGINA_CLIENTES.includes('<title>Clientes — Hub Vértice G</title>'));
});

test('tela clientes: as máscaras usadas na página são as de src/documentos.js', () => {
  const script = scriptDe(PAGINA_CLIENTES);
  assert.ok(script.includes(formatarCpf.toString()));
  assert.ok(script.includes(formatarCnpj.toString()));
});

test('tela clientes: o formulário tem campo para todo dado editável de PJ e PF', () => {
  for (const campo of ['documento', 'nome', 'nome_fantasia', 'inscricao_estadual', 'inscricao_municipal', 'tipo_estabelecimento', 'cnpj_matriz',
    'contato_responsavel', 'data_nascimento', 'whatsapp', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf',
    'telefone', 'email', 'codigo_dominio']) assert.ok(IDS.includes(`cf_${campo}`), campo);
});

// --- Lista ---

test('lista: documento com máscara (CNPJ alfanumérico e CPF), situação e contagem no padrão brasileiro', async () => {
  const { elementos } = await rodar({ respostas: listaPadrao });
  const html = elementos.lista.innerHTML;
  assert.ok(html.includes('12.ABC.345/01DE-35'));
  assert.ok(html.includes('280.012.389-38'));
  assert.ok(html.includes('<a href="/clientes?id=1">Empresa Fictícia Ltda</a>'));
  assert.ok(html.includes('PJ · Matriz') && html.includes('Cidade Teste/SP') && html.includes('Inativo'));
  assert.equal(elementos.pagInfo.textContent, '1.234 clientes · página 1 de 13');
  assert.equal(elementos.pagAnterior.disabled, true);
  assert.equal(elementos.pagProxima.disabled, false);
  assert.equal(elementos.secLista.hidden, false);
  assert.equal(elementos.secDetalhe.hidden, true);
});

test('lista: filtros e paginação montam a consulta da API; erro da API aparece na tela', async () => {
  const { elementos, pedidos, enviarForm, clicar } = await rodar({ respostas: listaPadrao });
  elementos.fBusca.value = ' 12.ABC ';
  elementos.fTipo.value = 'PJ';
  elementos.fServico.value = 'fiscal';
  elementos.fSituacao.value = 'todos';
  await enviarForm('filtros');
  assert.equal(pedidos.at(-1).caminho, '/api/clientes?busca=12.ABC&tipo=PJ&servico=fiscal&situacao=todos&pagina=1');
  await clicar('pagProxima');
  assert.match(pedidos.at(-1).caminho, /pagina=2$/);

  const comErro = await rodar({ respostas: { 'GET /api/clientes?': [400, { erro: 'Situação inválida.' }] } });
  assert.equal(comErro.elementos.listaErro.textContent, 'Situação inválida.');
});

test('lista: filtro de serviço traz o catálogo inteiro, marcando os inativos', async () => {
  const { elementos } = await rodar({ eu: EU_CONSULTA, respostas: listaPadrao });
  assert.ok(elementos.fServico.innerHTML.includes('<option value="folha">Folha (PJ) — inativo</option>'));
  assert.ok(elementos.fServico.innerHTML.includes('<option value="domestica">Doméstica (PF)</option>'));
});

test('lista: nome vindo do banco é escapado', async () => {
  const lista = { ...LISTA, itens: [{ ...LISTA.itens[0], nome: '<b>X</b>' }] };
  const { elementos } = await rodar({ respostas: { 'GET /api/clientes?': [200, lista] } });
  assert.ok(elementos.lista.innerHTML.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(!elementos.lista.innerHTML.includes('<b>X</b>'));
});

// --- Perfis ---

test('perfil: administrador vê "Novo cliente" e o catálogo com ações', async () => {
  const { elementos } = await rodar({ respostas: listaPadrao });
  assert.equal(elementos.novoCliente.hidden, false);
  assert.equal(elementos.secCatalogo.hidden, false);
  assert.ok(elementos.catalogo.innerHTML.includes('data-renomear="1"'));
  assert.ok(elementos.catalogo.innerHTML.includes('data-situacao-servico="4">Reativar'));
});

test('perfil: usuário de consulta só lê — sem "Novo cliente", sem catálogo e sem botões no detalhe', async () => {
  const lista = await rodar({ eu: EU_CONSULTA, respostas: listaPadrao });
  assert.equal(lista.elementos.novoCliente.hidden, true);
  assert.equal(lista.elementos.secCatalogo.hidden, true);
  assert.equal(lista.elementos.catalogo.innerHTML, '');

  const { elementos, pedidos } = await rodar({ eu: EU_CONSULTA, search: '?id=1' });
  assert.equal(elementos.secDetalhe.hidden, false);
  assert.equal(elementos.dAcoesAdmin.hidden, true);
  assert.equal(elementos.contratar.hidden, true);
  assert.equal(elementos.dEncerrarBloco.hidden, true);
  assert.equal(elementos.dColAcao.hidden, true);
  assert.ok(!elementos.dAbertos.innerHTML.includes('Encerrar'));
  assert.equal(elementos.contratarAviso.textContent, '');
  assert.equal(elementos.secCatalogo.hidden, true);
  assert.ok(pedidos.every((p) => p.metodo === 'GET'), 'nenhuma gravação');
});

test('perfil: sem permissão de consulta (403 da API) a tela mostra a mensagem, sem quebrar', async () => {
  const { elementos } = await rodar({ eu: { ...EU_CONSULTA, podeConsultarClientes: false },
    respostas: { 'GET /api/servicos': [403, { erro: 'Sem permissão para consultar clientes.' }] } });
  assert.match(elementos.aviso.innerHTML, /^Sem permissão para consultar clientes\./);
  for (const s of ['secLista', 'secDetalhe', 'secForm', 'secCatalogo']) assert.equal(elementos[s].hidden, true, s);
});

test('perfil: menu da página marca "Clientes" e segue /api/eu', async () => {
  const { elementos } = await rodar({ eu: EU_CONSULTA, respostas: listaPadrao });
  assert.match(elementos.menuPrincipal.innerHTML, /<a href="\/clientes" aria-current="page">Clientes<\/a>/);
  assert.match(elementos.menuPrincipal.innerHTML, /href="\/modulos\/fiscal"/);
  const semClientes = await rodar({ eu: { ...EU_CONSULTA, podeConsultarClientes: false }, respostas: listaPadrao });
  assert.doesNotMatch(semClientes.elementos.menuPrincipal.innerHTML, /Clientes/);
});

// --- Detalhe ---

test('detalhe: dados com máscara e datas dd/mm/aaaa, filiais com link e aviso do Domínio', async () => {
  const { elementos } = await rodar({ search: '?id=1' });
  assert.equal(elementos.dTitulo.textContent, 'Empresa Fictícia Ltda');
  const dados = elementos.dDados.innerHTML;
  assert.ok(dados.includes('<th>CNPJ</th><td>12.ABC.345/01DE-35</td>'));
  assert.ok(dados.includes('CEP 01001-000') && dados.includes('(11) 3333-4444') && dados.includes('<th>Código no Domínio</th><td>77</td>'));
  assert.ok(elementos.dAbertos.innerHTML.includes('<td>Fiscal</td><td>05/01/2026</td>'));
  assert.ok(elementos.dHistorico.innerHTML.includes('<td>Contábil</td><td>01/02/2025</td><td>31/12/2025</td>'));
  assert.ok(elementos.dVinculos.innerHTML.includes('<a href="/clientes?id=3">Empresa Fictícia Filial — 12.ABC.345/02DE-06</a>'));
});

test('detalhe: filial sem matriz no Hub mostra o aviso; com matriz, mostra o link', async () => {
  const sem = await rodar({ search: '?id=3' });
  assert.ok(sem.elementos.dVinculos.innerHTML.includes('Matriz não encontrada no Hub.'));
  assert.ok(sem.elementos.dDados.innerHTML.includes('<th>CNPJ da matriz</th><td>12.ABC.345/01DE-35</td>'));
  const com = await rodar({ search: '?id=3', respostas: { 'GET /api/clientes/3': [200, { ...CLIENTE_FILIAL,
    matriz: { id: 1, nome: 'Empresa Fictícia Ltda', documento: CNPJ_ALFA, ativo: 1 } }] } });
  assert.ok(com.elementos.dVinculos.innerHTML.includes('Matriz: <a href="/clientes?id=1">Empresa Fictícia Ltda — 12.ABC.345/01DE-35</a>'));
});

test('detalhe: cliente inexistente ou endereço inválido mostram a mensagem', async () => {
  const inexistente = await rodar({ search: '?id=99', respostas: { 'GET /api/clientes/99': [404, { erro: 'Cliente não encontrado.' }] } });
  assert.match(inexistente.elementos.aviso.innerHTML, /^Cliente não encontrado\./);
  const invalido = await rodar({ search: '?id=abc' });
  assert.match(invalido.elementos.aviso.innerHTML, /^Cliente não encontrado\./);
  assert.ok(!invalido.pedidos.some((p) => p.caminho.startsWith('/api/clientes/')));
});

test('detalhe (administrador): contratar oferece só serviços ativos do tipo do cliente que não estão em aberto', async () => {
  const { elementos, pedidos, enviarForm } = await rodar({ search: '?id=1', respostas: {
    'POST /api/clientes/1/servicos': [201, { contrato: 11 }] } });
  assert.equal(elementos.contratar.hidden, false);
  assert.equal(elementos.cServico.innerHTML, '<option value="contabil">Contábil</option>');
  assert.match(elementos.cInicio.value, /^\d{4}-\d{2}-\d{2}$/);
  elementos.cServico.value = 'contabil';
  elementos.cInicio.value = '2026-02-01';
  await enviarForm('contratar');
  assert.deepEqual(pedidos.find((p) => p.metodo === 'POST'), { metodo: 'POST', caminho: '/api/clientes/1/servicos', corpo: { servico: 'contabil', inicio: '2026-02-01' } });
  assert.equal(elementos.dOk.textContent, 'Serviço contratado.');
});

test('detalhe (administrador): encerrar pede confirmação com a data e envia o fim; recusa mostra o erro', async () => {
  const { elementos, pedidos, perguntas, clicar } = await rodar({ search: '?id=1', respostas: {
    'POST /api/clientes/1/servicos/10/encerrar': [400, { erro: 'A data de fim não pode ser anterior à data de início.' }] } });
  assert.ok(elementos.dAbertos.innerHTML.includes('data-encerrar="10"'));
  assert.equal(elementos.dEncerrarBloco.hidden, false);
  elementos.eFim.value = '2026-01-01';
  await clicar('dAbertos', { encerrar: '10' });
  assert.equal(perguntas.at(-1), 'Encerrar Fiscal em 01/01/2026?');
  assert.deepEqual(pedidos.at(-1), { metodo: 'POST', caminho: '/api/clientes/1/servicos/10/encerrar', corpo: { fim: '2026-01-01' } });
  assert.equal(elementos.dErro.textContent, 'A data de fim não pode ser anterior à data de início.');
});

test('detalhe (administrador): inativar avisa que encerra os serviços em aberto; cancelar não envia nada', async () => {
  const cancelado = await rodar({ search: '?id=1', confirmar: false });
  assert.equal(cancelado.elementos.dSituacao.textContent, 'Inativar');
  await cancelado.clicar('dSituacao');
  assert.equal(cancelado.perguntas.at(-1), 'Inativar Empresa Fictícia Ltda? O serviço em aberto será encerrado com a data de hoje.');
  assert.ok(!cancelado.pedidos.some((p) => p.metodo === 'POST'));

  const { pedidos, clicar } = await rodar({ search: '?id=1', respostas: { 'POST /api/clientes/1/situacao': [200, { ok: true }] } });
  await clicar('dSituacao');
  assert.deepEqual(pedidos.find((p) => p.metodo === 'POST').corpo, { ativo: false });
});

test('detalhe (administrador): cliente inativo mostra "Reativar" e não oferece contratação', async () => {
  const { elementos } = await rodar({ search: '?id=1', respostas: { 'GET /api/clientes/1': [200, { ...CLIENTE_PJ, ativo: 0,
    servicos: { abertos: [], encerrados: CLIENTE_PJ.servicos.encerrados } }] } });
  assert.equal(elementos.dSituacao.textContent, 'Reativar');
  assert.equal(elementos.contratar.hidden, true);
  assert.equal(elementos.contratarAviso.textContent, 'Cliente inativo: reative para contratar serviços.');
  assert.equal(elementos.dTitulo.textContent, 'Empresa Fictícia Ltda (inativo)');
});

// --- Formulário ---

test('formulário: troca de campos por tipo; "CNPJ da matriz" só para filial', async () => {
  const { elementos, clicar } = await rodar({ respostas: listaPadrao });
  await clicar('novoCliente');
  assert.equal(elementos.secForm.hidden, false);
  assert.equal(elementos.grupoPJ.hidden, false);
  assert.equal(elementos.grupoPF.hidden, true);
  assert.equal(elementos.grupoMatriz.hidden, true);
  assert.equal(elementos.rotDocumento.textContent, 'CNPJ *');
  elementos.cf_tipo_estabelecimento.value = 'filial';
  elementos.cf_tipo_estabelecimento.ouvintes.change();
  assert.equal(elementos.grupoMatriz.hidden, false);
  elementos.cfTipo.value = 'PF';
  elementos.cfTipo.ouvintes.change();
  assert.equal(elementos.grupoPJ.hidden, true);
  assert.equal(elementos.grupoPF.hidden, false);
  assert.equal(elementos.grupoMatriz.hidden, true);
  assert.equal(elementos.rotDocumento.textContent, 'CPF *');
  assert.equal(elementos.rotNome.textContent, 'Nome completo *');
});

test('formulário: cadastro de PF envia só os campos preenchidos do tipo e abre o detalhe', async () => {
  const { elementos, pedidos, location, clicar, enviarForm } = await rodar({ respostas: { ...listaPadrao, 'POST /api/clientes': [201, { id: 5 }] } });
  await clicar('novoCliente');
  elementos.cfTipo.value = 'PF';
  elementos.cfTipo.ouvintes.change();
  elementos.cf_documento.value = '280.012.389-38';
  elementos.cf_nome.value = ' Pessoa Fictícia ';
  elementos.cf_data_nascimento.value = '1990-05-20';
  elementos.cf_nome_fantasia.value = 'não deve ir';
  await enviarForm('formCliente');
  assert.deepEqual(pedidos.at(-1).corpo, { tipo: 'PF', documento: '280.012.389-38', nome: 'Pessoa Fictícia', data_nascimento: '1990-05-20' });
  assert.equal(location.href, '/clientes?id=5');
});

test('formulário: cadastro recusado mostra a mensagem da API', async () => {
  const { elementos, clicar, enviarForm } = await rodar({ respostas: { ...listaPadrao, 'POST /api/clientes': [400, { erro: 'CNPJ inválido.' }] } });
  await clicar('novoCliente');
  elementos.cf_documento.value = '11.111.111/1111-11';
  elementos.cf_nome.value = 'X';
  await enviarForm('formCliente');
  assert.equal(elementos.cfErro.textContent, 'CNPJ inválido.');
  assert.equal(elementos.secForm.hidden, false);
});

test('formulário: edição envia só o que mudou (campo apagado vai como null) e volta ao detalhe', async () => {
  const { elementos, pedidos, clicar, enviarForm } = await rodar({ search: '?id=1', respostas: { 'PUT /api/clientes/1': [200, { ok: true }] } });
  await clicar('dEditar');
  assert.equal(elementos.cfTipo.disabled, true, 'tipo de pessoa não muda');
  assert.equal(elementos.cf_documento.value, '12.ABC.345/01DE-35');
  await enviarForm('formCliente');
  assert.equal(elementos.cfErro.textContent, 'Nenhuma alteração para salvar.');
  assert.ok(!pedidos.some((p) => p.metodo === 'PUT'));

  elementos.cf_email.value = 'contato@exemplo.test';
  elementos.cf_codigo_dominio.value = '';
  await enviarForm('formCliente');
  assert.deepEqual(pedidos.find((p) => p.metodo === 'PUT').corpo, { email: 'contato@exemplo.test', codigo_dominio: null });
  assert.equal(elementos.secDetalhe.hidden, false);
  assert.equal(elementos.dOk.textContent, 'Dados salvos.');
});

test('formulário: filial que vira matriz envia CNPJ da matriz vazio', async () => {
  const { elementos, pedidos, clicar, enviarForm } = await rodar({ search: '?id=3', respostas: { 'PUT /api/clientes/3': [200, { ok: true }] } });
  await clicar('dEditar');
  assert.equal(elementos.grupoMatriz.hidden, false);
  elementos.cf_tipo_estabelecimento.value = 'matriz';
  elementos.cf_tipo_estabelecimento.ouvintes.change();
  await enviarForm('formCliente');
  assert.deepEqual(pedidos.find((p) => p.metodo === 'PUT').corpo, { tipo_estabelecimento: 'matriz', cnpj_matriz: null });
});

// --- Catálogo ---

test('catálogo: criar, renomear e inativar enviam os pedidos certos; erro aparece no bloco', async () => {
  const criar = await rodar({ respostas: { ...listaPadrao, 'POST /api/servicos': [400, { erro: 'Já existe serviço com esta chave no catálogo do escritório.' }] } });
  criar.elementos.sNome.value = 'Fiscal';
  criar.elementos.sChave.value = ' fiscal ';
  criar.elementos.sTipo.value = 'PJ';
  await criar.enviarForm('novoServico');
  assert.deepEqual(criar.pedidos.at(-1).corpo, { nome: 'Fiscal', chave: 'fiscal', tipo_cliente: 'PJ' });
  assert.equal(criar.elementos.catErro.textContent, 'Já existe serviço com esta chave no catálogo do escritório.');

  const renomear = await rodar({ nomeNovo: 'Fiscal Mensal', respostas: { ...listaPadrao, 'PUT /api/servicos/3': [200, { ok: true }] } });
  await renomear.clicar('catalogo', { renomear: '3' });
  assert.deepEqual(renomear.pedidos.find((p) => p.metodo === 'PUT'), { metodo: 'PUT', caminho: '/api/servicos/3', corpo: { nome: 'Fiscal Mensal' } });
  assert.equal(renomear.elementos.catOk.textContent, 'Serviço renomeado.');

  const inativar = await rodar({ respostas: { ...listaPadrao, 'PUT /api/servicos/1': [200, { ok: true }] } });
  await inativar.clicar('catalogo', { situacaoServico: '1' });
  assert.match(inativar.perguntas.at(-1), /^Inativar o serviço Contábil\?/);
  assert.deepEqual(inativar.pedidos.find((p) => p.metodo === 'PUT').corpo, { ativo: false });
});
