import { MODULOS } from './modulos.js';

const ESTILO = `
  :root { --azul: #1f4e79; --fundo: #f4f6f9; --borda: #d8dee6; --texto: #1d2733; --erro: #b42318; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: var(--fundo); color: var(--texto); }
  header { background: var(--azul); color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px 16px; }
  header h1 { font-size: 18px; margin: 0; }
  .menu { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
  .menu a { color: #fff; text-decoration: none; padding: 6px 10px; border-radius: 6px; font-size: 14px; }
  .menu a:hover, .menu a[aria-current="page"] { background: rgba(255, 255, 255, 0.18); }
  @media (max-width: 640px) { .menu { order: 3; flex-basis: 100%; } }
  main { max-width: 1000px; margin: 20px auto; padding: 0 16px; }
  .cartao { background: #fff; border: 1px solid var(--borda); border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  label { display: block; font-size: 13px; margin: 10px 0 4px; }
  input, select { width: 100%; padding: 8px; border: 1px solid var(--borda); border-radius: 6px; font-size: 14px; }
  button { background: var(--azul); color: #fff; border: 0; border-radius: 6px; padding: 9px 16px; font-size: 14px; cursor: pointer; margin-top: 12px; }
  button.claro { background: transparent; border: 1px solid #fff; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--borda); vertical-align: top; }
  .erro { color: var(--erro); font-size: 13px; min-height: 18px; margin-top: 8px; }
  .ok { color: #067647; font-size: 13px; min-height: 18px; margin-top: 8px; }
  .deps { display: flex; gap: 12px; flex-wrap: wrap; }
  .dep { border: 1px solid var(--borda); border-radius: 8px; padding: 12px 16px; min-width: 180px; background: #fff; }
  .grade { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0 16px; }
  .linha-dep { display: flex; gap: 8px; align-items: center; font-size: 13px; margin-top: 6px; }
  .linha-dep select { width: auto; }
  button.pequeno { margin: 0; padding: 4px 10px; font-size: 13px; }
  button.perigo { background: var(--erro); }
  .bloco { border-top: 1px solid var(--borda); margin-top: 16px; padding-top: 4px; }
  .dica { font-size: 12px; color: #555; margin: 4px 0; }
`;

const ESCAPAR = `const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));`;

export const PAGINA_LOGIN = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hub Vértice G — Entrar</title><style>${ESTILO} .caixa { max-width: 360px; margin: 80px auto; }</style></head>
<body><div class="caixa cartao">
  <h2>Hub Vértice G</h2>
  <form id="f">
    <label for="escritorio">Escritório (código)</label><input id="escritorio" autocomplete="organization" required>
    <label for="login">Usuário</label><input id="login" autocomplete="username" required>
    <label for="senha">Senha</label><input id="senha" type="password" autocomplete="current-password" required>
    <button type="submit">Entrar</button>
    <div class="erro" id="erro"></div>
  </form>
</div>
<script>
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const corpo = { escritorio: escritorio.value.trim(), login: login.value.trim(), senha: senha.value };
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  if (r.ok) location.href = '/';
  else erro.textContent = (await r.json()).erro || 'Não foi possível entrar.';
});
</script></body></html>`;

// Código comum das páginas logadas: cabeçalho, menu e Sair. O menu só esconde o que o usuário não pode abrir;
// quem decide o acesso é sempre o servidor.
const SCRIPT_LAYOUT = `
const MODULOS = ${JSON.stringify(MODULOS)};

function montarMenu(eu) {
  const liberados = new Set(eu.departamentos.map((d) => d.chave));
  const itens = [['/', 'Início']];
  if (eu.podeConsultarClientes === true) itens.push(['/clientes', 'Clientes']);
  for (const m of MODULOS) if (liberados.has(m.departamento)) itens.push(['/modulos/' + m.chave, m.titulo]);
  menuPrincipal.innerHTML = itens.map(([href, texto]) => '<a href="' + href + '"'
    + (location.pathname === href ? ' aria-current="page"' : '') + '>' + esc(texto) + '</a>').join('');
}

function preencherCabecalho(eu) {
  document.getElementById('titulo').textContent = 'Hub Vértice G — ' + eu.escritorio;
  document.getElementById('quem').textContent = eu.nome + (eu.perfil === 'admin' ? ' (administrador)' : '');
  montarMenu(eu);
}

