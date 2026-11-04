// Comando de migração (npm run migrar). Só bancos em pastas temporárias e dados fictícios — nunca data/hub.db.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { registrar } from '../src/db.js';
import { criarSessao } from '../src/auth.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';
import { executarMigracao } from '../src/migrar.js';
import { abrirBancoVersao0 } from './banco-versao0.js';

const SENHA = 'senha-de-teste-123';
const AGORA = new Date('2026-11-04T23:00:00Z');
const pastas = [];
afterEach(() => { while (pastas.length) rmSync(pastas.pop(), { recursive: true, force: true }); });

/** Pasta temporária com um banco versão 0 e dados fictícios (2 escritórios, usuário, vínculo, sessão, registro). */
function cenario({ preparar } = {}) {
  const pasta = mkdtempSync(join(tmpdir(), 'hub-teste-migrar-'));
  pastas.push(pasta);
  const dbPath = join(pasta, 'hub.db');
  const db = abrirBancoVersao0(dbPath);
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  const adminA = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(a.usuarioId);
  const fulano = criarUsuario(db, adminA, { nome: 'Fulano A', login: 'fulano', senha: SENHA, departamentos: [{ chave: 'pessoal', nivel: 'consulta' }] });
  criarSessao(db, db.prepare('SELECT * FROM usuarios WHERE id = ?').get(fulano), 10);
  registrar(db, { tenantId: b.tenantId, usuarioId: b.usuarioId, acao: 'login' });
  preparar?.(db);
  db.close();
  return { pasta, dbPath, backupDir: join(pasta, 'backups-migracao'), logDir: join(pasta, 'logs') };
}

/** Estado do banco para comparar antes/depois: versão, estrutura (tabelas, índices, gatilhos) e todas as linhas. */
function estado(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tabelas = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((t) => t.name);
    const estrutura = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
    return { versao: db.pragma('user_version', { simple: true }), tabelas, estrutura,
      linhas: Object.fromEntries(tabelas.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all()])) };
  } finally {
    db.close();
  }
}
const fechado = async () => false;
const aberto = async () => true;
const migrar = (c, extra = {}) => executarMigracao({ dbPath: c.dbPath, backupDir: c.backupDir, logDir: c.logDir, hubAberto: fechado, agora: AGORA, ...extra });
const arquivos = (pasta) => (existsSync(pasta) ? readdirSync(pasta).sort() : []);
const relatorioGravado = (r) => JSON.parse(readFileSync(r.relatorio, 'utf8'));

/** Nenhum dado de pessoa (nomes, logins, senha, hashes, tokens) pode aparecer no relatório. */
function semDadosPessoais(c, r) {
  const texto = readFileSync(r.relatorio, 'utf8');
  const db = new Database(c.dbPath, { readonly: true });
  const sensiveis = [SENHA, 'Admin A', 'Admin B', 'Fulano A', '"fulano"',
    ...db.prepare('SELECT senha_hash FROM usuarios').all().map((u) => u.senha_hash),
    ...db.prepare('SELECT token_hash FROM sessoes').all().map((s) => s.token_hash)];
  db.close();
  for (const s of sensiveis) assert.ok(!texto.includes(s), `relatório não pode conter: ${s.slice(0, 20)}`);
}

// --- Caminho feliz ---

