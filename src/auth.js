import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ErroDeUso } from './erros.js';

const SENHA_MINIMA = 10;

export function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < SENHA_MINIMA) {
    throw new ErroDeUso(`A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`);
  }
}

export function gerarHashSenha(senha) {
  validarSenha(senha);
  const sal = randomBytes(16);
  return `scrypt$${sal.toString('hex')}$${scryptSync(senha, sal, 64).toString('hex')}`;
}

export function conferirSenha(senha, guardado) {
  const [tipo, salHex, hashHex] = String(guardado).split('$');
  if (tipo !== 'scrypt' || !salHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const calculado = scryptSync(String(senha), Buffer.from(salHex, 'hex'), esperado.length);
  return timingSafeEqual(calculado, esperado);
}

// O token vai só no cookie; o banco guarda o hash dele.
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function criarSessao(db, usuario, horas, agora = new Date()) {
  const token = randomBytes(32).toString('base64url');
  const expira = new Date(agora.getTime() + horas * 3600_000).toISOString();
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, tenant_id, expira_em) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), usuario.id, usuario.tenant_id, expira);
  return token;
}

/** Usuário da sessão (com tenant ativo), ou null. Sessão vencida é apagada. */
export function usuarioDaSessao(db, token, agora = new Date()) {
  if (!token) return null;
  const h = hashToken(token);
  const s = db.prepare('SELECT * FROM sessoes WHERE token_hash = ?').get(h);
  if (!s) return null;
  if (s.expira_em <= agora.toISOString()) {
    db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(h);
    return null;
  }
  return db.prepare(`SELECT u.id, u.tenant_id, u.nome, u.login, u.perfil, t.nome AS escritorio
      FROM usuarios u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = ? AND u.tenant_id = ? AND u.ativo = 1 AND t.ativo = 1`).get(s.usuario_id, s.tenant_id) || null;
}

export function encerrarSessao(db, token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
}

/** Encerra todas as sessões do usuário, só dentro do escritório informado. Devolve quantas foram encerradas. */
export function encerrarSessoesDoUsuario(db, usuarioId, tenantId) {
  return db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND tenant_id = ?').run(usuarioId, tenantId).changes;
}

/** Bloqueio simples por login: 5 erros seguidos → 15 minutos de espera. */
export function criarLimitador({ maxErros = 5, esperaMs = 15 * 60_000 } = {}) {
  const erros = new Map();
  return {
    bloqueado(chave, agora = Date.now()) {
      const e = erros.get(chave);
      return Boolean(e && e.n >= maxErros && agora - e.ultimo < esperaMs);
    },
    falhou(chave, agora = Date.now()) {
      const e = erros.get(chave);
      erros.set(chave, { n: e && agora - e.ultimo < esperaMs ? e.n + 1 : 1, ultimo: agora });
    },
    acertou(chave) { erros.delete(chave); },
  };
}
