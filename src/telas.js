const ESTILO = `
  :root { --azul: #1f4e79; --fundo: #f4f6f9; --borda: #d8dee6; --texto: #1d2733; --erro: #b42318; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: var(--fundo); color: var(--texto); }
  header { background: var(--azul); color: #fff; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-size: 18px; margin: 0; }
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

export const PAGINA_PAINEL = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hub Vértice G</title><style>${ESTILO}</style></head>
<body>
<header><h1 id="titulo">Hub Vértice G</h1><div><span id="quem"></span> &nbsp; <button class="claro" id="sair">Sair</button></div></header>
<main>
  <section class="cartao"><h2>Departamentos</h2><div class="deps" id="deps"></div></section>
  <div id="admin" hidden>
    <section class="cartao"><h2>Usuários</h2>
      <table><thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Departamentos</th><th>Situação</th></tr></thead><tbody id="usuarios"></tbody></table>
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
  </div>
</main>
<script>
${ESCAPAR}
const NIVEIS = { consulta: 'Consulta', operacao: 'Operação' };
const dataBR = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR');
async function api(caminho, opcoes) {
  const r = await fetch(caminho, opcoes);
  if (r.status === 401) { location.href = '/login'; throw new Error('sessão encerrada'); }
  const corpo = await r.json();
  if (!r.ok) throw new Error(corpo.erro || 'Erro');
  return corpo;
}

async function carregarAdmin() {
  const [usuarios, registro, deps] = await Promise.all([api('/api/usuarios'), api('/api/registro'), api('/api/departamentos')]);
  document.getElementById('usuarios').innerHTML = usuarios.map((u) => '<tr><td>' + esc(u.nome) + '</td><td>' + esc(u.login)
    + '</td><td>' + (u.perfil === 'admin' ? 'Administrador' : 'Usuário') + '</td><td>'
    + (u.perfil === 'admin' ? 'Todos' : u.departamentos.map((d) => esc(d.nome) + ' (' + NIVEIS[d.nivel] + ')').join(', ') || '—')
    + '</td><td>' + (u.ativo ? 'Ativo' : 'Inativo') + '</td></tr>').join('');
  document.getElementById('registro').innerHTML = registro.map((r) => '<tr><td>' + dataBR(r.em) + '</td><td>' + esc(r.login || '—')
    + '</td><td>' + esc(r.acao) + '</td></tr>').join('');
  document.getElementById('nDeps').innerHTML = deps.map((d) => '<div class="linha-dep"><span style="min-width:140px">' + esc(d.nome)
    + '</span><select data-dep="' + esc(d.chave) + '"><option value="">Sem acesso</option><option value="consulta">Consulta</option>'
    + '<option value="operacao">Operação</option></select></div>').join('');
}

async function iniciar() {
  const eu = await api('/api/eu');
  document.getElementById('titulo').textContent = 'Hub Vértice G — ' + eu.escritorio;
  document.getElementById('quem').textContent = eu.nome + (eu.perfil === 'admin' ? ' (administrador)' : '');
  document.getElementById('deps').innerHTML = eu.departamentos.map((d) => '<div class="dep"><strong>' + esc(d.nome)
    + '</strong><br><small>' + NIVEIS[d.nivel] + '</small></div>').join('') || '<p>Nenhum departamento liberado. Fale com o administrador.</p>';
  if (eu.perfil === 'admin') { document.getElementById('admin').hidden = false; await carregarAdmin(); }
}

document.getElementById('sair').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
});

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
</script></body></html>`;