test('migração completa: aplica, deixa backup conferido, apaga o ensaio e grava relatório', async () => {
  const c = cenario();
  const antes = estado(c.dbPath);
  const r = await migrar(c);

  assert.equal(r.resultado, 'aplicada', r.motivo);
  assert.equal(r.versaoAntes, 0);
  assert.equal(r.versaoDepois, 1);
  assert.deepEqual(r.verificacoes.map((v) => v.passo), ['hub_fechado', 'versao', 'saude', 'backup', 'ensaio', 'comparacao', 'aplicacao', 'conferencia_final']);
  assert.ok(r.verificacoes.every((v) => v.ok));
  assert.deepEqual(r.escritorios, [{ codigo: 'escritorio-a', departamentos: 3, servicos: 4 }, { codigo: 'escritorio-b', departamentos: 3, servicos: 4 }]);

  const depois = estado(c.dbPath);
  assert.equal(depois.versao, 1);
  for (const t of ['tenants', 'usuarios', 'usuario_departamentos', 'sessoes']) assert.deepEqual(depois.linhas[t], antes.linhas[t], t);

  // backup: só ele fica na pasta (ensaio apagado), é a versão 0 idêntica ao banco de antes, com o SHA-256 do relatório
  assert.deepEqual(arquivos(c.backupDir), ['hub_antes_migracao_001_2026-11-04_200000.db']);
  assert.equal(r.backup.caminho, join(c.backupDir, 'hub_antes_migracao_001_2026-11-04_200000.db'));
  assert.equal(createHash('sha256').update(readFileSync(r.backup.caminho)).digest('hex'), r.backup.sha256);
  assert.deepEqual(estado(r.backup.caminho), antes);

  assert.equal(r.relatorio, join(c.logDir, 'migracao-001-2026-11-04_200000.json'));
  assert.equal(relatorioGravado(r).resultado, 'aplicada');
  semDadosPessoais(c, r);
});

test('banco já na versão 1: nada é feito (nem backup) e o relatório diz "já aplicada"', async () => {
  const c = cenario();
  await migrar(c);
  rmSync(c.backupDir, { recursive: true });
  const antes = estado(c.dbPath);
  const r = await migrar(c, { agora: new Date('2026-11-05T12:00:00Z') });
  assert.equal(r.resultado, 'ja_aplicada');
  assert.deepEqual(estado(c.dbPath), antes);
  assert.deepEqual(arquivos(c.backupDir), []);
});

// --- Paradas antes de tocar no banco real ---

test('Hub aberto: para antes de qualquer cópia ou gravação', async () => {
  const c = cenario();
  const antes = estado(c.dbPath);
  const r = await migrar(c, { hubAberto: aberto });
  assert.equal(r.resultado, 'abortada');
  assert.equal(r.passo, 'hub_aberto');
  assert.deepEqual(estado(c.dbPath), antes);
  assert.deepEqual(arquivos(c.backupDir), []);
  assert.equal(relatorioGravado(r).passo, 'hub_aberto');
});

test('Hub aberto durante a preparação: confere de novo antes de aplicar e para sem alterar o banco', async () => {
  const c = cenario();
  const antes = estado(c.dbPath);
  let chamadas = 0;
  const r = await migrar(c, { hubAberto: async () => ++chamadas > 1 });
  assert.equal(chamadas, 2);
  assert.equal(r.resultado, 'abortada');
  assert.equal(r.passo, 'hub_aberto');
  assert.deepEqual(estado(c.dbPath), antes);
  assert.equal(arquivos(c.backupDir).length, 1, 'o backup feito antes continua guardado');
});

test('banco inexistente: para e não cria o arquivo', async () => {
  const c = cenario();
  const dbPath = join(c.pasta, 'nao-existe.db');
  const r = await migrar({ ...c, dbPath });
  assert.equal(r.resultado, 'abortada');
  assert.equal(r.passo, 'banco');
  assert.equal(existsSync(dbPath), false);
});

test('versão inesperada: para sem alterar', async () => {
  const c = cenario({ preparar: (db) => db.pragma('user_version = 7') });
  const antes = estado(c.dbPath);
  const r = await migrar(c);
  assert.equal(r.resultado, 'abortada');
  assert.equal(r.passo, 'versao');
  assert.deepEqual(estado(c.dbPath), antes);
});

test('banco atual com vínculo inconsistente: para na conferência de saúde, antes do backup', async () => {
  const c = cenario({ preparar: (db) => {
    db.pragma('foreign_keys = OFF');
    db.prepare("INSERT INTO usuario_departamentos (usuario_id, departamento_id, nivel) VALUES (1, 9999, 'consulta')").run();
  } });
  const antes = estado(c.dbPath);
  const r = await migrar(c);
  assert.equal(r.resultado, 'abortada');
  assert.equal(r.passo, 'saude');
  assert.deepEqual(estado(c.dbPath), antes);
  assert.deepEqual(arquivos(c.backupDir), []);
});

