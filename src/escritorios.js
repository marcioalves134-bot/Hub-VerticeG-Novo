import { DEPARTAMENTOS_INICIAIS, registrar } from './db.js';
import { encerrarSessoesDoUsuario, gerarHashSenha } from './auth.js';
import { ErroDeUso } from './erros.js';

const CODIGO_VALIDO = /^[a-z0-9._-]{3,40}$/;
const REGRA_CODIGO = '3 a 40 caracteres, só letras minúsculas, números, ponto, hífen ou sublinhado.';

/** Cria um escritório (tenant) com os departamentos iniciais e o primeiro administrador. */
export function criarEscritorio(db, { codigo, nome, admin }) {
  if (!CODIGO_VALIDO.test(codigo || '')) throw new ErroDeUso(`Código do escritório: ${REGRA_CODIGO}`);
  if (!nome?.trim()) throw new ErroDeUso('Informe o nome do escritório.');
  if (!admin?.nome?.trim()) throw new ErroDeUso('Informe o nome do administrador.');
  if (!CODIGO_VALIDO.test(admin.login || '')) throw new ErroDeUso(`Login: ${REGRA_CODIGO}`);
  const senhaHash = gerarHashSenha(admin.senha);
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM tenants WHERE codigo = ?').get(codigo)) throw new ErroDeUso('Já existe um escritório com esse código.');
    const tenantId = db.prepare('INSERT INTO tenants (codigo, nome) VALUES (?, ?)').run(codigo, nome.trim()).lastInsertRowid;
    const dep = db.prepare('INSERT INTO departamentos (tenant_id, chave, nome) VALUES (?, ?, ?)');
    for (const d of DEPARTAMENTOS_INICIAIS) dep.run(tenantId, d.chave, d.nome);
    const usuarioId = db.prepare(`INSERT INTO usuarios (tenant_id, nome, login, senha_hash, perfil)
      VALUES (?, ?, ?, ?, 'admin')`).run(tenantId, admin.nome.trim(), admin.login, senhaHash).lastInsertRowid;
    registrar(db, { tenantId, usuarioId, acao: 'escritorio.criado', detalhe: { codigo, nome: nome.trim() } });
    return { tenantId: Number(tenantId), usuarioId: Number(usuarioId) };
  })();
}

/** Cria usuário no escritório de quem está criando; departamento de outro escritório é recusado. */
export function criarUsuario(db, autor, { nome, login, senha, perfil = 'usuario', departamentos = [] }) {
  if (!nome?.trim()) throw new ErroDeUso('Informe o nome.');
  if (!CODIGO_VALIDO.test(login || '')) throw new ErroDeUso(`Login: ${REGRA_CODIGO}`);
  if (!['admin', 'usuario'].includes(perfil)) throw new ErroDeUso('Perfil inválido.');
  if (!Array.isArray(departamentos)) throw new ErroDeUso('Departamentos inválidos.');
  const senhaHash = gerarHashSenha(senha);
  return db.transaction(() => {
    if (db.prepare('SELECT 1 FROM usuarios WHERE tenant_id = ? AND login = ?').get(autor.tenant_id, login)) {
      throw new ErroDeUso('Já existe um usuário com esse login.');
    }
    const id = db.prepare(`INSERT INTO usuarios (tenant_id, nome, login, senha_hash, perfil)
      VALUES (?, ?, ?, ?, ?)`).run(autor.tenant_id, nome.trim(), login, senhaHash, perfil).lastInsertRowid;
    const buscaDep = db.prepare('SELECT id FROM departamentos WHERE tenant_id = ? AND chave = ?');
    const vincula = db.prepare('INSERT INTO usuario_departamentos (usuario_id, departamento_id, nivel) VALUES (?, ?, ?)');
    for (const { chave, nivel } of departamentos) {
      const dep = buscaDep.get(autor.tenant_id, chave);
      if (!dep) throw new ErroDeUso(`Departamento desconhecido: ${chave}`);
      if (!['consulta', 'operacao'].includes(nivel)) throw new ErroDeUso('Nível inválido.');
      vincula.run(id, dep.id, nivel);
    }
    registrar(db, { tenantId: autor.tenant_id, usuarioId: autor.id, acao: 'usuario.criado', detalhe: { login, perfil, departamentos } });
    return Number(id);
  })();
}

/**
 * Desativa (ativo = false) ou reativa (ativo = true) um usuário do escritório de quem pede.
 * O cadastro e o histórico ficam; as sessões abertas do usuário são encerradas.
 */
export function alterarSituacaoUsuario(db, autor, usuarioId, ativo) {
  if (typeof ativo !== 'boolean') throw new ErroDeUso('Situação inválida.');
  return db.transaction(() => {
    const alvo = db.prepare('SELECT id, login, perfil, ativo FROM usuarios WHERE id = ? AND tenant_id = ?').get(usuarioId, autor.tenant_id);
    if (!alvo) throw new ErroDeUso('Usuário não encontrado.', 404);
    if (Boolean(alvo.ativo) === ativo) throw new ErroDeUso(ativo ? 'O usuário já está ativo.' : 'O usuário já está inativo.');
    if (!ativo && alvo.id === autor.id) throw new ErroDeUso('Você não pode desativar o próprio usuário.');
    if (!ativo && alvo.perfil === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE tenant_id = ? AND perfil = 'admin' AND ativo = 1").get(autor.tenant_id).n;
      if (admins <= 1) throw new ErroDeUso('O escritório precisa de pelo menos um administrador ativo.');
    }
    db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ? AND tenant_id = ?').run(ativo ? 1 : 0, alvo.id, autor.tenant_id);
    const sessoesEncerradas = encerrarSessoesDoUsuario(db, alvo.id, autor.tenant_id);
    registrar(db, { tenantId: autor.tenant_id, usuarioId: autor.id, acao: ativo ? 'usuario.reativado' : 'usuario.desativado',
      detalhe: { login: alvo.login, sessoesEncerradas } });
  })();
}

export function listarUsuarios(db, tenantId) {
  const usuarios = db.prepare(`SELECT id, nome, login, perfil, ativo, criado_em FROM usuarios
    WHERE tenant_id = ? ORDER BY nome`).all(tenantId);
  const deps = db.prepare(`SELECT d.chave, d.nome, ud.nivel FROM usuario_departamentos ud
    JOIN departamentos d ON d.id = ud.departamento_id WHERE ud.usuario_id = ? AND d.tenant_id = ?`);
  return usuarios.map((u) => ({ ...u, departamentos: deps.all(u.id, tenantId) }));
}

/** Departamentos que o usuário vê: admin vê todos do escritório; os demais, só os vinculados. */
export function departamentosDoUsuario(db, usuario) {
  if (usuario.perfil === 'admin') {
    return db.prepare(`SELECT chave, nome, 'operacao' AS nivel FROM departamentos WHERE tenant_id = ? ORDER BY nome`).all(usuario.tenant_id);
  }
  return db.prepare(`SELECT d.chave, d.nome, ud.nivel FROM usuario_departamentos ud
    JOIN departamentos d ON d.id = ud.departamento_id
    WHERE ud.usuario_id = ? AND d.tenant_id = ? ORDER BY d.nome`).all(usuario.id, usuario.tenant_id);
}
