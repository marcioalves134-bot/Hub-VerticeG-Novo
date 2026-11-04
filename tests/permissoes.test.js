// Verificação central de permissões por departamento. Banco em memória próprio por teste; dados fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../src/db.js';
import { ErroDeUso } from '../src/erros.js';
import { criarEscritorio, criarUsuario, editarDepartamentosUsuario } from '../src/escritorios.js';
import { exigirPermissao } from '../src/permissoes.js';

const SENHA = 'senha-de-teste-123';
let db, adminA, semAcesso, consulta, operacao, adminB, tenantA, tenantB;
const buscar = (id) => db.prepare('SELECT id, tenant_id, nome, login, perfil FROM usuarios WHERE id = ?').get(id);
const depId = (tenantId, chave) => db.prepare('SELECT id FROM departamentos WHERE tenant_id = ? AND chave = ?').get(tenantId, chave).id;
const negacoes = (tenantId) => db.prepare("SELECT usuario_id, detalhe FROM registro WHERE tenant_id = ? AND acao = 'permissao.negada' ORDER BY id").all(tenantId)
  .map((r) => ({ usuario_id: r.usuario_id, ...JSON.parse(r.detalhe) }));
const totalRegistro = () => db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;

/** Confere que a chamada foi negada com 403 e a mensagem esperada. */
function negado(fn, mensagem) {
  assert.throws(fn, (e) => e instanceof ErroDeUso && e.status === 403 && (!mensagem || mensagem.test(e.message)));
}

beforeEach(() => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId;
  adminA = buscar(a.usuarioId);
  adminB = buscar(b.usuarioId);
  semAcesso = buscar(criarUsuario(db, adminA, { nome: 'Sem Acesso', login: 'semacesso', senha: SENHA }));
  consulta = buscar(criarUsuario(db, adminA, { nome: 'Só Consulta', login: 'consulta', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] }));
  operacao = buscar(criarUsuario(db, adminA, { nome: 'Operação', login: 'operacao', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'operacao' }] }));
  // departamento que só existe no escritório B
  db.prepare("INSERT INTO departamentos (tenant_id, chave, nome) VALUES (?, 'auditoria', 'Auditoria')").run(tenantB);
});

afterEach(() => db.close());

test('sem vínculo: não lê, não grava e não exclui', () => {
  negado(() => exigirPermissao(db, semAcesso, 'pessoal', 'ler'), /^Sem permissão para consultar o departamento Pessoal \(DP\)\.$/);
  negado(() => exigirPermissao(db, semAcesso, 'pessoal', 'gravar'), /^Sem permissão para cadastrar ou editar no departamento Pessoal \(DP\)\.$/);
  negado(() => exigirPermissao(db, semAcesso, 'pessoal', 'excluir'), /^Exclusões no departamento Pessoal \(DP\) só podem ser feitas pelo administrador\.$/);
});

test('Consulta: só lê', () => {
  assert.deepEqual(exigirPermissao(db, consulta, 'pessoal', 'ler'), { id: depId(tenantA, 'pessoal'), chave: 'pessoal', nome: 'Pessoal (DP)', nivel: 'consulta' });
  negado(() => exigirPermissao(db, consulta, 'pessoal', 'gravar'));
  negado(() => exigirPermissao(db, consulta, 'pessoal', 'excluir'));
});

test('Operação: lê, cadastra e edita, mas não exclui', () => {
  assert.equal(exigirPermissao(db, operacao, 'pessoal', 'ler').nivel, 'operacao');
  assert.equal(exigirPermissao(db, operacao, 'pessoal', 'gravar').nivel, 'operacao');
  negado(() => exigirPermissao(db, operacao, 'pessoal', 'excluir'), /só podem ser feitas pelo administrador/);
});

test('vínculo vale só para o próprio departamento', () => {
  negado(() => exigirPermissao(db, operacao, 'fiscal', 'ler'));
  negado(() => exigirPermissao(db, consulta, 'fiscal', 'ler'));
});

