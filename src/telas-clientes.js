// Tela /clientes (especificação, seção 5.7): lista, detalhe, formulário por tipo e catálogo de serviços.
// O servidor já conferiu login e permissão de consulta antes de entregar a página; cada gravação é conferida de novo
// pela API (só administrador). A tela só esconde os botões que o usuário não pode usar.
import { formatarCnpj, formatarCpf } from './documentos.js';
import { paginaComLayout } from './telas.js';

const CONTEUDO = `
  <div class="erro" id="aviso"></div>

  <section class="cartao" id="secLista" hidden>
    <h2>Clientes</h2>
    <form id="filtros">
      <div class="grade">
        <div><label for="fBusca">Buscar por nome ou documento</label><input id="fBusca"></div>
        <div><label for="fTipo">Tipo</label><select id="fTipo"><option value="">Todos</option><option value="PJ">Pessoa jurídica</option><option value="PF">Pessoa física</option></select></div>
        <div><label for="fServico">Serviço em aberto</label><select id="fServico"><option value="">Todos</option></select></div>
        <div><label for="fSituacao">Situação</label><select id="fSituacao"><option value="ativos">Ativos</option><option value="inativos">Inativos</option><option value="todos">Todos</option></select></div>
      </div>
      <button type="submit">Filtrar</button>
      <button type="button" id="novoCliente" hidden>Novo cliente</button>
    </form>
    <div class="erro" id="listaErro"></div>
    <table><thead><tr><th>Nome</th><th>Tipo</th><th>Documento</th><th>Município/UF</th><th>Situação</th></tr></thead><tbody id="lista"></tbody></table>
    <p class="dica" id="pagInfo"></p>
    <button type="button" class="pequeno" id="pagAnterior">Anterior</button>
    <button type="button" class="pequeno" id="pagProxima">Próxima</button>
  </section>

  <section class="cartao" id="secDetalhe" hidden>
    <p><a href="/clientes">← Voltar à lista</a></p>
    <h2 id="dTitulo"></h2>
    <p class="dica">Dados fiscais oficiais: Domínio.</p>
    <table><tbody id="dDados"></tbody></table>
    <div id="dVinculos"></div>
    <div class="erro" id="dErro"></div><div class="ok" id="dOk"></div>
    <div id="dAcoesAdmin" hidden>
      <button type="button" id="dEditar">Editar dados</button>
      <button type="button" id="dSituacao"></button>
    </div>
    <div class="bloco"><h2>Serviços em aberto</h2>
      <table><thead><tr><th>Serviço</th><th>Início</th><th id="dColAcao">Ação</th></tr></thead><tbody id="dAbertos"></tbody></table>
      <div id="dEncerrarBloco" hidden><label for="eFim">Data de encerramento (vale para o botão "Encerrar")</label><input id="eFim" type="date"></div>
    </div>
    <form class="bloco" id="contratar" hidden>
      <h2>Contratar serviço</h2>
      <div class="grade">
        <div><label for="cServico">Serviço</label><select id="cServico" required></select></div>
        <div><label for="cInicio">Início</label><input id="cInicio" type="date" required></div>
      </div>
      <button type="submit">Contratar</button>
    </form>
    <p class="dica" id="contratarAviso"></p>
    <div class="bloco"><h2>Histórico de serviços encerrados</h2>
      <table><thead><tr><th>Serviço</th><th>Início</th><th>Fim</th></tr></thead><tbody id="dHistorico"></tbody></table>
    </div>
  </section>

  <section class="cartao" id="secForm" hidden>
    <h2 id="cfTitulo">Novo cliente</h2>
    <form id="formCliente">
      <div class="grade">
        <div><label for="cfTipo">Tipo de pessoa *</label><select id="cfTipo"><option value="PJ">Pessoa jurídica (PJ)</option><option value="PF">Pessoa física (PF)</option></select></div>
        <div><label for="cf_documento" id="rotDocumento">CNPJ *</label><input id="cf_documento" required></div>
        <div><label for="cf_nome" id="rotNome">Razão social *</label><input id="cf_nome" required maxlength="150"></div>
      </div>
      <div id="grupoPJ" class="grade">
        <div><label for="cf_tipo_estabelecimento">Tipo de estabelecimento *</label><select id="cf_tipo_estabelecimento"><option value="matriz">Matriz</option><option value="filial">Filial</option></select></div>
        <div id="grupoMatriz"><label for="cf_cnpj_matriz">CNPJ da matriz *</label><input id="cf_cnpj_matriz"></div>
        <div><label for="cf_nome_fantasia">Nome fantasia</label><input id="cf_nome_fantasia" maxlength="150"></div>
        <div><label for="cf_inscricao_estadual">Inscrição estadual</label><input id="cf_inscricao_estadual" maxlength="30"></div>
        <div><label for="cf_inscricao_municipal">Inscrição municipal</label><input id="cf_inscricao_municipal" maxlength="30"></div>
        <div><label for="cf_contato_responsavel">Contato responsável</label><input id="cf_contato_responsavel" maxlength="100"></div>
      </div>
      <div id="grupoPF" class="grade">
        <div><label for="cf_data_nascimento">Data de nascimento</label><input id="cf_data_nascimento" type="date"></div>
        <div><label for="cf_whatsapp">WhatsApp</label><input id="cf_whatsapp"></div>
      </div>
      <div class="grade">
        <div><label for="cf_cep">CEP</label><input id="cf_cep"></div>
        <div><label for="cf_logradouro">Logradouro</label><input id="cf_logradouro" maxlength="150"></div>
        <div><label for="cf_numero">Número</label><input id="cf_numero" maxlength="20"></div>
        <div><label for="cf_complemento">Complemento</label><input id="cf_complemento" maxlength="100"></div>
        <div><label for="cf_bairro">Bairro</label><input id="cf_bairro" maxlength="100"></div>
        <div><label for="cf_municipio">Município</label><input id="cf_municipio" maxlength="100"></div>
        <div><label for="cf_uf">UF</label><input id="cf_uf" maxlength="2"></div>
        <div><label for="cf_telefone">Telefone</label><input id="cf_telefone"></div>
        <div><label for="cf_email">E-mail</label><input id="cf_email" type="email" maxlength="150"></div>
        <div><label for="cf_codigo_dominio">Código no Domínio</label><input id="cf_codigo_dominio" maxlength="30"></div>
      </div>
      <p class="dica">* Obrigatório.</p>
      <button type="submit">Salvar</button>
      <button type="button" id="cfCancelar">Cancelar</button>
      <div class="erro" id="cfErro"></div>
    </form>
  </section>

  <section class="cartao" id="secCatalogo" hidden>
    <h2>Catálogo de serviços</h2>
    <table><thead><tr><th>Serviço</th><th>Chave</th><th>Para</th><th>Situação</th><th>Ações</th></tr></thead><tbody id="catalogo"></tbody></table>
    <form id="novoServico" class="bloco">
      <div class="grade">
        <div><label for="sNome">Nome do serviço</label><input id="sNome" required maxlength="60"></div>
        <div><label for="sChave">Chave (minúsculas, sem espaço; não muda depois)</label><input id="sChave" required maxlength="30"></div>
        <div><label for="sTipo">Para</label><select id="sTipo"><option value="PJ">Pessoa jurídica</option><option value="PF">Pessoa física</option></select></div>
      </div>
      <button type="submit">Criar serviço</button>
    </form>
    <div class="erro" id="catErro"></div><div class="ok" id="catOk"></div>
  </section>`;

