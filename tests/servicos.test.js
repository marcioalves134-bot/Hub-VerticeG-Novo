// Serviços contratados (etapa 8). Banco em memória (versão 1: cada escritório com o catálogo Folha, Fiscal, Contábil, Doméstica).
// Só documentos fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../src/db.js';
import { ErroDeUso } from '../src/erros.js';
import { criarEscritorio } from '../src/escritorios.js';
import * as clientes from '../src/clientes.js';

const { alterarSituacaoCliente, cadastrarCliente, contratarServico, encerrarServico, servicosDoCliente } = clientes;
const SENHA = 'senha-de-teste-123';
const AGORA = new Date('2026-11-04T15:00:00Z'); // 04/11/2026 12:00 em Brasília
const CNPJ_PJ = '98765432000198';
const CPF_PF = '28001238938';

let db, adminA, adminB, tenantA, tenantB, idPj, idPf, idPjB;
beforeEach(() => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId;
  adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  adminB = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(b.usuarioId);
  idPj = cadastrarCliente(db, adminA, { tipo: 'PJ', documento: CNPJ_PJ, nome: 'Empresa Fictícia Ltda', tipo_estabelecimento: 'matriz' }, AGORA);
  idPf = cadastrarCliente(db, adminA, { tipo: 'PF', documento: CPF_PF, nome: 'Pessoa Fictícia da Silva' }, AGORA);
  idPjB = cadastrarCliente(db, adminB, { tipo: 'PJ', documento: CNPJ_PJ, nome: 'Empresa Fictícia B Ltda', tipo_estabelecimento: 'matriz' }, AGORA);
});
afterEach(() => db.close());

const contratar = (clienteId, servico, inicio = '2026-01-01', autor = adminA) => contratarServico(db, autor, clienteId, { servico, inicio }, AGORA);
const encerrar = (clienteId, contrato, fim, autor = adminA) => encerrarServico(db, autor, clienteId, contrato, { fim }, AGORA);
const contrato = (id) => db.prepare('SELECT * FROM cliente_servicos WHERE id = ?').get(id);
const contratos = () => db.prepare('SELECT * FROM cliente_servicos ORDER BY id').all();
const auditoria = (acao) => db.prepare('SELECT tenant_id, usuario_id, detalhe FROM registro WHERE acao = ? ORDER BY id').all(acao)
  .map((r) => ({ tenant_id: r.tenant_id, usuario_id: r.usuario_id, ...JSON.parse(r.detalhe) }));

function erro(fn, padrao, status = 400) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof ErroDeUso, `esperado ErroDeUso, veio ${e}`);
    assert.equal(e.status, status);
    assert.match(e.message, padrao);
    assert.ok(!e.message.includes(CNPJ_PJ) && !e.message.includes(CPF_PF), 'mensagem com documento');
    return true;
  });
}

/** Recusa sem gravar nada (contratos e registro iguais). */
function recusado(fn, padrao, status = 400) {
  const antes = contratos();
  const registros = db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;
  erro(fn, padrao, status);
  assert.deepEqual(contratos(), antes);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registro').get().n, registros);
}

// --- Contratação ---

test('contratar: PJ recebe Folha, Fiscal e Contábil; PF recebe Doméstica; serviço do catálogo do próprio escritório', () => {
  const ids = ['folha', 'fiscal', 'contabil'].map((s) => contratar(idPj, s));
  const idDom = contratar(idPf, 'domestica', '2025-03-10');
  for (const id of ids) {
    const c = contrato(id);
    assert.equal(c.tenant_id, tenantA);
    assert.equal(c.cliente_id, idPj);
    assert.equal(c.fim, null);
    assert.equal(db.prepare('SELECT tenant_id FROM servicos WHERE id = ?').get(c.servico_id).tenant_id, tenantA);
  }
  assert.equal(contrato(idDom).inicio, '2025-03-10');
  assert.deepEqual(auditoria('servico.contratado').map(({ cliente, servico, inicio }) => [cliente, servico, inicio]),
    [[idPj, 'folha', '2026-01-01'], [idPj, 'fiscal', '2026-01-01'], [idPj, 'contabil', '2026-01-01'], [idPf, 'domestica', '2025-03-10']]);
  assert.deepEqual(auditoria('servico.contratado')[0], { tenant_id: tenantA, usuario_id: adminA.id, cliente: idPj, servico: 'folha', inicio: '2026-01-01' });
});