test('administrador: Operação e exclusão em todos os departamentos do próprio escritório, sem vínculo', () => {
  for (const chave of ['fiscal', 'pessoal']) {
    for (const acao of ['ler', 'gravar', 'excluir']) {
      const dep = exigirPermissao(db, adminA, chave, acao);
      assert.deepEqual([dep.id, dep.nivel], [depId(tenantA, chave), 'operacao']);
    }
  }
});

test('histórico: registra só as tentativas negadas, no escritório de quem tentou', () => {
  const antes = totalRegistro();
  exigirPermissao(db, consulta, 'pessoal', 'ler');
  exigirPermissao(db, operacao, 'pessoal', 'gravar');
  exigirPermissao(db, adminA, 'fiscal', 'excluir');
  assert.equal(totalRegistro(), antes, 'acesso permitido não pode gerar registro');

  negado(() => exigirPermissao(db, consulta, 'pessoal', 'gravar'));
  negado(() => exigirPermissao(db, operacao, 'pessoal', 'excluir'));
  negado(() => exigirPermissao(db, semAcesso, 'fiscal', 'ler'));
  assert.deepEqual(negacoes(tenantA), [
    { usuario_id: consulta.id, departamento: 'pessoal', acao: 'gravar' },
    { usuario_id: operacao.id, departamento: 'pessoal', acao: 'excluir' },
    { usuario_id: semAcesso.id, departamento: 'fiscal', acao: 'ler' },
  ]);
  assert.deepEqual(negacoes(tenantB), []);
});

test('isolamento: mesma chave em outro escritório devolve o departamento do próprio escritório', () => {
  assert.equal(exigirPermissao(db, adminB, 'pessoal', 'gravar').id, depId(tenantB, 'pessoal'));
  assert.equal(exigirPermissao(db, operacao, 'pessoal', 'gravar').id, depId(tenantA, 'pessoal'));
  assert.notEqual(depId(tenantA, 'pessoal'), depId(tenantB, 'pessoal'));
});

test('isolamento: departamento que só existe em outro escritório responde 404 e não registra', () => {
  const antes = totalRegistro();
  for (const u of [adminA, operacao]) {
    assert.throws(() => exigirPermissao(db, u, 'auditoria', 'ler'), (e) => e instanceof ErroDeUso && e.status === 404 && e.message === 'Departamento não encontrado.');
  }
  assert.equal(totalRegistro(), antes);
  assert.equal(exigirPermissao(db, adminB, 'auditoria', 'ler').chave, 'auditoria');
});

test('isolamento: vínculo inconsistente com departamento de outro escritório não dá acesso', () => {
  // dado inválido gravado direto no banco: usuário de A ligado ao "fiscal" de B com Operação
  db.prepare("INSERT INTO usuario_departamentos (usuario_id, departamento_id, nivel) VALUES (?, ?, 'operacao')").run(semAcesso.id, depId(tenantB, 'fiscal'));
  negado(() => exigirPermissao(db, semAcesso, 'fiscal', 'ler'));
  negado(() => exigirPermissao(db, semAcesso, 'fiscal', 'gravar'));
});

test('mudança de nível vale na próxima verificação', () => {
  negado(() => exigirPermissao(db, consulta, 'pessoal', 'gravar'));
  editarDepartamentosUsuario(db, adminA, consulta.id, [{ chave: 'pessoal', nivel: 'operacao' }]);
  assert.equal(exigirPermissao(db, consulta, 'pessoal', 'gravar').nivel, 'operacao');
  editarDepartamentosUsuario(db, adminA, consulta.id, []);
  negado(() => exigirPermissao(db, consulta, 'pessoal', 'ler'));
});

test('entradas inválidas: departamento ausente dá 404; ação desconhecida é erro de programação', () => {
  for (const chave of [undefined, null, '', 'PESSOAL', 'nao-existe', 42]) {
    assert.throws(() => exigirPermissao(db, adminA, chave, 'ler'), (e) => e instanceof ErroDeUso && e.status === 404, String(chave));
  }
  for (const acao of ['apagar', 'LER', '', undefined, 'toString', '__proto__']) {
    assert.throws(() => exigirPermissao(db, adminA, 'pessoal', acao), (e) => !(e instanceof ErroDeUso) && /Ação desconhecida/.test(e.message), String(acao));
  }
});
