import { registrar } from './db.js';
import { ErroDeUso } from './erros.js';

// Consulta: só ler. Operação: ler, cadastrar e editar. Excluir: só administrador.
// Administrador tem Operação em todos os departamentos do próprio escritório.
const NIVEIS_QUE_PODEM = { ler: ['consulta', 'operacao'], gravar: ['operacao'], excluir: [] };
const NEGADO = {
  ler: (nome) => `Sem permissão para consultar o departamento ${nome}.`,
  gravar: (nome) => `Sem permissão para cadastrar ou editar no departamento ${nome}.`,
  excluir: (nome) => `Exclusões no departamento ${nome} só podem ser feitas pelo administrador.`,
};

/**
 * Confere se o usuário pode fazer a ação ('ler', 'gravar' ou 'excluir') no departamento do próprio escritório.
 * Permitido: devolve { id, chave, nome, nivel }. Negado: registra no histórico e lança erro 403.
 */
export function exigirPermissao(db, usuario, chave, acao) {
  if (!Object.hasOwn(NIVEIS_QUE_PODEM, acao)) throw new Error(`Ação desconhecida: ${acao}`);
  const dep = db.prepare(`SELECT d.id, d.chave, d.nome, ud.nivel FROM departamentos d
    LEFT JOIN usuario_departamentos ud ON ud.departamento_id = d.id AND ud.usuario_id = ?
    WHERE d.tenant_id = ? AND d.chave = ?`).get(usuario.id, usuario.tenant_id, String(chave));
  if (!dep) throw new ErroDeUso('Departamento não encontrado.', 404);
  const admin = usuario.perfil === 'admin';
  const nivel = admin ? 'operacao' : dep.nivel;
  if (!admin && !NIVEIS_QUE_PODEM[acao].includes(nivel)) {
    registrar(db, { tenantId: usuario.tenant_id, usuarioId: usuario.id, acao: 'permissao.negada', detalhe: { departamento: dep.chave, acao } });
    throw new ErroDeUso(NEGADO[acao](dep.nome), 403);
  }
  return { id: dep.id, chave: dep.chave, nome: dep.nome, nivel };
}
