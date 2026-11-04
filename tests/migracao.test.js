// Controle de versão e migração 001. Só bancos em memória ou arquivos temporários; dados fictícios.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirBanco, registrar } from '../src/db.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';
import { criarSessao } from '../src/auth.js';
import { aplicarMigracao001, versaoDoBanco, VERSAO_ATUAL } from '../src/migracoes.js';
import { abrirBancoVersao0 } from './banco-versao0.js';

const SENHA = 'senha-de-teste-123';
const TABELAS_V0 = ['departamentos', 'registro', 'sessoes', 'tenants', 'usuario_departamentos', 'usuarios'];
const TABELAS_V1 = [...TABELAS_V0, 'cliente_servicos', 'clientes', 'servicos'].sort();
const CATALOGO = [
  { chave: 'contabil', nome: 'Contábil', tipo_cliente: 'PJ', ativo: 1 },
  { chave: 'domestica', nome: 'Doméstica', tipo_cliente: 'PF', ativo: 1 },
  { chave: 'fiscal', nome: 'Fiscal', tipo_cliente: 'PJ', ativo: 1 },
  { chave: 'folha', nome: 'Folha', tipo_cliente: 'PJ', ativo: 1 },
];

const pastas = [];
afterEach(() => { while (pastas.length) rmSync(pastas.pop(), { recursive: true, force: true }); });
function arquivoTemporario() {
  const pasta = mkdtempSync(join(tmpdir(), 'hub-teste-migracao-'));
  pastas.push(pasta);
  return join(pasta, 'hub.db');
}

const tabelas = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
const contagens = (db) => Object.fromEntries(tabelas(db).map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n]));
const departamentosDe = (db, tenantId) => db.prepare('SELECT chave FROM departamentos WHERE tenant_id = ? ORDER BY chave').all(tenantId).map((d) => d.chave);
const catalogoDe = (db, tenantId) => db.prepare('SELECT chave, nome, tipo_cliente, ativo FROM servicos WHERE tenant_id = ? ORDER BY chave').all(tenantId);

/** Banco versão 0 com dados fictícios de dois escritórios: usuários, vínculos, sessão e registro. */
function bancoV0ComDados(caminho) {
  const db = abrirBancoVersao0(caminho);
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  const adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  const fulano = criarUsuario(db, adminA, { nome: 'Fulano A', login: 'fulano', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] });
  criarSessao(db, db.prepare('SELECT * FROM usuarios WHERE id = ?').get(fulano), 10);
  registrar(db, { tenantId: b.tenantId, usuarioId: b.usuarioId, acao: 'login' });
  return { db, tenantA: a.tenantId, tenantB: b.tenantId };
}

// --- Banco novo ---

test('banco novo (memória e arquivo) nasce na versão atual com todas as tabelas', () => {
  for (const caminho of [':memory:', arquivoTemporario()]) {
    const db = abrirBanco(caminho);
    assert.equal(VERSAO_ATUAL, 1);
    assert.equal(versaoDoBanco(db), 1, caminho);
    assert.deepEqual(tabelas(db), TABELAS_V1, caminho);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    db.close();
  }
});

test('banco novo: criarEscritorio cria 3 departamentos e o catálogo de 4 serviços', () => {
  const db = abrirBanco(':memory:');
  const { tenantId } = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  assert.deepEqual(departamentosDe(db, tenantId), ['contabil', 'fiscal', 'pessoal']);
  assert.deepEqual(catalogoDe(db, tenantId), CATALOGO);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usuario_departamentos').get().n, 0);
  db.close();
});

// --- Banco existente na versão 0 ---

test('banco existente na versão 0: abrir não migra, não cria tabela e não grava nada', () => {
  const caminho = arquivoTemporario();
  const { db: v0 } = bancoV0ComDados(caminho);
  const antes = contagens(v0);
  v0.close();

  const db = abrirBanco(caminho);
  assert.equal(versaoDoBanco(db), 0);
  assert.deepEqual(tabelas(db), TABELAS_V0);
  assert.deepEqual(contagens(db), antes);
  db.close();
  const deNovo = abrirBanco(caminho);
  assert.equal(versaoDoBanco(deNovo), 0, 'abrir de novo continua na versão 0');
  deNovo.close();
});

test('banco na versão 0: criarEscritorio continua como hoje (só fiscal e pessoal, sem catálogo)', () => {
  const db = abrirBancoVersao0();
  const { tenantId } = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  assert.deepEqual(departamentosDe(db, tenantId), ['fiscal', 'pessoal']);
  assert.deepEqual(tabelas(db), TABELAS_V0);
  db.close();
});

