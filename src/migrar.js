// Execução controlada da migração 001 (docs/especificacao-clientes-e-modulos.md, seções 7.3 a 7.6).
// Ordem: Hub fechado → versão → saúde do banco → backup conferido → ensaio numa cópia → Hub fechado de novo →
// transação única no banco real (validada; qualquer falha desfaz tudo) → checkpoint e integrity_check → relatório.
// O relatório traz só contagens, códigos de escritório, caminhos e SHA-256 — nenhum dado de pessoa.
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { carimbo, contagens } from './backup.js';
import { aplicarMigracao001, versaoDoBanco, VERSAO_ATUAL } from './migracoes.js';

const sha256 = (arquivo) => createHash('sha256').update(readFileSync(arquivo)).digest('hex');

/**
 * Impressão digital de todo o conteúdo do banco: versão, estrutura (tabelas, índices, gatilhos) e todas as linhas
 * de todas as tabelas em ordem de rowid. Serve só para comparar; nunca vai para o relatório.
 */
function impressaoCompleta(db) {
  const h = createHash('sha256');
  h.update(`versao:${versaoDoBanco(db)}\n`);
  for (const o of db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()) {
    h.update(`${JSON.stringify(o)}\n`);
  }
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    h.update(`tabela:${name}\n`);
    for (const linha of db.prepare(`SELECT rowid AS _rowid_, * FROM "${name}" ORDER BY rowid`).iterate()) h.update(`${JSON.stringify(linha)}\n`);
  }
  return h.digest('hex');
}

class BancoMudou extends Error {}

/** true se alguma coisa responder em `url` (o Hub aberto); erro de conexão ou demora = fechado. */
export async function hubRespondendo(url, prazoMs = 2000) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(prazoMs) });
    return true;
  } catch {
    return false;
  }
}

/**
 * resultado: 'aplicada' | 'ja_aplicada' (nada alterado) | 'abortada' (parou antes de tocar no banco real) |
 * 'revertida' (a transação no banco real falhou e foi desfeita) | 'aplicada_com_alerta' (gravou, mas a conferência final falhou).
 */
