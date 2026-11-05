// Cadastro de clientes PJ/PF (etapa 7). Banco em memória (versão 1); só documentos fictícios ou exemplos oficiais com letras.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../src/db.js';
import { ErroDeUso } from '../src/erros.js';
import { criarEscritorio } from '../src/escritorios.js';
import * as clientes from '../src/clientes.js';

const { alterarSituacaoCliente, cadastrarCliente, consultarCliente, editarCliente, hojeEmBrasilia, listarClientes } = clientes;
const SENHA = 'senha-de-teste-123';
const AGORA = new Date('2026-11-04T15:00:00Z');

// Documentos fictícios: 98.765.432/0001-98 e /0002-79 calculados à mão; os demais pelo algoritmo oficial já validado.
const CNPJ_MATRIZ = '98765432000198';
const CNPJ_FILIAL = '98765432000279';
const CNPJ_FILIAL_2 = '98765432000350';
const CNPJ_OUTRA_RAIZ = '87654321000198';
const CNPJ_ALFA_MATRIZ = 'A1B2C3D4000193';
const CNPJ_ALFA_FILIAL = 'A1B2C3D4000274';
const CNPJ_OFICIAL = '12ABC34501DE35';
const CPF_1 = '28001238938';
const CPF_2 = '30511246803';
const CPF_3 = '84601359260';

let db, adminA, adminB, tenantA, tenantB;
beforeEach(() => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  tenantA = a.tenantId; tenantB = b.tenantId;
  adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  adminB = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(b.usuarioId);
});
afterEach(() => db.close());

const pj = (extra = {}) => ({ tipo: 'PJ', documento: CNPJ_MATRIZ, nome: 'Empresa Fictícia Ltda', tipo_estabelecimento: 'matriz', ...extra });
const pf = (extra = {}) => ({ tipo: 'PF', documento: CPF_1, nome: 'Pessoa Fictícia da Silva', ...extra });
const cadastrar = (dados, autor = adminA) => cadastrarCliente(db, autor, dados, AGORA);
const linha = (id) => db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
const auditoria = (acao) => db.prepare('SELECT tenant_id, usuario_id, detalhe FROM registro WHERE acao = ? ORDER BY id').all(acao)
  .map((r) => ({ tenant_id: r.tenant_id, usuario_id: r.usuario_id, ...JSON.parse(r.detalhe) }));

/** Erro de uso com status e mensagem esperados; a mensagem nunca pode conter o documento. */
function erro(fn, padrao, status = 400) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof ErroDeUso, `esperado ErroDeUso, veio ${e}`);
    assert.equal(e.status, status);
    assert.match(e.message, padrao);
    for (const doc of [CNPJ_MATRIZ, CNPJ_FILIAL, CNPJ_OUTRA_RAIZ, CPF_1, CPF_2, CNPJ_OFICIAL]) assert.ok(!e.message.includes(doc), 'mensagem com documento');
    return true;
  });
}

// --- Cadastro ---