// --- Migração 001 ---

test('migração 001: cria estrutura, Contábil e catálogo em cada escritório, sem mexer nos dados existentes', () => {
  const { db, tenantA, tenantB } = bancoV0ComDados(':memory:');
  const antes = contagens(db);
  const resumo = aplicarMigracao001(db);

  assert.equal(versaoDoBanco(db), 1);
  assert.deepEqual(tabelas(db), TABELAS_V1);
  for (const t of [tenantA, tenantB]) {
    assert.deepEqual(departamentosDe(db, t), ['contabil', 'fiscal', 'pessoal'], `escritório ${t}`);
    assert.deepEqual(catalogoDe(db, t), CATALOGO, `escritório ${t}`);
  }
  const depois = contagens(db);
  for (const t of ['tenants', 'usuarios', 'usuario_departamentos', 'sessoes']) assert.equal(depois[t], antes[t], t);
  assert.equal(depois.departamentos, antes.departamentos + 2);
  assert.equal(depois.registro, antes.registro + 2);
  assert.equal(depois.clientes, 0);
  assert.equal(depois.cliente_servicos, 0);

  const migracao = db.prepare("SELECT tenant_id, usuario_id, detalhe FROM registro WHERE acao = 'migracao.aplicada' ORDER BY tenant_id").all();
  assert.deepEqual(migracao, [{ tenant_id: tenantA, usuario_id: null, detalhe: '{"versao":1}' }, { tenant_id: tenantB, usuario_id: null, detalhe: '{"versao":1}' }]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM usuario_departamentos ud JOIN departamentos d ON d.id = ud.departamento_id WHERE d.chave = 'contabil'").get().n, 0,
    'ninguém ganha acesso ao Contábil');
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
  assert.deepEqual(resumo.escritorios, ['escritorio-a', 'escritorio-b']);
  assert.equal(resumo.versaoAntes, 0);
  assert.equal(resumo.versaoDepois, 1);
  db.close();
});

test('migração 001: escritório criado depois da migração recebe Contábil e catálogo pelo criarEscritorio', () => {
  const { db } = bancoV0ComDados(':memory:');
  aplicarMigracao001(db);
  const { tenantId } = criarEscritorio(db, { codigo: 'escritorio-c', nome: 'Escritório C (fictício)', admin: { nome: 'Admin C', login: 'admin', senha: SENHA } });
  assert.deepEqual(departamentosDe(db, tenantId), ['contabil', 'fiscal', 'pessoal']);
  assert.deepEqual(catalogoDe(db, tenantId), CATALOGO);
  db.close();
});

