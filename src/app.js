import { conferirSenha, criarLimitador, criarSessao, encerrarSessao, usuarioDaSessao } from './auth.js';
import { registrar } from './db.js';
import { ErroDeUso } from './erros.js';
import { criarUsuario, departamentosDoUsuario, listarUsuarios } from './escritorios.js';
import { PAGINA_LOGIN, PAGINA_PAINEL } from './telas.js';

const COOKIE = 'hub_sessao';
const LIMITE_CORPO = 10_000;

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

/** Monta o tratador HTTP do Hub sobre um banco já aberto. */
export function criarApp(db, { sessaoHoras = 10, cookieSeguro = false } = {}) {
  const limitador = criarLimitador();
  const atributosCookie = `Path=/; HttpOnly; SameSite=Strict${cookieSeguro ? '; Secure' : ''}`;

  return async function tratar(req, res) {
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

      const token = lerCookie(req);
      const usuario = usuarioDaSessao(db, token);

      if (rota === 'GET /') {
        if (!usuario) return enviar(res, 302, '', 'text/plain', { Location: '/login' });
        return enviar(res, 200, PAGINA_PAINEL, 'text/html; charset=utf-8');
      }
      if (!url.pathname.startsWith('/api/')) return enviar(res, 404, 'Página não encontrada.', 'text/plain; charset=utf-8');
      if (!usuario) return enviar(res, 401, { erro: 'Faça login.' });

      if (rota === 'POST /api/logout') {
        encerrarSessao(db, token);
        registrar(db, { tenantId: usuario.tenant_id, usuarioId: usuario.id, acao: 'logout' });
        return enviar(res, 200, { ok: true }, undefined, { 'Set-Cookie': `${COOKIE}=; ${atributosCookie}; Max-Age=0` });
      }
      if (rota === 'GET /api/eu') return enviar(res, 200, { ...usuario, departamentos: departamentosDoUsuario(db, usuario) });

      // Daqui para baixo, só administrador do próprio escritório.
      if (usuario.perfil !== 'admin') return enviar(res, 403, { erro: 'Acesso só para administrador.' });
      if (rota === 'GET /api/usuarios') return enviar(res, 200, listarUsuarios(db, usuario.tenant_id));
      if (rota === 'POST /api/usuarios') {
        const id = criarUsuario(db, usuario, await lerJson(req));
        return enviar(res, 201, { id });
      }
      if (rota === 'GET /api/departamentos') {
        return enviar(res, 200, db.prepare('SELECT chave, nome FROM departamentos WHERE tenant_id = ? ORDER BY nome').all(usuario.tenant_id));
      }
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
}