export async function executarMigracao({ dbPath, backupDir, logDir, hubAberto, agora = new Date() }) {
  const nome = carimbo(agora);
  const rel = {
    migracao: '001', inicio: agora.toISOString(), fim: null, resultado: null, passo: null, motivo: null,
    banco: dbPath, versaoAntes: null, versaoDepois: null, backup: null, verificacoes: [], contagensAntes: null, contagensDepois: null, escritorios: [],
  };
  const conferido = (passo, detalhe) => rel.verificacoes.push({ passo, ok: true, detalhe });
  const parar = (resultado, passo, motivo) => { Object.assign(rel, { resultado, passo, motivo }); return rel; };
  let leitura = null, real = null, ensaioPath = null, impressaoBackup = null;

  try {
    // 1. Hub fechado
    if (await hubAberto()) return parar('abortada', 'hub_aberto', 'O Hub está aberto. Feche o Hub antes de migrar.');
    conferido('hub_fechado', 'nenhuma resposta em /saude');

    // 2. Banco e versão (nunca cria o arquivo)
    if (!existsSync(dbPath)) return parar('abortada', 'banco', 'Arquivo do banco não encontrado; nada foi criado.');
    leitura = new Database(dbPath, { readonly: true, fileMustExist: true });
    rel.versaoAntes = versaoDoBanco(leitura);
    if (rel.versaoAntes === VERSAO_ATUAL) {
      rel.versaoDepois = rel.versaoAntes;
      return parar('ja_aplicada', 'versao', 'Migração 001 já aplicada; nada foi alterado.');
    }
    if (rel.versaoAntes !== 0) return parar('abortada', 'versao', `Versão do banco inesperada (${rel.versaoAntes}); esperado 0.`);
    conferido('versao', 'banco na versão 0');

    // 3. Saúde do banco atual
    const integridade = leitura.pragma('integrity_check', { simple: true });
    const vinculos = leitura.pragma('foreign_key_check');
    if (integridade !== 'ok' || vinculos.length) {
      return parar('abortada', 'saude', `Banco atual com problema (integrity_check: ${integridade}; vínculos inconsistentes: ${vinculos.length}).`);
    }
    rel.contagensAntes = contagens(leitura);
    conferido('saude', 'integrity_check ok; foreign_key_check vazio');

    // 4. Backup conferido
    const backupPath = join(backupDir, `hub_antes_migracao_001_${nome}.db`);
    try {
      mkdirSync(backupDir, { recursive: true });
      if (existsSync(backupPath)) throw new Error('já existe um backup com este nome');
      await leitura.backup(backupPath);
      const copia = new Database(backupPath);
      let integridadeCopia, contagensCopia, versaoCopia;
      try {
        copia.pragma('journal_mode = DELETE'); // arquivo único, sem -wal/-shm
        integridadeCopia = copia.pragma('integrity_check', { simple: true });
        contagensCopia = contagens(copia);
        versaoCopia = versaoDoBanco(copia);
        impressaoBackup = impressaoCompleta(copia);
      } finally {
        copia.close();
      }
      if (integridadeCopia !== 'ok') throw new Error(`integrity_check da cópia: ${integridadeCopia}`);
      if (JSON.stringify(contagensCopia) !== JSON.stringify(rel.contagensAntes)) throw new Error('contagens da cópia diferentes do banco atual');
      if (versaoCopia !== 0) throw new Error(`versão da cópia: ${versaoCopia}`);
    } catch (e) {
      rmSync(backupPath, { force: true });
      return parar('abortada', 'backup', `Backup não confirmado (${e.message}); nada foi alterado.`);
    }
    rel.backup = { caminho: backupPath, bytes: statSync(backupPath).size, sha256: sha256(backupPath), integridade: 'ok' };
    conferido('backup', 'cópia íntegra, mesmas contagens e versão 0');

    // 5. Ensaio completo numa segunda cópia
    ensaioPath = join(backupDir, `ensaio_migracao_001_${nome}.db`);
    try {
      copyFileSync(backupPath, ensaioPath);
      const ensaio = new Database(ensaioPath);
      try {
        ensaio.pragma('foreign_keys = ON');
        aplicarMigracao001(ensaio);
      } finally {
        ensaio.close();
      }
    } catch (e) {
      return parar('abortada', 'ensaio', `O ensaio na cópia falhou (${e.message}); o banco real não foi tocado.`);
    } finally {
      rmSync(ensaioPath, { force: true });
      ensaioPath = null;
    }
    if (sha256(backupPath) !== rel.backup.sha256) return parar('abortada', 'backup', 'O arquivo de backup mudou durante o ensaio.');
    conferido('ensaio', 'migração aplicada e validada numa cópia');
    leitura.close();
    leitura = null;

    // 6. Hub fechado de novo, logo antes de aplicar
    if (await hubAberto()) return parar('abortada', 'hub_aberto', 'O Hub foi aberto durante a preparação. Feche o Hub e rode de novo; nada foi alterado.');

    // 7. Transação única e exclusiva no banco real, sem esperar outro processo. Dentro dela, antes de aplicar:
    //    o banco real tem de ser idêntico ao backup (nada pode ter mudado desde o backup). Comparar e aplicar
    //    sob o mesmo bloqueio impede qualquer gravação entre uma coisa e outra.
    real = new Database(dbPath, { fileMustExist: true, timeout: 0 });
    real.pragma('foreign_keys = ON');
    let resumo;
    try {
      resumo = real.transaction(() => {
        if (impressaoCompleta(real) !== impressaoBackup) throw new BancoMudou();
        return aplicarMigracao001(real);
      }).exclusive();
    } catch (e) {
      rel.versaoDepois = versaoDoBanco(real);
      if (e instanceof BancoMudou) {
        return parar('abortada', 'comparacao',
          'O banco mudou depois do backup (conteúdo diferente do backup). A migração não foi aplicada e o backup foi preservado; feche o Hub e rode de novo.');
      }
      return parar('revertida', 'aplicacao', `A migração no banco real falhou e foi desfeita; nada foi alterado (${e.message}).`);
    }
    conferido('comparacao', 'banco real idêntico ao backup imediatamente antes de aplicar (versão, estrutura e todas as linhas)');
    rel.contagensDepois = contagens(real);
    conferido('aplicacao', `transação concluída e validada (tabelas antigas conferidas: ${resumo.tabelasConferidas.join(', ')})`);

    // 8. Consolidação e conferência final
    real.pragma('wal_checkpoint(TRUNCATE)');
    rel.versaoDepois = versaoDoBanco(real);
    rel.escritorios = real.prepare(`SELECT t.codigo,
        (SELECT COUNT(*) FROM departamentos d WHERE d.tenant_id = t.id) AS departamentos,
        (SELECT COUNT(*) FROM servicos s WHERE s.tenant_id = t.id) AS servicos
      FROM tenants t ORDER BY t.id`).all();
    const integridadeFinal = real.pragma('integrity_check', { simple: true });
    if (integridadeFinal !== 'ok' || rel.versaoDepois !== 1) {
      return parar('aplicada_com_alerta', 'conferencia_final',
        `A migração foi gravada, mas a conferência final falhou (integrity_check: ${integridadeFinal}; versão ${rel.versaoDepois}). Avalie restaurar o backup.`);
    }
    conferido('conferencia_final', 'checkpoint feito; integrity_check ok; versão 1');
    return parar('aplicada', 'concluida', null);
  } catch (e) {
    return parar('abortada', rel.passo ?? 'inesperado', `Erro inesperado: ${e.message}`);
  } finally {
    leitura?.close();
    real?.close();
    if (ensaioPath) rmSync(ensaioPath, { force: true });
    rel.fim = new Date().toISOString();
    try {
      mkdirSync(logDir, { recursive: true });
      rel.relatorio = join(logDir, `migracao-001-${nome}.json`);
      writeFileSync(rel.relatorio, JSON.stringify(rel, null, 2));
    } catch (e) {
      rel.relatorio = null;
      rel.erroRelatorio = e.message;
    }
  }
}
