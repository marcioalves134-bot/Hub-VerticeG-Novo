import { conferirSenha, criarLimitador, criarSessao, encerrarSessao, usuarioDaSessao } from './auth.js';
import { lerStatusBackup } from './backup.js';
import { registrar } from './db.js';
import { ErroDeUso } from './erros.js';
import {
  alterarSituacaoCliente, cadastrarCliente, consultarCliente, contratarServico, criarServicoCatalogo, editarCliente, editarServicoCatalogo,
  encerrarServico, listarCatalogo, listarClientes, servicosDoCliente,
} from './clientes.js';
import { alterarSituacaoUsuario, criarUsuario, departamentosDoUsuario, editarDepartamentosUsuario, editarUsuario, listarUsuarios, redefinirSenha } from './escritorios.js';
import { MODULOS } from './modulos.js';
import { versaoDoBanco, VERSAO_ATUAL } from './migracoes.js';
import { exigirConsultaClientes, exigirPermissao, podeConsultarClientes } from './permissoes.js';
import { PAGINA_LOGIN, PAGINA_PAINEL } from './telas.js';
import { paginaModulo, paginaModuloNaoEncontrado, paginaSemAcesso } from './telas-modulos.js';

// Caminhos que dependem das tabelas da migração 001 (clientes, servicos, cliente_servicos). Toda rota ou tela nova
// que use essas tabelas tem de estar aqui: na versão 0 eles respondem 404 antes de qualquer consulta (barreira M2).
export const CAMINHOS_CLIENTES = ['/clientes', '/api/clientes', '/api/servicos'];
const ehCaminhoDeClientes = (caminho) => CAMINHOS_CLIENTES.some((c) => caminho === c || caminho.startsWith(`${c}/`));

const COOKIE = 'hub_sessao';
const LIMITE_CORPO = 10_000;
const CHAVE_DEPARTAMENTO = /^[a-z0-9_-]{1,40}$/;
// Rotas de departamento: o método define o que a permissão precisa cobrir.
const ACAO_POR_METODO = { GET: 'ler', POST: 'gravar', PUT: 'gravar', DELETE: 'excluir' };

const CABECALHOS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

function lerCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

function enviar(res, status, corpo, tipo = 'application/json; charset=utf-8', extras = {}) {
  res.writeHead(status, { ...CABECALHOS, 'Content-Type': tipo, ...extras });
  res.end(tipo.startsWith('application/json') ? JSON.stringify(corpo) : corpo);
}

async function lerJson(req) {
  // Só JSON: um formulário de outro site não consegue mandar este tipo sem CORS.
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new ErroDeUso('Envie JSON.', 415);
  let dados = '';
  for await (const parte of req) {
    dados += parte;
    if (dados.length > LIMITE_CORPO) throw new ErroDeUso('Pedido grande demais.', 413);
  }
  try { return JSON.parse(dados || '{}'); } catch { throw new ErroDeUso('JSON inválido.'); }
}

/**
 * Compara a rota pedida ("PUT /api/usuarios/7") com um modelo ("PUT /api/usuarios/:id").
 * Devolve os parâmetros ({ id: 7 }) ou null. ":chave" aceita a chave de um departamento (minúsculas, números, - e _);
 * qualquer outro parâmetro só aceita inteiro positivo, sem zero à esquerda.
 */
export function casarRota(rota, modelo) {
  const partes = rota.split('/');
  const esperado = modelo.split('/');
  if (partes.length !== esperado.length) return null;
  const params = {};
  for (let i = 0; i < esperado.length; i++) {
    if (!esperado[i].startsWith(':')) {
      if (partes[i] !== esperado[i]) return null;
      continue;
    }
    if (esperado[i] === ':chave') {
      if (!CHAVE_DEPARTAMENTO.test(partes[i])) return null;
      params.chave = partes[i];
      continue;
    }
    const n = Number(partes[i]);
    if (!/^[1-9]\d*$/.test(partes[i]) || !Number.isSafeInteger(n)) return null;
    params[esperado[i].slice(1)] = n;
  }
  return params;
}