test('PJ matriz completo: grava todos os campos normalizados e audita sem documento', () => {
  const id = cadastrar(pj({
    documento: '98.765.432/0001-98', nome: '  Empresa Fictícia Ltda  ', nome_fantasia: 'Fictícia', inscricao_estadual: 'ISENTO',
    inscricao_municipal: '1234567', tipo_estabelecimento: 'Matriz', contato_responsavel: 'Contato Fictício', cep: '01310-100',
    logradouro: 'Rua Fictícia', numero: '100', complemento: 'Sala 1', bairro: 'Centro', municipio: 'São Paulo', uf: 'sp',
    telefone: '(11) 3333-4444', email: 'contato@ficticia.com.br', codigo_dominio: 'D-001',
  }));
  const c = linha(id);
  assert.equal(c.tenant_id, tenantA);
  assert.equal(c.documento, CNPJ_MATRIZ);
  assert.equal(c.nome, 'Empresa Fictícia Ltda');
  assert.equal(c.tipo_estabelecimento, 'matriz');
  assert.equal(c.cep, '01310100');
  assert.equal(c.uf, 'SP');
  assert.equal(c.telefone, '1133334444');
  assert.equal(c.inscricao_estadual, 'ISENTO');
  assert.equal(c.ativo, 1);
  assert.deepEqual(auditoria('cliente.criado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: id, tipo: 'PJ' }]);
});

test('PJ e PF mínimos: só os obrigatórios', () => {
  const idPj = cadastrar(pj());
  const idPf = cadastrar(pf());
  assert.equal(linha(idPj).nome_fantasia, null);
  assert.equal(linha(idPf).data_nascimento, null);
  assert.equal(linha(idPf).tipo_estabelecimento, null);
});

test('PF completo: CPF com máscara, nascimento, WhatsApp; auditoria sem nome nem CPF', () => {
  const id = cadastrar(pf({ documento: '280.012.389-38', data_nascimento: '1980-02-29', whatsapp: '(11) 98765-4321', email: 'pessoa@ficticio.com', uf: 'RJ' }));
  const c = linha(id);
  assert.equal(c.documento, CPF_1);
  assert.equal(c.data_nascimento, '1980-02-29');
  assert.equal(c.whatsapp, '11987654321');
  assert.deepEqual(auditoria('cliente.criado').at(-1), { tenant_id: tenantA, usuario_id: adminA.id, cliente: id, tipo: 'PF' });
});

test('CNPJ alfanumérico: oficial e fictício aceitos; minúsculas gravadas em maiúsculas', () => {
  const id1 = cadastrar(pj({ documento: '12.abc.345/01de-35' }));
  assert.equal(linha(id1).documento, CNPJ_OFICIAL);
  const id2 = cadastrar(pj({ documento: CNPJ_ALFA_MATRIZ }));
  assert.equal(linha(id2).documento, CNPJ_ALFA_MATRIZ);
});

test('obrigatórios: tipo, documento, nome, tipo de estabelecimento (PJ) e CNPJ da matriz (filial)', () => {
  erro(() => cadastrar({ documento: CNPJ_MATRIZ, nome: 'X', tipo_estabelecimento: 'matriz' }), /tipo de pessoa: PJ ou PF/);
  erro(() => cadastrar(pj({ tipo: 'pj' })), /tipo de pessoa: PJ ou PF/);
  erro(() => cadastrar(pj({ documento: undefined })), /Informe o CNPJ/);
  erro(() => cadastrar(pf({ documento: '  ' })), /Informe o CPF/);
  erro(() => cadastrar(pj({ nome: '   ' })), /Informe o nome/);
  erro(() => cadastrar(pj({ tipo_estabelecimento: undefined })), /matriz ou filial/);
  erro(() => cadastrar(pj({ tipo_estabelecimento: 'sede' })), /matriz ou filial/);
  erro(() => cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial' })), /Informe o CNPJ da matriz/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 0);
});

test('documento inválido: DV errado, CPF em PJ, CNPJ em PF, espaço interno e valor que não é texto', () => {
  erro(() => cadastrar(pj({ documento: '98765432000189' })), /^CNPJ inválido\.$/);
  erro(() => cadastrar(pj({ documento: CPF_1 })), /^CNPJ inválido\.$/);
  erro(() => cadastrar(pf({ documento: CNPJ_MATRIZ })), /^CPF inválido\.$/);
  erro(() => cadastrar(pf({ documento: '28001238939' })), /^CPF inválido\.$/);
  erro(() => cadastrar(pf({ documento: '11111111111' })), /^CPF inválido\.$/);
  erro(() => cadastrar(pj({ documento: '98.765.432 /0001-98' })), /^CNPJ inválido\.$/);
  erro(() => cadastrar(pj({ documento: 98765432000198 })), /^CNPJ inválido\.$/);
});

test('campos de um tipo não se aplicam ao outro; campo desconhecido é recusado', () => {
  erro(() => cadastrar(pf({ nome_fantasia: 'X' })), /Nome fantasia não se aplica a pessoa física/);
  erro(() => cadastrar(pf({ tipo_estabelecimento: 'matriz' })), /não se aplica a pessoa física/);
  erro(() => cadastrar(pf({ inscricao_estadual: 'ISENTO' })), /não se aplica a pessoa física/);
  erro(() => cadastrar(pj({ data_nascimento: '1980-01-01' })), /Data de nascimento não se aplica a pessoa jurídica/);
  erro(() => cadastrar(pj({ whatsapp: '11987654321' })), /WhatsApp não se aplica a pessoa jurídica/);
  erro(() => cadastrar(pj({ ativo: 0 })), /Campo desconhecido: ativo/);
  erro(() => cadastrar(pj({ tenant_id: tenantB })), /Campo desconhecido: tenant_id/);
  erro(() => cadastrar(null), /Dados do cliente inválidos/);
});

test('matriz e filial: mesma raiz, diferente do próprio, matriz não precisa estar cadastrada; matriz sem CNPJ de matriz', () => {
  const idFilial = cadastrar(pj({ documento: '98.765.432/0002-79', tipo_estabelecimento: 'filial', cnpj_matriz: '98.765.432/0001-98' }));
  assert.equal(linha(idFilial).cnpj_matriz, CNPJ_MATRIZ, 'matriz não cadastrada no Hub: aceito');
  cadastrar(pj({ documento: CNPJ_ALFA_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: 'a1b2c3d4000193' }));
  erro(() => cadastrar(pj({ documento: CNPJ_FILIAL_2, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_OUTRA_RAIZ })), /mesma raiz/);
  erro(() => cadastrar(pj({ documento: CNPJ_FILIAL_2, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_FILIAL_2 })), /próprio CNPJ da filial/);
  erro(() => cadastrar(pj({ documento: CNPJ_FILIAL_2, tipo_estabelecimento: 'filial', cnpj_matriz: '98765432000199' })), /CNPJ da matriz inválido/);
  erro(() => cadastrar(pj({ cnpj_matriz: CNPJ_FILIAL })), /Matriz não tem CNPJ da matriz/);
});

test('formatos: CEP, UF, telefone, WhatsApp, e-mail, data e tamanho máximo', () => {
  erro(() => cadastrar(pj({ cep: '0131010' })), /CEP inválido/);
  erro(() => cadastrar(pj({ cep: '01310-10A' })), /CEP inválido/);
  erro(() => cadastrar(pj({ uf: 'XX' })), /UF inválida/);
  erro(() => cadastrar(pj({ telefone: '3333-4444' })), /Telefone inválido/);
  erro(() => cadastrar(pj({ telefone: '+55 11 3333-4444' })), /Telefone inválido/);
  erro(() => cadastrar(pf({ whatsapp: '119876543210' })), /WhatsApp inválido/);
  erro(() => cadastrar(pj({ email: 'sem-arroba.com' })), /E-mail inválido/);
  erro(() => cadastrar(pf({ data_nascimento: '1980-02-30' })), /Data de nascimento inválida/);
  erro(() => cadastrar(pf({ data_nascimento: '04/11/1980' })), /Data de nascimento inválida/);
  erro(() => cadastrar(pf({ data_nascimento: '2026-11-05' })), /não pode ser futura/);
  erro(() => cadastrar(pj({ nome: 'x'.repeat(151) })), /Nome: no máximo 150 caracteres/);
  erro(() => cadastrar(pj({ nome_fantasia: 123 })), /Nome fantasia: valor inválido/);
  assert.equal(cadastrar(pf({ data_nascimento: hojeEmBrasilia(AGORA) })) > 0, true, 'nascimento hoje é aceito');
});

test('data de hoje no horário de Brasília (não em UTC)', () => {
  assert.equal(hojeEmBrasilia(new Date('2026-11-05T02:30:00Z')), '2026-11-04');
  assert.equal(hojeEmBrasilia(new Date('2026-11-05T03:30:00Z')), '2026-11-05');
});

// --- Unicidade e isolamento entre escritórios ---

test('documento único no escritório (inclusive cliente inativo); o mesmo documento é aceito em outro escritório', () => {
  const id = cadastrar(pj());
  erro(() => cadastrar(pj({ documento: '98.765.432/0001-98' })), /Já existe cliente com este CNPJ neste escritório/);
  alterarSituacaoCliente(db, adminA, id, false);
  erro(() => cadastrar(pj()), /Já existe cliente com este CNPJ/);
  cadastrar(pf());
  erro(() => cadastrar(pf()), /Já existe cliente com este CPF/);
  const idB = cadastrar(pj(), adminB);
  assert.equal(linha(idB).tenant_id, tenantB);
});

test('código no Domínio: único no escritório quando preenchido; vazio pode repetir; outro escritório pode usar o mesmo', () => {
  cadastrar(pj({ codigo_dominio: 'D-001' }));
  erro(() => cadastrar(pj({ documento: CNPJ_OUTRA_RAIZ, codigo_dominio: ' D-001 ' })), /código no Domínio/);
  cadastrar(pj({ documento: CNPJ_OUTRA_RAIZ, codigo_dominio: '' }));
  cadastrar(pf({ codigo_dominio: null }));
  cadastrar(pj({ codigo_dominio: 'D-001' }), adminB);
});

test('isolamento: escritório B não consulta, edita, inativa nem reativa cliente de A (404, sem alterar nada)', () => {
  const id = cadastrar(pj());
  const antes = linha(id);
  const registrosAntes = db.prepare('SELECT COUNT(*) AS n FROM registro').get().n;
  erro(() => consultarCliente(db, tenantB, id), /Cliente não encontrado/, 404);
  erro(() => editarCliente(db, adminB, id, { nome: 'Invasão' }, AGORA), /Cliente não encontrado/, 404);
  erro(() => alterarSituacaoCliente(db, adminB, id, false), /Cliente não encontrado/, 404);
  assert.deepEqual(linha(id), antes);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM registro').get().n, registrosAntes);
  assert.deepEqual(listarClientes(db, tenantB, { situacao: 'todos' }).itens, []);
});

test('isolamento: cadastro grava sempre no escritório do autor, mesmo que os dados tentem outro', () => {
  erro(() => cadastrar(pj({ tenant_id: tenantB })), /Campo desconhecido/);
  const id = cadastrar(pj(), adminB);
  assert.equal(linha(id).tenant_id, tenantB);
  assert.equal(auditoria('cliente.criado')[0].tenant_id, tenantB);
});

test('isolamento: filial de A não "encontra" matriz de B com o mesmo CNPJ', () => {
  cadastrar(pj(), adminB);
  const idFilialA = cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  assert.equal(consultarCliente(db, tenantA, idFilialA).matriz, null);
});

// --- Edição e correção de documento ---

test('edição parcial: só os campos alterados mudam e a auditoria traz só os nomes', () => {
  const id = cadastrar(pj({ telefone: '1133334444', email: 'a@ficticia.com' }));
  editarCliente(db, adminA, id, { telefone: '(11) 4444-5555', email: 'a@ficticia.com', nome_fantasia: 'Nova Fantasia' }, AGORA);
  const c = linha(id);
  assert.equal(c.telefone, '1144445555');
  assert.equal(c.nome_fantasia, 'Nova Fantasia');
  assert.equal(c.nome, 'Empresa Fictícia Ltda');
  assert.deepEqual(auditoria('cliente.editado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: id, campos: ['nome_fantasia', 'telefone'] }]);
});

test('edição sem mudança não grava nada; campo vazio apaga opcional; obrigatório não pode ser apagado', () => {
  const id = cadastrar(pj({ nome_fantasia: 'Fictícia' }));
  const antes = linha(id);
  editarCliente(db, adminA, id, { nome: ' Empresa Fictícia Ltda ', documento: '98.765.432/0001-98' }, AGORA);
  assert.deepEqual(linha(id), antes);
  assert.equal(auditoria('cliente.editado').length, 0);
  editarCliente(db, adminA, id, { nome_fantasia: '' }, AGORA);
  assert.equal(linha(id).nome_fantasia, null);
  erro(() => editarCliente(db, adminA, id, { nome: '' }, AGORA), /Informe o nome/);
  erro(() => editarCliente(db, adminA, id, { tipo_estabelecimento: null }, AGORA), /matriz ou filial/);
});

test('tipo de pessoa não muda; campos do outro tipo são recusados na edição', () => {
  const id = cadastrar(pj());
  erro(() => editarCliente(db, adminA, id, { tipo: 'PF' }, AGORA), /tipo de pessoa \(PJ\/PF\) não pode ser alterado/);
  erro(() => editarCliente(db, adminA, id, { whatsapp: '11987654321' }, AGORA), /não se aplica a pessoa jurídica/);
  editarCliente(db, adminA, id, { tipo: 'PJ', nome: 'Outro Nome Ltda' }, AGORA);
  assert.equal(linha(id).tipo, 'PJ');
});

test('correção de documento: validada, única no escritório e auditada só como "documento" (sem valores)', () => {
  const id = cadastrar(pf());
  cadastrar(pf({ documento: CPF_3, nome: 'Outra Pessoa Fictícia' }));
  erro(() => editarCliente(db, adminA, id, { documento: '28001238939' }, AGORA), /^CPF inválido\.$/);
  erro(() => editarCliente(db, adminA, id, { documento: CPF_3 }, AGORA), /Já existe cliente com este CPF/);
  editarCliente(db, adminA, id, { documento: '305.112.468-03' }, AGORA);
  assert.equal(linha(id).documento, CPF_2);
  assert.deepEqual(auditoria('cliente.editado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: id, campos: ['documento'] }]);
});

test('corrigir o CNPJ de uma matriz não altera as filiais; elas passam a não encontrar a matriz (A-15)', () => {
  const idMatriz = cadastrar(pj());
  const idFilial = cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  assert.equal(consultarCliente(db, tenantA, idFilial).matriz.id, idMatriz);
  const filialAntes = linha(idFilial);
  editarCliente(db, adminA, idMatriz, { documento: CNPJ_ALFA_MATRIZ }, AGORA);
  assert.deepEqual(linha(idFilial), filialAntes, 'filial intocada');
  assert.equal(auditoria('cliente.editado').length, 1, 'nenhuma auditoria em cadeia');
  assert.equal(consultarCliente(db, tenantA, idFilial).matriz, null);
  assert.deepEqual(consultarCliente(db, tenantA, idMatriz).filiais, []);
  // o administrador corrige o vínculo da filial manualmente (mesma raiz exigida)
  erro(() => editarCliente(db, adminA, idFilial, { cnpj_matriz: CNPJ_ALFA_MATRIZ }, AGORA), /mesma raiz/);
});

test('filial vira matriz só apagando o CNPJ da matriz; matriz vira filial informando a matriz', () => {
  const idFilial = cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  erro(() => editarCliente(db, adminA, idFilial, { tipo_estabelecimento: 'matriz' }, AGORA), /Matriz não tem CNPJ da matriz/);
  editarCliente(db, adminA, idFilial, { tipo_estabelecimento: 'matriz', cnpj_matriz: null }, AGORA);
  assert.equal(linha(idFilial).cnpj_matriz, null);
  editarCliente(db, adminA, idFilial, { tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }, AGORA);
  assert.equal(linha(idFilial).cnpj_matriz, CNPJ_MATRIZ);
});

// --- Consulta e lista ---

test('consulta: detalhe com matriz cadastrada e filiais, todos do mesmo escritório', () => {
  const idMatriz = cadastrar(pj());
  const idF1 = cadastrar(pj({ documento: CNPJ_FILIAL, nome: 'Filial Um', tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  const idF2 = cadastrar(pj({ documento: CNPJ_FILIAL_2, nome: 'Filial Dois', tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  const m = consultarCliente(db, tenantA, idMatriz);
  assert.equal(m.matriz, null);
  assert.deepEqual(m.filiais.map((f) => f.id), [idF2, idF1]);
  assert.equal(consultarCliente(db, tenantA, idF1).matriz.id, idMatriz);
  assert.deepEqual(consultarCliente(db, tenantA, cadastrar(pf())).filiais, []);
  erro(() => consultarCliente(db, tenantA, 999999), /Cliente não encontrado/, 404);
});

test('lista: filtros por tipo e situação, busca por nome e por documento com máscara, % e _ como texto', () => {
  const idPj = cadastrar(pj({ nome: 'Alfa 100% Ltda' }));
  const idPf = cadastrar(pf({ nome: 'Beta_Silva' }));
  const idInativo = cadastrar(pj({ documento: CNPJ_OUTRA_RAIZ, nome: 'Gama Ltda' }));
  alterarSituacaoCliente(db, adminA, idInativo, false);
  const ids = (filtro) => listarClientes(db, tenantA, filtro).itens.map((c) => c.id);

  assert.deepEqual(ids(), [idPj, idPf], 'padrão: só ativos, por nome');
  assert.deepEqual(ids({ situacao: 'inativos' }), [idInativo]);
  assert.deepEqual(ids({ situacao: 'todos' }), [idPj, idPf, idInativo]);
  assert.deepEqual(ids({ tipo: 'PF' }), [idPf]);
  assert.deepEqual(ids({ busca: 'alfa' }), [idPj], 'nome sem diferenciar maiúsculas');
  assert.deepEqual(ids({ busca: '100%' }), [idPj]);
  assert.deepEqual(ids({ busca: '%' }), [idPj], '% é texto, não curinga');
  assert.deepEqual(ids({ busca: '_' }), [idPf], '_ é texto, não curinga');
  assert.deepEqual(ids({ busca: '98.765.432/0001' }), [idPj], 'documento com máscara');
  assert.deepEqual(ids({ busca: '280.012' }), [idPf]);
  assert.deepEqual(ids({ busca: '   ' }), [idPj, idPf]);
  erro(() => listarClientes(db, tenantA, { tipo: 'XX' }), /Tipo inválido/);
  erro(() => listarClientes(db, tenantA, { situacao: 'qualquer' }), /Situação inválida/);
  erro(() => listarClientes(db, tenantA, { pagina: 0 }), /Página inválida/);
});

test('lista: páginas de 100 e total', () => {
  const insere = db.prepare("INSERT INTO clientes (tenant_id, tipo, documento, nome) VALUES (?, 'PF', ?, ?)");
  for (let i = 0; i < 205; i++) insere.run(tenantA, String(10000000000 + i), `Pessoa ${String(i).padStart(3, '0')}`);
  const p1 = listarClientes(db, tenantA, { pagina: 1 });
  const p3 = listarClientes(db, tenantA, { pagina: 3 });
  assert.equal(p1.total, 205);
  assert.equal(p1.itens.length, 100);
  assert.equal(p3.itens.length, 5);
  assert.equal(p3.itens[0].nome, 'Pessoa 200');
});

// --- Situação ---

test('inativar e reativar: nunca exclui, audita e recusa estado repetido', () => {
  const id = cadastrar(pj());
  alterarSituacaoCliente(db, adminA, id, false);
  assert.equal(linha(id).ativo, 0);
  erro(() => alterarSituacaoCliente(db, adminA, id, false), /já está inativo/);
  assert.equal(consultarCliente(db, tenantA, id).ativo, 0, 'cliente inativo continua consultável');
  alterarSituacaoCliente(db, adminA, id, true);
  assert.equal(linha(id).ativo, 1);
  erro(() => alterarSituacaoCliente(db, adminA, id, true), /já está ativo/);
  erro(() => alterarSituacaoCliente(db, adminA, id, 'false'), /Situação inválida/);
  assert.deepEqual(auditoria('cliente.inativado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: id, servicosEncerrados: 0 }]);
  assert.deepEqual(auditoria('cliente.reativado'), [{ tenant_id: tenantA, usuario_id: adminA.id, cliente: id }]);
});

test('exclusão definitiva não existe no módulo', () => {
  const nomes = Object.keys(clientes);
  assert.deepEqual(nomes.sort(), ['alterarSituacaoCliente', 'cadastrarCliente', 'consultarCliente', 'contratarServico', 'criarServicoCatalogo',
    'editarCliente', 'editarServicoCatalogo', 'encerrarServico', 'hojeEmBrasilia', 'listarCatalogo', 'listarClientes', 'servicosDoCliente']);
  assert.ok(!nomes.some((n) => /exclu|apag|remov|delet/i.test(n)));
});

// --- Auditoria sem dados pessoais ---

test('auditoria: nenhum CPF, CNPJ, CNPJ da matriz, código no Domínio ou nome de PF no registro', () => {
  const idPf = cadastrar(pf({ codigo_dominio: 'DOM-PF-77' }));
  editarCliente(db, adminA, idPf, { documento: CPF_2, nome: 'Nome Novo Fictício' }, AGORA);
  alterarSituacaoCliente(db, adminA, idPf, false);
  const idFilial = cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ, codigo_dominio: 'DOM-PJ-88' }));
  editarCliente(db, adminA, idFilial, { codigo_dominio: 'DOM-PJ-99' }, AGORA);
  const tudo = JSON.stringify(db.prepare('SELECT * FROM registro').all());
  for (const sensivel of [CPF_1, CPF_2, CNPJ_FILIAL, CNPJ_MATRIZ, '98.765.432', '280.012', 'DOM-PF-77', 'DOM-PJ-88', 'DOM-PJ-99',
    'Pessoa Fictícia da Silva', 'Nome Novo Fictício']) {
    assert.ok(!tudo.includes(sensivel), `registro contém: ${sensivel}`);
  }
});

// --- Revalidação do vínculo matriz/filial na edição (o que não foi enviado também é conferido) ---

/** A edição tem de ser recusada sem gravar nada e sem auditoria. */
function edicaoRecusada(id, dados, padrao) {
  const antes = linha(id);
  const auditoriasAntes = auditoria('cliente.editado').length;
  erro(() => editarCliente(db, adminA, id, dados, AGORA), padrao);
  assert.deepEqual(linha(id), antes, 'cliente intocado');
  assert.equal(auditoria('cliente.editado').length, auditoriasAntes, 'sem auditoria');
}

test('filial: editar só o CNPJ revalida a raiz contra o CNPJ da matriz já gravado', () => {
  const idFilial = cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  edicaoRecusada(idFilial, { documento: CNPJ_OUTRA_RAIZ }, /mesma raiz/);
  edicaoRecusada(idFilial, { documento: CNPJ_ALFA_FILIAL }, /mesma raiz/);
  edicaoRecusada(idFilial, { documento: CNPJ_MATRIZ }, /próprio CNPJ da filial/);
  // mesma raiz: aceito, e o vínculo gravado continua o mesmo
  editarCliente(db, adminA, idFilial, { documento: '98.765.432/0003-50' }, AGORA);
  assert.equal(linha(idFilial).documento, CNPJ_FILIAL_2);
  assert.equal(linha(idFilial).cnpj_matriz, CNPJ_MATRIZ);
  assert.deepEqual(auditoria('cliente.editado').at(-1).campos, ['documento']);
});

test('filial: editar só o CNPJ da matriz também revalida (inválido, outra raiz, igual ao próprio)', () => {
  const idFilial = cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  edicaoRecusada(idFilial, { cnpj_matriz: '98765432000199' }, /CNPJ da matriz inválido/);
  edicaoRecusada(idFilial, { cnpj_matriz: CNPJ_OUTRA_RAIZ }, /mesma raiz/);
  edicaoRecusada(idFilial, { cnpj_matriz: CNPJ_FILIAL }, /próprio CNPJ da filial/);
  edicaoRecusada(idFilial, { cnpj_matriz: null }, /Informe o CNPJ da matriz/);
});

test('matriz virando filial: exige CNPJ da matriz válido e de mesma raiz, conferido contra o CNPJ já gravado', () => {
  const id = cadastrar(pj({ documento: CNPJ_FILIAL }));
  edicaoRecusada(id, { tipo_estabelecimento: 'filial' }, /Informe o CNPJ da matriz/);
  edicaoRecusada(id, { tipo_estabelecimento: 'filial', cnpj_matriz: '' }, /Informe o CNPJ da matriz/);
  edicaoRecusada(id, { tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_OUTRA_RAIZ }, /mesma raiz/);
  edicaoRecusada(id, { tipo_estabelecimento: 'filial', cnpj_matriz: '98765432000199' }, /CNPJ da matriz inválido/);
  edicaoRecusada(id, { tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_FILIAL }, /próprio CNPJ da filial/);
  editarCliente(db, adminA, id, { tipo_estabelecimento: 'Filial', cnpj_matriz: '98.765.432/0001-98' }, AGORA);
  assert.equal(linha(id).tipo_estabelecimento, 'filial');
  assert.equal(linha(id).cnpj_matriz, CNPJ_MATRIZ);
  assert.deepEqual(auditoria('cliente.editado').at(-1).campos, ['tipo_estabelecimento', 'cnpj_matriz']);
});

test('matriz virando filial com troca de CNPJ no mesmo pedido: a raiz é conferida contra o CNPJ novo', () => {
  const id = cadastrar(pj({ documento: CNPJ_OUTRA_RAIZ }));
  // o CNPJ gravado (outra raiz) não combinaria com a matriz; o novo CNPJ enviado junto combina
  edicaoRecusada(id, { tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }, /mesma raiz/);
  editarCliente(db, adminA, id, { documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }, AGORA);
  assert.equal(linha(id).documento, CNPJ_FILIAL);
});

test('filial virando matriz e tipo de estabelecimento inválido: obrigatórios e vínculo revalidados', () => {
  const idFilial = cadastrar(pj({ documento: CNPJ_FILIAL, tipo_estabelecimento: 'filial', cnpj_matriz: CNPJ_MATRIZ }));
  edicaoRecusada(idFilial, { tipo_estabelecimento: 'matriz' }, /Matriz não tem CNPJ da matriz/);
  edicaoRecusada(idFilial, { tipo_estabelecimento: 'sede' }, /matriz ou filial/);
  edicaoRecusada(idFilial, { tipo_estabelecimento: '' }, /matriz ou filial/);
  edicaoRecusada(idFilial, { tipo_estabelecimento: 'matriz', cnpj_matriz: CNPJ_OUTRA_RAIZ }, /Matriz não tem CNPJ da matriz/);
  editarCliente(db, adminA, idFilial, { tipo_estabelecimento: 'matriz', cnpj_matriz: '' }, AGORA);
  assert.equal(linha(idFilial).tipo_estabelecimento, 'matriz');
  assert.equal(linha(idFilial).cnpj_matriz, null);
});