test('compatibilidade PJ/PF: Doméstica só para PF; Folha, Fiscal e Contábil só para PJ', () => {
  recusado(() => contratar(idPj, 'domestica'), /O serviço Doméstica é só para pessoa física/);
  for (const s of ['folha', 'fiscal', 'contabil']) recusado(() => contratar(idPf, s), /é só para pessoa jurídica/);
});

test('catálogo: serviço inexistente, inativo, vazio ou que não é texto é recusado', () => {
  recusado(() => contratar(idPj, 'auditoria'), /Serviço não encontrado no catálogo do escritório/);
  recusado(() => contratar(idPj, 'FISCAL'), /Serviço não encontrado/);
  recusado(() => contratar(idPj, '  '), /Informe o serviço/);
  recusado(() => contratarServico(db, adminA, idPj, { servico: 7, inicio: '2026-01-01' }, AGORA), /Informe o serviço/);
  db.prepare("UPDATE servicos SET ativo = 0 WHERE tenant_id = ? AND chave = 'fiscal'").run(tenantA);
  recusado(() => contratar(idPj, 'fiscal'), /O serviço Fiscal está inativo no catálogo/);
});

test('datas de início: retroativa e hoje aceitas; futura, inválida ou ausente recusadas (I-7)', () => {
  contratar(idPj, 'folha', '2020-02-29');
  contratar(idPj, 'fiscal', '2026-11-04');
  recusado(() => contratar(idPj, 'contabil', '2026-11-05'), /Data de início não pode ser futura/);
  recusado(() => contratar(idPj, 'contabil', '2026-02-30'), /Data de início inválida/);
  recusado(() => contratar(idPj, 'contabil', '04/11/2026'), /Data de início inválida/);
  recusado(() => contratarServico(db, adminA, idPj, { servico: 'contabil' }, AGORA), /Informe a data de início/);
});

test('cliente inativo não contrata; dados inválidos e campo desconhecido recusados', () => {
  alterarSituacaoCliente(db, adminA, idPj, false, AGORA);
  recusado(() => contratar(idPj, 'fiscal'), /Cliente inativo não pode contratar serviço/);
  recusado(() => contratarServico(db, adminA, idPf, null, AGORA), /Dados inválidos/);
  recusado(() => contratarServico(db, adminA, idPf, { servico: 'domestica', inicio: '2026-01-01', fim: '2026-02-01' }, AGORA), /Campo desconhecido: fim/);
  recusado(() => contratar(999999, 'fiscal'), /Cliente não encontrado/, 404);
});

test('mesmo serviço não fica em aberto duas vezes (I-8); outro serviço pode; recontratar depois de encerrar cria nova linha', () => {
  const primeiro = contratar(idPj, 'fiscal', '2025-01-01');
  recusado(() => contratar(idPj, 'fiscal', '2026-01-01'), /O serviço Fiscal já está em aberto para este cliente/);
  contratar(idPj, 'folha', '2025-01-01');
  encerrar(idPj, primeiro, '2025-06-30');
  const segundo = contratar(idPj, 'fiscal', '2026-01-01');
  assert.notEqual(segundo, primeiro);
  assert.equal(contrato(primeiro).fim, '2025-06-30', 'histórico preservado');
  assert.equal(contrato(segundo).fim, null);
});

test('o banco também impede o mesmo serviço em aberto duas vezes', () => {
  const id = contratar(idPj, 'fiscal');
  const c = contrato(id);
  assert.throws(() => db.prepare('INSERT INTO cliente_servicos (tenant_id, cliente_id, servico_id, inicio) VALUES (?, ?, ?, ?)')
    .run(tenantA, idPj, c.servico_id, '2026-02-01'), /UNIQUE constraint failed/);
});

// --- Encerramento ---