document.getElementById('sair').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
});
`;

/** Esqueleto comum das páginas logadas: cabeçalho com menu, conteúdo e um único bloco de script. */
export function paginaComLayout({ titulo, conteudo, script }) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title><style>${ESTILO}</style></head>
<body>
<header><h1 id="titulo">Hub Vértice G</h1><nav class="menu" id="menuPrincipal" aria-label="Menu principal"></nav><div><span id="quem"></span> &nbsp; <button class="claro" id="sair">Sair</button></div></header>
<main>
${conteudo}
</main>
<script>
${ESCAPAR}
${SCRIPT_LAYOUT}
${script}
</script></body></html>`;
}

export const PAGINA_PAINEL = paginaComLayout({ titulo: 'Hub Vértice G', conteudo: `
  <section class="cartao"><h2>Departamentos</h2><div class="deps" id="deps"></div></section>
  <div id="admin" hidden>
    <section class="cartao" id="backup"><h2>Backup do Hub</h2><div id="backupTexto"></div></section>
    <section class="cartao"><h2>Usuários</h2>
      <table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Departamentos</th><th>Situação</th><th>Ações</th></tr></thead><tbody id="usuarios"></tbody></table>
    </section>
    <section class="cartao" id="gerenciar" hidden><h2 id="gTitulo">Gerenciar usuário</h2>
      <form id="gDados">
        <div class="grade">
          <div><label for="gNome">Nome</label><input id="gNome" required></div>
          <div><label for="gPerfil">Perfil</label><select id="gPerfil"><option value="usuario">Usuário</option><option value="admin">Administrador</option></select></div>
        </div>
        <button type="submit">Salvar nome e perfil</button>
        <div class="erro" id="gDadosErro"></div><div class="ok" id="gDadosOk"></div>
      </form>
      <form id="gDeps" class="bloco">
        <label>Acesso por departamento</label>
        <p class="dica">Administrador vê todos os departamentos; estes acessos valem quando o perfil é Usuário.</p>
        <div id="gDepsLista"></div>
        <button type="submit">Salvar departamentos</button>
        <div class="erro" id="gDepsErro"></div><div class="ok" id="gDepsOk"></div>
      </form>
      <div class="bloco">
        <label>Situação: <strong id="gSituacao"></strong></label>
        <button type="button" id="gSituacaoBotao"></button>
        <div class="erro" id="gSituacaoErro"></div><div class="ok" id="gSituacaoOk"></div>
      </div>
      <form id="gSenha" class="bloco">
        <label for="gNovaSenha">Nova senha (mín. 10 caracteres)</label><input id="gNovaSenha" type="password" autocomplete="new-password" required>
        <button type="submit">Redefinir senha</button>
        <div class="erro" id="gSenhaErro"></div><div class="ok" id="gSenhaOk"></div>
      </form>
      <div class="bloco"><button type="button" id="gFechar">Fechar</button></div>
    </section>
    <section class="cartao"><h2>Novo usuário</h2>
      <form id="novo">
        <div class="grade">
          <div><label for="nNome">Nome</label><input id="nNome" required></div>
          <div><label for="nLogin">Login</label><input id="nLogin" required></div>
          <div><label for="nSenha">Senha inicial (mín. 10 caracteres)</label><input id="nSenha" type="password" autocomplete="new-password" required></div>
          <div><label for="nPerfil">Perfil</label><select id="nPerfil"><option value="usuario">Usuário</option><option value="admin">Administrador</option></select></div>
        </div>
        <label>Acesso por departamento</label><div id="nDeps"></div>
        <button type="submit">Criar usuário</button>
        <div class="erro" id="nErro"></div><div class="ok" id="nOk"></div>
      </form>
    </section>
    <section class="cartao"><h2>Registro de ações (últimas 100)</h2>
      <table><thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th></tr></thead><tbody id="registro"></tbody></table>
    </section>
  </div>`, script: `
const NIVEIS = { consulta: 'Consulta', operacao: 'Operação' };
const dataBR = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR');
async function api(caminho, opcoes) {
  const r = await fetch(caminho, opcoes);
  if (r.status === 401) { location.href = '/login'; throw new Error('sessão encerrada'); }
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro || 'Erro');
  return corpo;
}

function mostrarBackup(b) {
  const caixa = document.getElementById('backupTexto');
  const dataIso = (s) => new Date(s).toLocaleString('pt-BR');
  let html = b.ultimoOkEm ? 'Último backup no servidor: <strong>' + dataIso(b.ultimoOkEm) + '</strong>.' : 'Nenhum backup automático enviado ao servidor ainda.';
  if (b.ultimo && b.ultimo.resultado !== 'ok') html += '<br>Última tentativa (' + dataIso(b.ultimo.em) + '): ' + esc(b.ultimo.erro || b.ultimo.resultado) + '.';
  if (b.ultimo && b.ultimo.pendentes) html += '<br>' + b.ultimo.pendentes + ' backup(s) aguardando envio na fila local.';
  if (b.atrasado) html = '<span class="erro"><strong>Atenção:</strong> nenhum backup enviado ao servidor nas últimas 26 horas.</span><br>' + html;
  caixa.innerHTML = html;
}

let usuariosCache = [], depsCache = [], gId = null;

async function carregarAdmin() {
  const [usuarios, registro, deps, backup] = await Promise.all([api('/api/usuarios'), api('/api/registro'), api('/api/departamentos'), api('/api/backup/status')]);
  usuariosCache = usuarios; depsCache = deps;
  mostrarBackup(backup);
  document.getElementById('usuarios').innerHTML = usuarios.map((u) => '<tr><td>' + esc(u.nome) + '</td><td>' + esc(u.login)
    + '</td><td>' + (u.perfil === 'admin' ? 'Administrador' : 'Usuário') + '</td><td>'
    + (u.perfil === 'admin' ? 'Todos' : u.departamentos.map((d) => esc(d.nome) + ' (' + NIVEIS[d.nivel] + ')').join(', ') || '—')
    + '</td><td>' + (u.ativo ? 'Ativo' : 'Inativo') + '</td><td><button type="button" class="pequeno" data-gerenciar="' + u.id + '">Gerenciar</button></td></tr>').join('');
  if (gId !== null) preencherGerenciar();
  document.getElementById('registro').innerHTML = registro.map((r) => '<tr><td>' + dataBR(r.em) + '</td><td>' + esc(r.login || '—')
    + '</td><td>' + esc(r.acao) + '</td></tr>').join('');
  document.getElementById('nDeps').innerHTML = deps.map((d) => '<div class="linha-dep"><span style="min-width:140px">' + esc(d.nome)
    + '</span><select data-dep="' + esc(d.chave) + '"><option value="">Sem acesso</option><option value="consulta">Consulta</option>'
    + '<option value="operacao">Operação</option></select></div>').join('');
}

// Gerenciar usuário: a tela só envia os pedidos; as regras e as mensagens de erro vêm do servidor.
const usuarioAberto = () => usuariosCache.find((u) => u.id === gId);

function preencherGerenciar() {
  const u = usuarioAberto();
  if (!u) { fecharGerenciar(); return; }
  gTitulo.textContent = 'Gerenciar usuário — ' + u.nome + ' (' + u.login + ')';
  gNome.value = u.nome;
  gPerfil.value = u.perfil;
  const nivelDe = Object.fromEntries(u.departamentos.map((d) => [d.chave, d.nivel]));
  gDepsLista.innerHTML = depsCache.map((d) => '<div class="linha-dep"><span style="min-width:140px">' + esc(d.nome)
    + '</span><select data-dep="' + esc(d.chave) + '">' + ['', 'consulta', 'operacao'].map((v) => '<option value="' + v + '"'
    + ((nivelDe[d.chave] || '') === v ? ' selected' : '') + '>' + (v ? NIVEIS[v] : 'Sem acesso') + '</option>').join('') + '</select></div>').join('');
  gSituacao.textContent = u.ativo ? 'Ativo' : 'Inativo';
  gSituacaoBotao.textContent = u.ativo ? 'Desativar' : 'Reativar';
  gSituacaoBotao.className = u.ativo ? 'perigo' : '';
}

function limparMensagensGerenciar() {
  for (const p of ['gDados', 'gDeps', 'gSituacao', 'gSenha']) {
    document.getElementById(p + 'Erro').textContent = '';
    document.getElementById(p + 'Ok').textContent = '';
  }
}

function fecharGerenciar() {
  gId = null;
  gNovaSenha.value = '';
  document.getElementById('gerenciar').hidden = true;
}

/** Envia uma ação do cartão "Gerenciar usuário" e mostra o resultado no bloco dela. Devolve se deu certo. */
async function acaoGerenciar(bloco, metodo, sufixo, corpo, mensagemOk) {
  const erro = document.getElementById(bloco + 'Erro'), ok = document.getElementById(bloco + 'Ok');
  erro.textContent = ''; ok.textContent = '';
  try {
    await api('/api/usuarios/' + gId + sufixo, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  } catch (e) { erro.textContent = e.message; return false; }
  ok.textContent = mensagemOk;
  await carregarAdmin();
  return true;
}

document.getElementById('usuarios').addEventListener('click', (ev) => {
  const botao = ev.target.closest('button[data-gerenciar]');
  if (!botao) return;
  gId = Number(botao.dataset.gerenciar);
  gNovaSenha.value = '';
  limparMensagensGerenciar();
  preencherGerenciar();
  document.getElementById('gerenciar').hidden = false;
  document.getElementById('gerenciar').scrollIntoView();
});

document.getElementById('gFechar').addEventListener('click', fecharGerenciar);

document.getElementById('gDados').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = gId;
  if (await acaoGerenciar('gDados', 'PUT', '', { nome: gNome.value, perfil: gPerfil.value }, 'Nome e perfil salvos.')) return;
  // Recusado: os campos voltam aos dados realmente salvos; a mensagem de erro continua.
  const salvo = (await api('/api/usuarios')).find((u) => u.id === id);
  if (salvo && gId === id) { gNome.value = salvo.nome; gPerfil.value = salvo.perfil; }
});

document.getElementById('gDeps').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const departamentos = [...document.querySelectorAll('#gDepsLista select')].filter((s) => s.value).map((s) => ({ chave: s.dataset.dep, nivel: s.value }));
  acaoGerenciar('gDeps', 'PUT', '/departamentos', { departamentos }, 'Departamentos salvos.');
});

gSituacaoBotao.addEventListener('click', () => {
  const u = usuarioAberto();
  if (!u) return;
  const ativo = !u.ativo;
  const pergunta = ativo ? 'Reativar ' + u.nome + '?' : 'Desativar ' + u.nome + '? As sessões abertas deste usuário serão encerradas.';
  if (!confirm(pergunta)) return;
  acaoGerenciar('gSituacao', 'POST', '/situacao', { ativo }, ativo ? 'Usuário reativado.' : 'Usuário desativado.');
});

document.getElementById('gSenha').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const u = usuarioAberto();
  if (!u || !confirm('Redefinir a senha de ' + u.nome + '? As sessões abertas deste usuário serão encerradas.')) return;
  const senha = gNovaSenha.value;
  gNovaSenha.value = '';
  acaoGerenciar('gSenha', 'POST', '/senha', { senha }, 'Senha redefinida. Informe a nova senha ao usuário por um canal seguro.');
});

async function iniciar() {
  const eu = await api('/api/eu');
  preencherCabecalho(eu);
  document.getElementById('deps').innerHTML = eu.departamentos.map((d) => '<div class="dep"><strong>' + esc(d.nome)
    + '</strong><br><small>' + NIVEIS[d.nivel] + '</small></div>').join('') || '<p>Nenhum departamento liberado. Fale com o administrador.</p>';
  if (eu.perfil === 'admin') { document.getElementById('admin').hidden = false; await carregarAdmin(); }
}

document.getElementById('novo').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  nErro.textContent = ''; nOk.textContent = '';
  const departamentos = [...document.querySelectorAll('#nDeps select')].filter((s) => s.value).map((s) => ({ chave: s.dataset.dep, nivel: s.value }));
  try {
    await api('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      nome: nNome.value, login: nLogin.value.trim(), senha: nSenha.value, perfil: nPerfil.value, departamentos }) });
    ev.target.reset();
    nOk.textContent = 'Usuário criado.';
    await carregarAdmin();
  } catch (e) { nErro.textContent = e.message; }
});

iniciar();
` });