test('migração 001: banco sem nenhum escritório também migra', () => {
  const db = abrirBancoVersao0();
  aplicarMigracao001(db);
  assert.equal(versaoDoBanco(db), 1);
  assert.deepEqual(tabelas(db), TABELAS_V1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM servicos').get().n, 0);
  db.close();
});

test('migração 001: em banco que já está na versão 1, recusa sem alterar nada', () => {
  const { db } = bancoV0ComDados(':memory:');
  aplicarMigracao001(db);
  const antes = contagens(db);
  assert.throws(() => aplicarMigracao001(db), /exige o banco na versão 0; versão atual: 1/);
  assert.deepEqual(contagens(db), antes);
  assert.equal(versaoDoBanco(db), 1);
  db.close();
});

// --- Reversão total ---

/** Confere que o banco voltou exatamente ao estado de antes da tentativa. */
function confereRevertido(db, tabelasAntes, contagensAntes) {
  assert.equal(versaoDoBanco(db), 0, 'user_version voltou para 0');
  assert.deepEqual(tabelas(db), tabelasAntes, 'nenhuma tabela nova sobrou');
  assert.deepEqual(contagens(db), contagensAntes, 'nenhuma linha nova sobrou');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM departamentos WHERE chave = 'contabil'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM registro WHERE acao = 'migracao.aplicada'").get().n, 0);
}

test('reversão: tabela "servicos" já existente e incompatível faz a migração falhar e nada muda', () => {
  const { db } = bancoV0ComDados(':memory:');
  db.exec('CREATE TABLE servicos (id INTEGER PRIMARY KEY, outro_campo TEXT)');
  const tabelasAntes = tabelas(db), contagensAntes = contagens(db);
  assert.throws(() => aplicarMigracao001(db), /servicos already exists/);
  confereRevertido(db, tabelasAntes, contagensAntes);
  db.close();
});

test('reversão: falha na validação, depois de criar tabelas e gravar a versão, desfaz tudo (inclusive user_version)', () => {
  const { db } = bancoV0ComDados(':memory:');
  // vínculo inconsistente gravado com as chaves estrangeiras desligadas: foreign_key_check acusa na validação
  db.pragma('foreign_keys = OFF');
  db.prepare("INSERT INTO usuario_departamentos (usuario_id, departamento_id, nivel) VALUES (1, 9999, 'consulta')").run();
  db.pragma('foreign_keys = ON');
  const tabelasAntes = tabelas(db), contagensAntes = contagens(db);
  assert.throws(() => aplicarMigracao001(db), /Validação da migração 001 falhou: vínculos inconsistentes/);
  confereRevertido(db, tabelasAntes, contagensAntes);
  db.close();
});

test('reversão em arquivo: depois de reabrir, o banco continua na versão 0 e íntegro', () => {
  const caminho = arquivoTemporario();
  const { db } = bancoV0ComDados(caminho);
  db.exec('CREATE TABLE cliente_servicos (x TEXT)');
  const tabelasAntes = tabelas(db), contagensAntes = contagens(db);
  assert.throws(() => aplicarMigracao001(db));
  db.close();
  const reaberto = abrirBanco(caminho);
  confereRevertido(reaberto, tabelasAntes, contagensAntes);
  assert.equal(reaberto.pragma('integrity_check', { simple: true }), 'ok');
  reaberto.close();
});

// --- Conteúdo das tabelas antigas (não só as contagens) ---

test('conteúdo: resumo lista as 6 tabelas antigas conferidas e não traz nenhum dado de pessoa', () => {
  const { db } = bancoV0ComDados(':memory:');
  const resumo = aplicarMigracao001(db);
  assert.deepEqual(resumo.tabelasConferidas, ['tenants', 'usuarios', 'departamentos', 'usuario_departamentos', 'sessoes', 'registro']);
  const texto = JSON.stringify(resumo);
  const senhaHash = db.prepare("SELECT senha_hash FROM usuarios WHERE login = 'fulano'").get().senha_hash;
  const sessao = db.prepare('SELECT token_hash FROM sessoes').get().token_hash;
  for (const dado of ['Admin A', 'Fulano A', 'fulano', SENHA, senhaHash, sessao]) assert.ok(!texto.includes(dado), `resumo não pode conter: ${dado}`);
  db.close();
});

// Cada caso: um gatilho altera um registro antigo durante a própria migração, sem mudar nenhuma contagem.
const ALTERACOES_SILENCIOSAS = [
  ['usuarios', "UPDATE usuarios SET nome = 'Nome Trocado' WHERE login = 'fulano'"],
  ['usuarios', "UPDATE usuarios SET perfil = 'admin' WHERE login = 'fulano'"],
  ['departamentos', "UPDATE departamentos SET nome = 'Fiscal Trocado' WHERE chave = 'fiscal' AND id = (SELECT MIN(id) FROM departamentos)"],
  ['usuario_departamentos', "UPDATE usuario_departamentos SET nivel = 'operacao'"],
  ['sessoes', "UPDATE sessoes SET expira_em = '2099-01-01T00:00:00.000Z'"],
  ['tenants', "UPDATE tenants SET ativo = 0 WHERE codigo = 'escritorio-b'"],
  ['registro', "UPDATE registro SET acao = 'acao.trocada' WHERE id = (SELECT MIN(id) FROM registro)"],
];

for (const [tabela, alteracao] of ALTERACOES_SILENCIOSAS) {
  test(`conteúdo: alteração de registro antigo em ${tabela} durante a migração é detectada e tudo é desfeito (${alteracao.slice(0, 40)}…)`, () => {
    const { db } = bancoV0ComDados(':memory:');
    db.exec(`CREATE TRIGGER altera_durante_migracao AFTER INSERT ON departamentos BEGIN ${alteracao}; END;`);
    const tabelasAntes = tabelas(db), contagensAntes = contagens(db);
    const linhasAntes = db.prepare(`SELECT * FROM "${tabela}" ORDER BY rowid`).all();
    assert.throws(() => aplicarMigracao001(db), new RegExp(`registros já existentes da tabela ${tabela} foram alterados`));
    confereRevertido(db, tabelasAntes, contagensAntes);
    assert.deepEqual(db.prepare(`SELECT * FROM "${tabela}" ORDER BY rowid`).all(), linhasAntes, 'o registro alterado voltou ao original');
    db.close();
  });
}