test('falha no backup: para sem alterar o banco e não deixa cópia pela metade', async () => {
  const c = cenario();
  writeFileSync(c.backupDir, 'um arquivo no lugar da pasta de backup');
  const antes = estado(c.dbPath);
  const r = await migrar(c);
  assert.equal(r.resultado, 'abortada');
  assert.equal(r.passo, 'backup');
  assert.deepEqual(estado(c.dbPath), antes);
});

test('falha no ensaio: o banco real não é tocado e a cópia de ensaio é apagada', async () => {
  const c = cenario({ preparar: (db) => db.exec('CREATE TABLE servicos (id INTEGER PRIMARY KEY, outro_campo TEXT)') });
  const antes = estado(c.dbPath);
  const r = await migrar(c);
  assert.equal(r.resultado, 'abortada');
  assert.equal(r.passo, 'ensaio');
  assert.match(r.motivo, /banco real não foi tocado/);
  assert.deepEqual(estado(c.dbPath), antes);
  assert.deepEqual(arquivos(c.backupDir), ['hub_antes_migracao_001_2026-11-04_200000.db'], 'só o backup; ensaio apagado');
});

// --- Banco alterado depois do backup e antes da aplicação ---
// A segunda conferência de "Hub fechado" acontece depois do backup e do ensaio e imediatamente antes da transação:
// é nesse momento que o teste grava uma alteração no banco (outra conexão, como faria outro processo).

const ALTERACOES_DEPOIS_DO_BACKUP = [
  ['linha alterada', "UPDATE usuarios SET nome = 'Nome Trocado' WHERE login = 'fulano'"],
  ['campo alterado sem mudar contagem', "UPDATE usuario_departamentos SET nivel = 'operacao'"],
  ['linha incluída', "INSERT INTO registro (tenant_id, usuario_id, acao) VALUES (1, 1, 'login')"],
  ['linha excluída', 'DELETE FROM sessoes'],
  ['estrutura alterada (índice novo)', 'CREATE INDEX idx_teste_qualquer ON usuarios (nome)'],
  ['versão do banco alterada', 'PRAGMA user_version = 2'],
  // controle: grava no banco, mas sem mudar nenhum valor; a comparação tem de deixar a migração seguir
  ['controle: gravação sem mudança de conteúdo', 'PRAGMA user_version = 0; UPDATE tenants SET ativo = ativo'],
];

for (const [caso, sql] of ALTERACOES_DEPOIS_DO_BACKUP) {
  const controle = caso.startsWith('controle');
  test(`banco alterado depois do backup (${caso}): ${controle ? 'sem mudança real, a migração segue' : 'migração interrompida, backup preservado'}`, async () => {
    const c = cenario();
    const antes = estado(c.dbPath);
    let chamadas = 0;
    const r = await migrar(c, { hubAberto: async () => {
      if (++chamadas === 2) {
        const outro = new Database(c.dbPath);
        outro.exec(sql);
        outro.close();
      }
      return false;
    } });
    assert.equal(chamadas, 2);

    if (controle) {
      assert.equal(r.resultado, 'aplicada', r.motivo);
      return;
    }
    assert.equal(r.resultado, 'abortada', r.motivo);
    assert.equal(r.passo, 'comparacao');
    assert.match(r.motivo, /O banco mudou depois do backup/);
    assert.match(r.motivo, /backup foi preservado/);
    assert.ok(!r.verificacoes.some((v) => v.passo === 'aplicacao'), 'nada foi aplicado');

    // banco real: só a alteração externa, nenhuma migração (nunca versão 1, sem tabelas novas, sem Contábil)
    const depois = estado(c.dbPath);
    assert.equal(depois.versao, caso === 'versão do banco alterada' ? 2 : 0, 'versão deixada pela alteração externa; migração não aplicada');
    assert.ok(!depois.tabelas.includes('clientes') && !depois.tabelas.includes('servicos'));
    assert.ok(!depois.linhas.departamentos.some((d) => d.chave === 'contabil'));
    assert.notDeepEqual(depois, antes, 'a alteração externa continua lá, intacta');

    // backup preservado: é o banco de antes, com o SHA-256 registrado no relatório
    assert.ok(existsSync(r.backup.caminho));
    assert.equal(createHash('sha256').update(readFileSync(r.backup.caminho)).digest('hex'), r.backup.sha256);
    assert.deepEqual(estado(r.backup.caminho), antes);
    assert.deepEqual(arquivos(c.backupDir), ['hub_antes_migracao_001_2026-11-04_200000.db']);
    assert.equal(relatorioGravado(r).passo, 'comparacao');
    semDadosPessoais(c, r);
  });
}