/** Monta o tratador HTTP do Hub sobre um banco já aberto. */
export function criarApp(db, { sessaoHoras = 10, cookieSeguro = false, backupLogPath = null } = {}) {
  const limitador = criarLimitador();
  const atributosCookie = `Path=/; HttpOnly; SameSite=Strict${cookieSeguro ? '; Secure' : ''}`;
  // Versão do banco lida uma vez: a migração só roda com o Hub fechado; ao reabrir, a versão nova é lida.
  // Recursos que dependem da migração 001 (Clientes) só ficam disponíveis na versão 1 (usado a partir da etapa 9).
  const versaoBanco = versaoDoBanco(db);
  const recursos = { clientes: versaoBanco >= 1 };

  const tratar = async function tratar(req, res) {
    const url = new URL(req.url, 'http://hub');
    const rota = `${req.method} ${url.pathname}`;
    try {
      if (rota === 'GET /saude') return enviar(res, 200, { ok: true });
      if (rota === 'GET /login') return enviar(res, 200, PAGINA_LOGIN, 'text/html; charset=utf-8');

      if (rota === 'POST /api/login') {
        const { escritorio, login, senha } = await lerJson(req);
        const chave = `${escritorio}|${login}`;
        if (limitador.bloqueado(chave)) return enviar(res, 429, { erro: 'Muitas tentativas. Aguarde 15 minutos.' });
        const u = db.prepare(`SELECT u.* FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
          WHERE t.codigo = ? AND u.login = ? AND u.ativo = 1 AND t.ativo = 1`).get(String(escritorio || ''), String(login || ''));
        if (!u || !conferirSenha(senha, u.senha_hash)) {
          limitador.falhou(chave);
          return enviar(res, 401, { erro: 'Escritório, usuário ou senha incorretos.' });
        }
        limitador.acertou(chave);
        const token = criarSessao(db, u, sessaoHoras);
        registrar(db, { tenantId: u.tenant_id, usuarioId: u.id, acao: 'login' });
        return enviar(res, 200, { ok: true }, undefined, { 'Set-Cookie': `${COOKIE}=${token}; ${atributosCookie}; Max-Age=${sessaoHoras * 3600}` });
      }

      // Barreira de disponibilidade (M2): banco na versão 0 → Clientes não existe; 404 igual ao de rota inexistente,
      // antes de qualquer verificação de permissão ou consulta, sem auditoria.
      if (!recursos.clientes && ehCaminhoDeClientes(url.pathname)) {
        return url.pathname.startsWith('/api/')
          ? enviar(res, 404, { erro: 'Rota não encontrada.' })
          : enviar(res, 404, 'Página não encontrada.', 'text/plain; charset=utf-8');
      }

      const token = lerCookie(req);
      const usuario = usuarioDaSessao(db, token);

      if (rota === 'GET /') {
        if (!usuario) return enviar(res, 302, '', 'text/plain', { Location: '/login' });
        return enviar(res, 200, PAGINA_PAINEL, 'text/html; charset=utf-8');
      }

      // Páginas dos módulos: acesso pela permissão do departamento do módulo, sempre no escritório da sessão.
      const paginaDeModulo = casarRota(rota, 'GET /modulos/:chave');
      if (paginaDeModulo) {
        if (!usuario) return enviar(res, 302, '', 'text/plain', { Location: '/login' });
        const modulo = MODULOS.find((m) => m.chave === paginaDeModulo.chave);
        if (!modulo) return enviar(res, 404, paginaModuloNaoEncontrado(), 'text/html; charset=utf-8');
        try {
          const departamento = exigirPermissao(db, usuario, modulo.departamento, 'ler');
          return enviar(res, 200, paginaModulo(modulo, departamento), 'text/html; charset=utf-8');
        } catch (e) {
          if (!(e instanceof ErroDeUso)) throw e;
          if (e.status === 403) return enviar(res, 403, paginaSemAcesso(e.message), 'text/html; charset=utf-8');
          return enviar(res, 404, paginaModuloNaoEncontrado(), 'text/html; charset=utf-8');
        }
      }
      if (!url.pathname.startsWith('/api/')) return enviar(res, 404, 'Página não encontrada.', 'text/plain; charset=utf-8');
      if (!usuario) return enviar(res, 401, { erro: 'Faça login.' });

      if (rota === 'POST /api/logout') {
        encerrarSessao(db, token);
        registrar(db, { tenantId: usuario.tenant_id, usuarioId: usuario.id, acao: 'logout' });
        return enviar(res, 200, { ok: true }, undefined, { 'Set-Cookie': `${COOKIE}=; ${atributosCookie}; Max-Age=0` });
      }
      if (rota === 'GET /api/eu') {
        // M3: o menu mostra "Clientes" só se o recurso existir (versão 1) e o usuário puder consultar.
        return enviar(res, 200, { ...usuario, departamentos: departamentosDoUsuario(db, usuario),
          podeConsultarClientes: recursos.clientes && podeConsultarClientes(db, usuario) });
      }

      // Rotas de departamento (/api/dep/:chave/...): toda chamada passa pela permissão antes de qualquer tratador.
      if (url.pathname.startsWith('/api/dep/')) {
        const chave = url.pathname.split('/')[3];
        const acao = ACAO_POR_METODO[req.method];
        if (!CHAVE_DEPARTAMENTO.test(chave) || !acao) return enviar(res, 404, { erro: 'Rota não encontrada.' });
        exigirPermissao(db, usuario, chave, acao);
        // Os tratadores das funcionalidades de departamento entram aqui.
        return enviar(res, 404, { erro: 'Rota não encontrada.' });
      }

      // Consulta de clientes e do catálogo (A-8): administrador ou usuário com algum departamento liberado.
      if (rota === 'GET /api/clientes') {
        exigirConsultaClientes(db, usuario);
        const q = (nome) => { const v = url.searchParams.get(nome); return v === null || v === '' ? undefined : v; };
        const pagina = q('pagina');
        if (pagina !== undefined && !/^\d{1,6}$/.test(pagina)) throw new ErroDeUso('Página inválida.');
        return enviar(res, 200, listarClientes(db, usuario.tenant_id, {
          tipo: q('tipo'), servico: q('servico'), situacao: q('situacao'), busca: q('busca'), pagina: pagina === undefined ? undefined : Number(pagina),
        }));
      }
      const detalheCliente = casarRota(rota, 'GET /api/clientes/:id');
      if (detalheCliente) {
        exigirConsultaClientes(db, usuario);
        return enviar(res, 200, { ...consultarCliente(db, usuario.tenant_id, detalheCliente.id), servicos: servicosDoCliente(db, usuario.tenant_id, detalheCliente.id) });
      }
      if (rota === 'GET /api/servicos') {
        exigirConsultaClientes(db, usuario);
        return enviar(res, 200, listarCatalogo(db, usuario.tenant_id));
      }

      // Daqui para baixo, só administrador do próprio escritório.
      if (usuario.perfil !== 'admin') return enviar(res, 403, { erro: 'Acesso só para administrador.' });

      // Clientes, serviços contratados e catálogo: gravação só pelo administrador (A-8, I-2, I-10).
      if (rota === 'POST /api/clientes') return enviar(res, 201, { id: cadastrarCliente(db, usuario, await lerJson(req)) });
      const edicaoCliente = casarRota(rota, 'PUT /api/clientes/:id');
      if (edicaoCliente) {
        editarCliente(db, usuario, edicaoCliente.id, await lerJson(req));
        return enviar(res, 200, { ok: true });
      }
      const situacaoCliente = casarRota(rota, 'POST /api/clientes/:id/situacao');
      if (situacaoCliente) {
        const { ativo } = await lerJson(req);
        alterarSituacaoCliente(db, usuario, situacaoCliente.id, ativo);
        return enviar(res, 200, { ok: true });
      }
      const contratacao = casarRota(rota, 'POST /api/clientes/:id/servicos');
      if (contratacao) return enviar(res, 201, { contrato: contratarServico(db, usuario, contratacao.id, await lerJson(req)) });
      const encerramento = casarRota(rota, 'POST /api/clientes/:id/servicos/:contrato/encerrar');
      if (encerramento) {
        encerrarServico(db, usuario, encerramento.id, encerramento.contrato, await lerJson(req));
        return enviar(res, 200, { ok: true });
      }
      if (rota === 'POST /api/servicos') return enviar(res, 201, { id: criarServicoCatalogo(db, usuario, await lerJson(req)) });
      const edicaoServico = casarRota(rota, 'PUT /api/servicos/:id');
      if (edicaoServico) {
        editarServicoCatalogo(db, usuario, edicaoServico.id, await lerJson(req));
        return enviar(res, 200, { ok: true });
      }
      if (rota === 'GET /api/usuarios') return enviar(res, 200, listarUsuarios(db, usuario.tenant_id));
      if (rota === 'POST /api/usuarios') {
        const id = criarUsuario(db, usuario, await lerJson(req));
        return enviar(res, 201, { id });
      }
      const situacao = casarRota(rota, 'POST /api/usuarios/:id/situacao');
      if (situacao) {
        const { ativo } = await lerJson(req);
        alterarSituacaoUsuario(db, usuario, situacao.id, ativo);
        return enviar(res, 200, { ok: true });
      }
      const edicao = casarRota(rota, 'PUT /api/usuarios/:id');
      if (edicao) {
        editarUsuario(db, usuario, edicao.id, await lerJson(req));
        return enviar(res, 200, { ok: true });
      }
      const vinculos = casarRota(rota, 'PUT /api/usuarios/:id/departamentos');
      if (vinculos) {
        const { departamentos } = await lerJson(req);
        editarDepartamentosUsuario(db, usuario, vinculos.id, departamentos);
        return enviar(res, 200, { ok: true });
      }
      const novaSenha = casarRota(rota, 'POST /api/usuarios/:id/senha');
      if (novaSenha) {
        const { senha } = await lerJson(req);
        redefinirSenha(db, usuario, novaSenha.id, senha);
        return enviar(res, 200, { ok: true });
      }
      if (rota === 'GET /api/departamentos') {
        return enviar(res, 200, db.prepare('SELECT chave, nome FROM departamentos WHERE tenant_id = ? ORDER BY nome').all(usuario.tenant_id));
      }
      if (rota === 'GET /api/backup/status') return enviar(res, 200, lerStatusBackup(backupLogPath));
      if (rota === 'GET /api/registro') {
        return enviar(res, 200, db.prepare(`SELECT r.em, r.acao, r.detalhe, u.login FROM registro r
          LEFT JOIN usuarios u ON u.id = r.usuario_id WHERE r.tenant_id = ? ORDER BY r.id DESC LIMIT 100`).all(usuario.tenant_id));
      }
      return enviar(res, 404, { erro: 'Rota não encontrada.' });
    } catch (e) {
      if (e instanceof ErroDeUso) return enviar(res, e.status, { erro: e.message });
      console.error(e);
      return enviar(res, 500, { erro: 'Erro interno.' });
    }
  };
  tratar.versaoBanco = versaoBanco;
  tratar.recursos = recursos;
  return tratar;
}

/** Aviso para o terminal quando o banco está atrás da versão do código; null se estiver em dia. Não bloqueia nada. */
export function avisoVersaoBanco(versao) {
  if (versao >= VERSAO_ATUAL) return null;
  return [
    `ATENÇÃO: o banco está na versão ${versao}; esta versão do Hub usa a versão ${VERSAO_ATUAL}.`,
    'A migração 001 está pendente: Clientes e o módulo Contábil ficam indisponíveis até ela ser aplicada.',
    'O Hub funciona normalmente com o que já existe. Nada é migrado automaticamente.',
    'Para migrar, somente com autorização: feche o Hub, rode "npm run backup" e depois "npm run migrar".',
  ].join('\n');
}