test('encerrar: fim igual ou posterior ao início; auditoria com serviço e fim; nada é apagado', () => {
  const id = contratar(idPj, 'fiscal', '2026-03-01');
  recusado(() => encerrar(idPj, id, '2026-02-28'), /A data de fim não pode ser anterior à data de início/);
  encerrar(idPj, id, '2026-03-01');
  assert.equal(contrato(id).fim, '2026-03-01');
  assert.equal(contratos().length, 1);
  assert.deepEqual(auditoria('servico.encerrado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: idPj, servico: 'fiscal', fim: '2026-03-01' }]);
});

test('encerrar: fim futuro, inválido ou ausente; contratação já encerrada; contratação de outro cliente', () => {
  const id = contratar(idPj, 'fiscal', '2026-01-01');
  const idDom = contratar(idPf, 'domestica', '2026-01-01');
  recusado(() => encerrar(idPj, id, '2026-11-05'), /Data de fim não pode ser futura/);
  recusado(() => encerrar(idPj, id, '2026-13-01'), /Data de fim inválida/);
  recusado(() => encerrarServico(db, adminA, idPj, id, {}, AGORA), /Informe a data de fim/);
  recusado(() => encerrarServico(db, adminA, idPj, id, { fim: '2026-06-30', inicio: '2020-01-01' }, AGORA), /Campo desconhecido: inicio/);
  recusado(() => encerrar(idPj, idDom, '2026-06-30'), /Contratação não encontrada/, 404);
  recusado(() => encerrar(idPj, 999999, '2026-06-30'), /Contratação não encontrada/, 404);
  encerrar(idPj, id, '2026-11-04');
  recusado(() => encerrar(idPj, id, '2026-11-04'), /Esta contratação já está encerrada/);
});

// --- Histórico ---

test('histórico: abertos e encerrados do cliente, mais recentes primeiro', () => {
  const c1 = contratar(idPj, 'fiscal', '2024-01-01');
  encerrar(idPj, c1, '2024-12-31');
  const c2 = contratar(idPj, 'fiscal', '2025-02-01');
  const c3 = contratar(idPj, 'folha', '2025-05-01');
  encerrar(idPj, c3, '2025-08-31');
  const h = servicosDoCliente(db, tenantA, idPj);
  assert.deepEqual(h.abertos, [{ contrato: c2, servico: 'fiscal', nome: 'Fiscal', inicio: '2025-02-01', fim: null }]);
  assert.deepEqual(h.encerrados.map((c) => [c.contrato, c.servico, c.inicio, c.fim]),
    [[c3, 'folha', '2025-05-01', '2025-08-31'], [c1, 'fiscal', '2024-01-01', '2024-12-31']]);
  assert.deepEqual(servicosDoCliente(db, tenantA, idPf), { abertos: [], encerrados: [] });
  erro(() => servicosDoCliente(db, tenantA, 999999), /Cliente não encontrado/, 404);
});

// --- Inativação encerra os serviços em aberto na mesma transação ---

test('inativar encerra todos os serviços em aberto com a data de hoje (Brasília); os já encerrados ficam como estavam', () => {
  const antigo = contratar(idPj, 'contabil', '2024-01-01');
  encerrar(idPj, antigo, '2024-06-30');
  const a1 = contratar(idPj, 'fiscal', '2025-01-01');
  const a2 = contratar(idPj, 'folha', '2026-11-04');
  // 05/11/2026 01:30 em UTC ainda é 04/11/2026 em Brasília
  alterarSituacaoCliente(db, adminA, idPj, false, new Date('2026-11-05T01:30:00Z'));
  assert.equal(contrato(a1).fim, '2026-11-04');
  assert.equal(contrato(a2).fim, '2026-11-04');
  assert.equal(contrato(antigo).fim, '2024-06-30');
  assert.deepEqual(auditoria('cliente.inativado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: idPj, servicosEncerrados: 2 }]);
  assert.equal(contratos().length, 3, 'nada é apagado');
});

test('reativar não reabre serviços (I-13); recontratar continua possível', () => {
  const id = contratar(idPj, 'fiscal', '2026-01-01');
  alterarSituacaoCliente(db, adminA, idPj, false, AGORA);
  alterarSituacaoCliente(db, adminA, idPj, true, AGORA);
  assert.equal(contrato(id).fim, '2026-11-04');
  assert.deepEqual(servicosDoCliente(db, tenantA, idPj).abertos, []);
  assert.deepEqual(auditoria('cliente.reativado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: idPj }]);
  contratar(idPj, 'fiscal', '2026-11-04');
  assert.equal(servicosDoCliente(db, tenantA, idPj).abertos.length, 1);
});

test('inativação é uma só transação: se um encerramento falhar, o cliente continua ativo e nada muda', () => {
  const id = contratar(idPj, 'fiscal', '2026-01-01');
  // contratação com início futuro gravada direto no banco (o módulo não permite): o encerramento "hoje" fica antes do início
  const servicoFolha = db.prepare("SELECT id FROM servicos WHERE tenant_id = ? AND chave = 'folha'").get(tenantA).id;
  db.prepare('INSERT INTO cliente_servicos (tenant_id, cliente_id, servico_id, inicio) VALUES (?, ?, ?, ?)').run(tenantA, idPj, servicoFolha, '2027-01-01');
  const antes = contratos();
  const registros = db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;
  assert.throws(() => alterarSituacaoCliente(db, adminA, idPj, false, AGORA), /CHECK constraint failed/);
  assert.equal(db.prepare('SELECT ativo FROM clientes WHERE id = ?').get(idPj).ativo, 1, 'cliente continua ativo');
  assert.deepEqual(contratos(), antes, 'nenhum serviço encerrado');
  assert.equal(contrato(id).fim, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registro').get().n, registros, 'sem auditoria');
});

// --- Isolamento entre escritórios ---

test('isolamento: escritório B não contrata, não encerra e não vê serviços de cliente de A', () => {
  const id = contratar(idPj, 'fiscal', '2026-01-01');
  recusado(() => contratar(idPj, 'folha', '2026-01-01', adminB), /Cliente não encontrado/, 404);
  recusado(() => encerrar(idPj, id, '2026-06-30', adminB), /Cliente não encontrado/, 404);
  recusado(() => encerrarServico(db, adminB, idPjB, id, { fim: '2026-06-30' }, AGORA), /Contratação não encontrada/, 404);
  erro(() => servicosDoCliente(db, tenantB, idPj), /Cliente não encontrado/, 404);
  assert.deepEqual(servicosDoCliente(db, tenantB, idPjB), { abertos: [], encerrados: [] });
  assert.equal(contrato(id).fim, null);
});

test('isolamento: cada escritório contrata pelo próprio catálogo; inativar no catálogo de A não afeta B', () => {
  db.prepare("UPDATE servicos SET ativo = 0 WHERE tenant_id = ? AND chave = 'fiscal'").run(tenantA);
  const idB = contratar(idPjB, 'fiscal', '2026-01-01', adminB);
  const servicoB = db.prepare('SELECT tenant_id FROM servicos WHERE id = ?').get(contrato(idB).servico_id);
  assert.equal(servicoB.tenant_id, tenantB);
  assert.equal(contrato(idB).tenant_id, tenantB);
  assert.equal(auditoria('servico.contratado').at(-1).tenant_id, tenantB);
});

test('isolamento no próprio banco: contratação misturando cliente de um escritório e serviço de outro é recusada', () => {
  const servicoB = db.prepare("SELECT id FROM servicos WHERE tenant_id = ? AND chave = 'fiscal'").get(tenantB).id;
  assert.throws(() => db.prepare('INSERT INTO cliente_servicos (tenant_id, cliente_id, servico_id, inicio) VALUES (?, ?, ?, ?)')
    .run(tenantA, idPj, servicoB, '2026-01-01'), /FOREIGN KEY constraint failed/);
  assert.throws(() => db.prepare('INSERT INTO cliente_servicos (tenant_id, cliente_id, servico_id, inicio) VALUES (?, ?, ?, ?)')
    .run(tenantB, idPj, servicoB, '2026-01-01'), /FOREIGN KEY constraint failed/);
});

test('inativar cliente de A não encerra serviços de cliente de B com o mesmo CNPJ', () => {
  contratar(idPj, 'fiscal', '2026-01-01');
  const idB = contratar(idPjB, 'fiscal', '2026-01-01', adminB);
  alterarSituacaoCliente(db, adminA, idPj, false, AGORA);
  assert.equal(contrato(idB).fim, null);
});

// --- Auditoria sem dados pessoais ---

test('auditoria de serviços: só número do cliente, chave do serviço e datas; nenhum documento ou nome', () => {
  const c1 = contratar(idPf, 'domestica', '2026-01-01');
  encerrar(idPf, c1, '2026-02-01');
  contratar(idPf, 'domestica', '2026-03-01');
  alterarSituacaoCliente(db, adminA, idPf, false, AGORA);
  for (const acao of ['servico.contratado', 'servico.encerrado', 'cliente.inativado']) {
    for (const r of auditoria(acao)) assert.deepEqual(Object.keys(r).sort(), ['tenant_id', 'usuario_id', ...{
      'servico.contratado': ['cliente', 'servico', 'inicio'], 'servico.encerrado': ['cliente', 'servico', 'fim'], 'cliente.inativado': ['cliente', 'servicosEncerrados'],
    }[acao]].sort(), acao);
  }
  const tudo = JSON.stringify(db.prepare('SELECT * FROM registro').all());
  for (const s of [CPF_PF, CNPJ_PJ, '280.012', 'Pessoa Fictícia da Silva', 'Empresa Fictícia']) assert.ok(!tudo.includes(s), `registro contém: ${s}`);
});