// --- Falha na transação real ---

test('outro processo escrevendo no banco: a transação real não espera, falha e nada é alterado', async () => {
  const c = cenario();
  const antes = estado(c.dbPath);
  const outro = new Database(c.dbPath);
  outro.prepare('BEGIN IMMEDIATE').run(); // segura o direito de escrita, como um processo ocupado
  let r;
  try {
    r = await migrar(c);
  } finally {
    outro.prepare('ROLLBACK').run();
    outro.close();
  }
  assert.equal(r.resultado, 'revertida', r.motivo);
  assert.equal(r.passo, 'aplicacao');
  assert.equal(r.versaoDepois, 0);
  assert.deepEqual(estado(c.dbPath), antes);
  assert.equal(relatorioGravado(r).resultado, 'revertida');
  semDadosPessoais(c, r);
});

// --- Comando de terminal (processo real, com HUB_DB_PATH apontando para o banco temporário) ---

function rodarComando(c, porta) {
  return spawnSync(process.execPath, ['src/cli/migrar.js'], {
    encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, HUB_DB_PATH: c.dbPath, HUB_HOST: '127.0.0.1', HUB_PORT: String(porta) },
  });
}
async function portaLivre() {
  const s = createServer();
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const porta = s.address().port;
  await new Promise((ok) => s.close(ok));
  return porta;
}

test('comando npm run migrar: usa o banco indicado, migra e grava backup e relatório ao lado dele', async () => {
  const c = cenario();
  const r = rodarComando(c, await portaLivre());
  assert.equal(r.stdout.split('\n')[0], `Banco: ${c.dbPath}`, 'o comando tem de usar o banco temporário, nunca data/hub.db');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Migração 001 APLICADA\./);
  assert.match(r.stdout, /Escritório escritorio-a: 3 departamentos, 4 serviços/);
  assert.equal(estado(c.dbPath).versao, 1);
  assert.equal(arquivos(c.backupDir).length, 1);
  assert.equal(arquivos(c.logDir).length, 1);
});

test('comando npm run migrar: com algo respondendo na porta do Hub, para e devolve erro', async () => {
  const c = cenario();
  const antes = estado(c.dbPath);
  const hub = createServer((req, res) => res.end('{"ok":true}'));
  await new Promise((ok) => hub.listen(0, '127.0.0.1', ok));
  let r;
  try {
    r = await new Promise((ok) => {
      // spawnSync bloquearia o servidor de teste; roda o comando sem bloquear
      import('node:child_process').then(({ execFile }) => execFile(process.execPath, ['src/cli/migrar.js'], {
        encoding: 'utf8', timeout: 60_000,
        env: { ...process.env, HUB_DB_PATH: c.dbPath, HUB_HOST: '127.0.0.1', HUB_PORT: String(hub.address().port) },
      }, (erro, stdout, stderr) => ok({ status: erro ? erro.code : 0, stdout, stderr })));
    });
  } finally {
    await new Promise((ok) => hub.close(ok));
  }
  assert.equal(r.stdout.split('\n')[0], `Banco: ${c.dbPath}`);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Migração NÃO executada\. Nada foi alterado\./);
  assert.match(r.stdout, /Feche o Hub/);
  assert.deepEqual(estado(c.dbPath), antes);
});