const SCRIPT = `
${formatarCpf.toString()}
${formatarCnpj.toString()}

const $ = (id) => document.getElementById(id);
const CAMPOS_PJ = ['tipo_estabelecimento', 'cnpj_matriz', 'nome_fantasia', 'inscricao_estadual', 'inscricao_municipal', 'contato_responsavel'];
const CAMPOS_PF = ['data_nascimento', 'whatsapp'];
const CAMPOS_COMUNS = ['documento', 'nome', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'telefone', 'email', 'codigo_dominio'];
const TIPOS = { PJ: 'Pessoa jurídica', PF: 'Pessoa física' };

let eu = null, admin = false, catalogo = [], pagina = 1, cliente = null, inicial = {};

async function api(caminho, opcoes) {
  const r = await fetch(caminho, opcoes);
  if (r.status === 401) { location.href = '/login'; throw new Error('Sessão encerrada.'); }
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro || 'Não foi possível concluir.');
  return corpo;
}
const enviarJson = (caminho, metodo, corpo) => api(caminho, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });

// Exibição no padrão brasileiro.
const documentoBR = (tipo, doc) => tipo === 'PJ' ? formatarCnpj(doc) : formatarCpf(doc);
const dataBR = (s) => /^\\d{4}-\\d{2}-\\d{2}$/.test(s || '') ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—';
const numeroBR = (n) => Number(n).toLocaleString('pt-BR');
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function telefoneBR(t) {
  if (!t) return '';
  return t.length === 11 ? '(' + t.slice(0, 2) + ') ' + t.slice(2, 7) + '-' + t.slice(7) : t.length === 10 ? '(' + t.slice(0, 2) + ') ' + t.slice(2, 6) + '-' + t.slice(6) : t;
}
const cepBR = (c) => c && c.length === 8 ? c.slice(0, 5) + '-' + c.slice(5) : (c || '');

function mostrar(secao) {
  for (const s of ['secLista', 'secDetalhe', 'secForm']) $(s).hidden = s !== secao;
  $('secCatalogo').hidden = !(admin && secao === 'secLista');
}

// --- Lista ---

function preencherFiltroServicos() {
  const atual = $('fServico').value;
  $('fServico').innerHTML = '<option value="">Todos</option>' + catalogo.map((s) => '<option value="' + esc(s.chave) + '">'
    + esc(s.nome) + ' (' + s.tipo_cliente + ')' + (s.ativo ? '' : ' — inativo') + '</option>').join('');
  $('fServico').value = atual;
}

async function carregarLista() {
  $('listaErro').textContent = '';
  const p = new URLSearchParams();
  for (const [nome, campo] of [['busca', 'fBusca'], ['tipo', 'fTipo'], ['servico', 'fServico'], ['situacao', 'fSituacao']]) {
    const v = $(campo).value.trim();
    if (v) p.set(nome, v);
  }
  p.set('pagina', String(pagina));
  let r;
  try { r = await api('/api/clientes?' + p.toString()); } catch (e) { $('listaErro').textContent = e.message; return; }
  $('lista').innerHTML = r.itens.map((c) => '<tr><td><a href="/clientes?id=' + c.id + '">' + esc(c.nome) + '</a>'
    + (c.nome_fantasia ? '<br><small>' + esc(c.nome_fantasia) + '</small>' : '') + '</td><td>' + c.tipo
    + (c.tipo_estabelecimento ? ' · ' + (c.tipo_estabelecimento === 'filial' ? 'Filial' : 'Matriz') : '') + '</td><td>'
    + esc(documentoBR(c.tipo, c.documento)) + '</td><td>' + esc([c.municipio, c.uf].filter(Boolean).join('/') || '—') + '</td><td>'
    + (c.ativo ? 'Ativo' : 'Inativo') + '</td></tr>').join('') || '<tr><td colspan="5">Nenhum cliente encontrado.</td></tr>';
  const paginas = Math.max(1, Math.ceil(r.total / r.porPagina));
  $('pagInfo').textContent = numeroBR(r.total) + (r.total === 1 ? ' cliente' : ' clientes') + ' · página ' + numeroBR(r.pagina) + ' de ' + numeroBR(paginas);
  $('pagAnterior').disabled = r.pagina <= 1;
  $('pagProxima').disabled = r.pagina >= paginas;
}

$('filtros').addEventListener('submit', (ev) => { ev.preventDefault(); pagina = 1; carregarLista(); });
$('pagAnterior').addEventListener('click', () => { if (pagina > 1) { pagina--; carregarLista(); } });
$('pagProxima').addEventListener('click', () => { pagina++; carregarLista(); });

// --- Catálogo (só administrador) ---

async function carregarCatalogo() {
  catalogo = await api('/api/servicos');
  preencherFiltroServicos();
  if (!admin) return;
  $('catalogo').innerHTML = catalogo.map((s) => '<tr><td>' + esc(s.nome) + '</td><td>' + esc(s.chave) + '</td><td>' + TIPOS[s.tipo_cliente]
    + '</td><td>' + (s.ativo ? 'Ativo' : 'Inativo') + '</td><td><button type="button" class="pequeno" data-renomear="' + s.id + '">Renomear</button> '
    + '<button type="button" class="pequeno' + (s.ativo ? ' perigo' : '') + '" data-situacao-servico="' + s.id + '">'
    + (s.ativo ? 'Inativar' : 'Reativar') + '</button></td></tr>').join('') || '<tr><td colspan="5">Nenhum serviço no catálogo.</td></tr>';
}

async function acaoCatalogo(promessa, mensagemOk) {
  $('catErro').textContent = ''; $('catOk').textContent = '';
  try { await promessa(); } catch (e) { $('catErro').textContent = e.message; return; }
  $('catOk').textContent = mensagemOk;
  await carregarCatalogo();
}

$('catalogo').addEventListener('click', (ev) => {
  const botao = ev.target.closest('button[data-renomear], button[data-situacao-servico]');
  if (!botao) return;
  const s = catalogo.find((x) => x.id === Number(botao.dataset.renomear || botao.dataset.situacaoServico));
  if (!s) return;
  if (botao.dataset.renomear) {
    const nome = prompt('Novo nome do serviço ' + s.nome + ':', s.nome);
    if (nome === null) return;
    acaoCatalogo(() => enviarJson('/api/servicos/' + s.id, 'PUT', { nome }), 'Serviço renomeado.');
    return;
  }
  const pergunta = s.ativo ? 'Inativar o serviço ' + s.nome + '? Ele deixa de ser oferecido em novas contratações; as atuais continuam.' : 'Reativar o serviço ' + s.nome + '?';
  if (!confirm(pergunta)) return;
  acaoCatalogo(() => enviarJson('/api/servicos/' + s.id, 'PUT', { ativo: !s.ativo }), s.ativo ? 'Serviço inativado.' : 'Serviço reativado.');
});

$('novoServico').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const corpo = { nome: $('sNome').value, chave: $('sChave').value.trim(), tipo_cliente: $('sTipo').value };
  acaoCatalogo(async () => { await enviarJson('/api/servicos', 'POST', corpo); $('sNome').value = ''; $('sChave').value = ''; }, 'Serviço criado.');
});

// --- Detalhe ---

function linha(rotulo, valor) {
  return valor ? '<tr><th>' + esc(rotulo) + '</th><td>' + esc(valor) + '</td></tr>' : '';
}

function mostrarDetalhe(c) {
  cliente = c;
  $('dTitulo').textContent = c.nome + (c.ativo ? '' : ' (inativo)');
  const pj = c.tipo === 'PJ';
  const endereco = [[c.logradouro, c.numero].filter(Boolean).join(', '), c.complemento, c.bairro,
    [c.municipio, c.uf].filter(Boolean).join('/'), c.cep ? 'CEP ' + cepBR(c.cep) : ''].filter(Boolean).join(' · ');
  $('dDados').innerHTML = [
    linha('Tipo', TIPOS[c.tipo] + (pj ? ' · ' + (c.tipo_estabelecimento === 'filial' ? 'Filial' : 'Matriz') : '')),
    linha(pj ? 'Razão social' : 'Nome completo', c.nome),
    linha(pj ? 'CNPJ' : 'CPF', documentoBR(c.tipo, c.documento)),
    linha('Nome fantasia', c.nome_fantasia),
    linha('CNPJ da matriz', c.cnpj_matriz && formatarCnpj(c.cnpj_matriz)),
    linha('Inscrição estadual', c.inscricao_estadual),
    linha('Inscrição municipal', c.inscricao_municipal),
    linha('Contato responsável', c.contato_responsavel),
    linha('Data de nascimento', c.data_nascimento && dataBR(c.data_nascimento)),
    linha('Endereço', endereco),
    linha('Telefone', telefoneBR(c.telefone)),
    linha('WhatsApp', telefoneBR(c.whatsapp)),
    linha('E-mail', c.email),
    linha('Código no Domínio', c.codigo_dominio),
    linha('Situação', c.ativo ? 'Ativo' : 'Inativo'),
  ].join('');

  // Matriz e filiais cadastradas no Hub (A-15: filial com CNPJ de matriz que não está no Hub mostra aviso).
  let vinculos = '';
  if (c.tipo_estabelecimento === 'filial') {
    vinculos = c.matriz
      ? '<p>Matriz: <a href="/clientes?id=' + c.matriz.id + '">' + esc(c.matriz.nome) + ' — ' + esc(formatarCnpj(c.matriz.documento)) + '</a></p>'
      : '<p class="erro">Matriz não encontrada no Hub.</p>';
  } else if (pj) {
    vinculos = c.filiais.length
      ? '<p>Filiais cadastradas:</p><ul>' + c.filiais.map((f) => '<li><a href="/clientes?id=' + f.id + '">' + esc(f.nome) + ' — '
        + esc(formatarCnpj(f.documento)) + '</a>' + (f.ativo ? '' : ' (inativa)') + '</li>').join('') + '</ul>'
      : '<p class="dica">Nenhuma filial cadastrada no Hub.</p>';
  }
  $('dVinculos').innerHTML = vinculos;

  $('dAcoesAdmin').hidden = !admin;
  $('dSituacao').textContent = c.ativo ? 'Inativar' : 'Reativar';
  $('dSituacao').className = c.ativo ? 'perigo' : '';

  $('dColAcao').hidden = !admin;
  $('dAbertos').innerHTML = c.servicos.abertos.map((s) => '<tr><td>' + esc(s.nome) + '</td><td>' + dataBR(s.inicio) + '</td>'
    + (admin ? '<td><button type="button" class="pequeno perigo" data-encerrar="' + s.contrato + '">Encerrar</button></td>' : '') + '</tr>').join('')
    || '<tr><td colspan="3">Nenhum serviço em aberto.</td></tr>';
  $('dEncerrarBloco').hidden = !(admin && c.servicos.abertos.length);
  $('eFim').value = hoje();
  $('dHistorico').innerHTML = c.servicos.encerrados.map((s) => '<tr><td>' + esc(s.nome) + '</td><td>' + dataBR(s.inicio) + '</td><td>'
    + dataBR(s.fim) + '</td></tr>').join('') || '<tr><td colspan="3">Nenhum serviço encerrado.</td></tr>';

  // Contratar: só serviços ativos do tipo do cliente que não estejam em aberto.
  const abertos = new Set(c.servicos.abertos.map((s) => s.servico));
  const opcoes = catalogo.filter((s) => s.ativo && s.tipo_cliente === c.tipo && !abertos.has(s.chave));
  $('cServico').innerHTML = opcoes.map((s) => '<option value="' + esc(s.chave) + '">' + esc(s.nome) + '</option>').join('');
  $('cInicio').value = hoje();
  $('contratar').hidden = !(admin && c.ativo && opcoes.length);
  $('contratarAviso').textContent = !admin ? '' : !c.ativo ? 'Cliente inativo: reative para contratar serviços.'
    : opcoes.length ? '' : 'Nenhum serviço disponível para contratar.';
  mostrar('secDetalhe');
}

async function carregarDetalhe(id) {
  mostrarDetalhe(await api('/api/clientes/' + id));
}

async function acaoDetalhe(promessa, mensagemOk) {
  $('dErro').textContent = ''; $('dOk').textContent = '';
  try { await promessa(); } catch (e) { $('dErro').textContent = e.message; return; }
  await carregarDetalhe(cliente.id);
  $('dOk').textContent = mensagemOk;
}

$('dSituacao').addEventListener('click', () => {
  const ativo = !cliente.ativo;
  const n = cliente.servicos.abertos.length;
  const pergunta = ativo ? 'Reativar ' + cliente.nome + '? Os serviços encerrados continuam encerrados.'
    : 'Inativar ' + cliente.nome + '?' + (n ? ' ' + (n === 1 ? 'O serviço em aberto será encerrado' : 'Os ' + n + ' serviços em aberto serão encerrados') + ' com a data de hoje.' : '');
  if (!confirm(pergunta)) return;
  acaoDetalhe(() => enviarJson('/api/clientes/' + cliente.id + '/situacao', 'POST', { ativo }), ativo ? 'Cliente reativado.' : 'Cliente inativado.');
});

$('dAbertos').addEventListener('click', (ev) => {
  const botao = ev.target.closest('button[data-encerrar]');
  if (!botao) return;
  const s = cliente.servicos.abertos.find((x) => x.contrato === Number(botao.dataset.encerrar));
  if (!s) return;
  const fim = $('eFim').value;
  if (!confirm('Encerrar ' + s.nome + ' em ' + dataBR(fim) + '?')) return;
  acaoDetalhe(() => enviarJson('/api/clientes/' + cliente.id + '/servicos/' + s.contrato + '/encerrar', 'POST', { fim }), 'Serviço encerrado.');
});

$('contratar').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const corpo = { servico: $('cServico').value, inicio: $('cInicio').value };
  acaoDetalhe(() => enviarJson('/api/clientes/' + cliente.id + '/servicos', 'POST', corpo), 'Serviço contratado.');
});

// --- Formulário (cadastro e edição) ---

function camposDoFormulario() {
  const tipo = $('cfTipo').value;
  if (tipo === 'PF') return [...CAMPOS_COMUNS, ...CAMPOS_PF];
  const pj = CAMPOS_PJ.filter((c) => c !== 'cnpj_matriz' || $('cf_tipo_estabelecimento').value === 'filial');
  return [...CAMPOS_COMUNS, ...pj];
}

function ajustarFormulario() {
  const pj = $('cfTipo').value === 'PJ';
  $('grupoPJ').hidden = !pj;
  $('grupoPF').hidden = pj;
  $('grupoMatriz').hidden = !(pj && $('cf_tipo_estabelecimento').value === 'filial');
  $('rotDocumento').textContent = pj ? 'CNPJ *' : 'CPF *';
  $('rotNome').textContent = pj ? 'Razão social *' : 'Nome completo *';
}

function valorInicial(c, campo) {
  const v = c ? c[campo] : null;
  if (v == null) return campo === 'tipo_estabelecimento' ? 'matriz' : '';
  if (campo === 'documento') return documentoBR(c.tipo, v);
  if (campo === 'cnpj_matriz') return formatarCnpj(v);
  return String(v);
}

function abrirFormulario(c) {
  $('cfTitulo').textContent = c ? 'Editar cliente — ' + c.nome : 'Novo cliente';
  $('cfTipo').value = c ? c.tipo : 'PJ';
  $('cfTipo').disabled = Boolean(c);
  inicial = {};
  for (const campo of [...CAMPOS_COMUNS, ...CAMPOS_PJ, ...CAMPOS_PF]) $('cf_' + campo).value = inicial[campo] = valorInicial(c, campo);
  $('cfErro').textContent = '';
  ajustarFormulario();
  mostrar('secForm');
}

$('cfTipo').addEventListener('change', ajustarFormulario);
$('cf_tipo_estabelecimento').addEventListener('change', ajustarFormulario);
$('novoCliente').addEventListener('click', () => { cliente = null; abrirFormulario(null); });
$('dEditar').addEventListener('click', () => abrirFormulario(cliente));
$('cfCancelar').addEventListener('click', () => { if (cliente) mostrar('secDetalhe'); else mostrar('secLista'); });

$('formCliente').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  $('cfErro').textContent = '';
  const campos = camposDoFormulario();
  try {
    if (!cliente) {
      // Cadastro: envia só o que foi preenchido.
      const corpo = { tipo: $('cfTipo').value };
      for (const campo of campos) { const v = $('cf_' + campo).value.trim(); if (v) corpo[campo] = v; }
      const { id } = await enviarJson('/api/clientes', 'POST', corpo);
      location.href = '/clientes?id=' + id;
      return;
    }
    // Edição parcial: envia só o que mudou; campo esvaziado vai como null. Matriz não tem CNPJ da matriz.
    const corpo = {};
    for (const campo of campos) { const v = $('cf_' + campo).value; if (v !== inicial[campo]) corpo[campo] = v.trim() || null; }
    if (cliente.tipo === 'PJ' && !campos.includes('cnpj_matriz') && cliente.cnpj_matriz != null) corpo.cnpj_matriz = null;
    if (!Object.keys(corpo).length) { $('cfErro').textContent = 'Nenhuma alteração para salvar.'; return; }
    await enviarJson('/api/clientes/' + cliente.id, 'PUT', corpo);
    await carregarDetalhe(cliente.id);
    $('dOk').textContent = 'Dados salvos.';
  } catch (e) { $('cfErro').textContent = e.message; }
});

// --- Início ---

async function iniciar() {
  try {
    eu = await api('/api/eu');
    preencherCabecalho(eu);
    admin = eu.perfil === 'admin';
    $('novoCliente').hidden = !admin;
    await carregarCatalogo();
    const id = new URLSearchParams(location.search).get('id');
    if (id !== null) {
      if (!/^[1-9]\\d{0,15}$/.test(id)) throw new Error('Cliente não encontrado.');
      await carregarDetalhe(id);
      return;
    }
    mostrar('secLista');
    await carregarLista();
  } catch (e) {
    // Sem permissão (403), cliente inexistente (404) ou outra recusa: mostra a mensagem do servidor, sem quebrar.
    for (const s of ['secLista', 'secDetalhe', 'secForm', 'secCatalogo']) $(s).hidden = true;
    $('aviso').innerHTML = esc(e.message) + ' <a href="/clientes">Voltar à lista</a>';
  }
}

iniciar();
`;

export const PAGINA_CLIENTES = paginaComLayout({ titulo: 'Clientes — Hub Vértice G', conteudo: CONTEUDO, script: SCRIPT });
