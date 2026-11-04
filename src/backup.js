// Backup automático do banco do Hub.
// 1. Cópia consistente pelo backup online do SQLite (original aberto só para leitura), conferida
//    com integrity_check, vira arquivo único e entra na fila local com o SHA-256 num .json.
// 2. Tudo o que está na fila vai para o servidor: envio como .parcial, releitura, SHA-256, nome final.
//    Só sai da fila depois do envio confirmado; servidor fora do ar = fica para a próxima execução.
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { access, appendFile, copyFile, mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const FOLGA_BYTES = 100 * 1024 * 1024;
const PRAZO_REDE_MS = 10_000;
const TRAVA_VENCIDA_MS = 30 * 60_000;
const FILA_ATRASADA_MS = 24 * 3600_000;
const SEM_SUCESSO_MS = 26 * 3600_000;
const NOME = /^hub_\d{4}-\d{2}-\d{2}_\d{6}$/;

export class FalhaBackup extends Error {
  constructor(motivo, mensagem) {
    super(mensagem);
    this.motivo = motivo;
  }
}

/** AAAA-MM-DD_HHMMSS no horário de Brasília. */
export function carimbo(agora) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}${p.second}`;
}

function sha256(arquivo) {
  return new Promise((ok, falha) => {
    const h = createHash('sha256');
    createReadStream(arquivo).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', falha);
  });
}

// Pasta de rede desconectada pode demorar muito para responder: não deixa a rotina presa.
function comPrazo(promessa, ms, falha) {
  let relogio;
  return Promise.race([promessa, new Promise((_, rejeita) => { relogio = setTimeout(() => rejeita(falha), ms); })])
    .finally(() => clearTimeout(relogio));
}

export const contagens = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all().map(({ name }) => [name, db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n]));

async function espacoLivrePadrao(pasta) {
  const s = await statfs(pasta);
  return s.bavail * s.bsize;
}

/** Aviso na tela do Windows (msg.exe). Falha do aviso não derruba o backup. */
export function avisarWindows(texto) {
  if (process.platform !== 'win32') return;
  const msg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'msg.exe');
  spawn(msg, [process.env.USERNAME || '*', texto], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
}

async function pegarTrava(travaPath, agora) {
  await mkdir(dirname(travaPath), { recursive: true });
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const h = await open(travaPath, 'wx');
      await h.writeFile(String(process.pid));
      await h.close();
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    // Trava esquecida por execução que caiu (queda de energia etc.) deixa de valer depois de 30 minutos.
    const s = await stat(travaPath).catch(() => null);
    if (s && agora.getTime() - s.mtimeMs < TRAVA_VENCIDA_MS) return false;
    await rm(travaPath, { force: true });
  }
  return false;
}

/** Gera a cópia conferida na fila: <nome>.db + <nome>.json. Nunca escreve no banco original. */
async function gerarCopia(dbPath, filaDir, nome, agora) {
  await mkdir(filaDir, { recursive: true });
  for (const n of await readdir(filaDir)) if (/^hub_.*\.db\.gerando$/.test(n)) await rm(join(filaDir, n), { force: true });
  const temp = join(filaDir, `${nome}.db.gerando`);

  let origem;
  try {
    origem = new Database(dbPath, { readonly: true, fileMustExist: true });
    origem.pragma('schema_version');
    await origem.backup(temp);
  } catch (e) {
    await rm(temp, { force: true });
    throw new FalhaBackup('banco_invalido', `Não foi possível copiar o banco: ${e.message}`);
  } finally {
    origem?.close();
  }

  let integridade;
  let linhas;
  const copia = new Database(temp);
  try {
    copia.pragma('journal_mode = DELETE'); // arquivo único, sem -wal/-shm
    integridade = copia.pragma('integrity_check', { simple: true });
    linhas = contagens(copia);
  } catch (e) {
    integridade = e.message;
  } finally {
    copia.close();
  }
  if (integridade !== 'ok') {
    await rm(temp, { force: true });
    throw new FalhaBackup('banco_invalido', `A cópia do banco não passou no integrity_check: ${integridade}`);
  }

  const bytes = (await stat(temp)).size;
  const meta = { nome, criadoEm: agora.toISOString(), bytes, sha256: await sha256(temp), integridade, linhas };
  await writeFile(join(filaDir, `${nome}.json`), JSON.stringify(meta, null, 2));
  await rename(temp, join(filaDir, `${nome}.db`));
  return meta;
}

async function listarFila(filaDir) {
  if (!existsSync(filaDir)) return [];
  const nomes = (await readdir(filaDir)).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5))
    .filter((n) => NOME.test(n) && existsSync(join(filaDir, `${n}.db`))).sort();
  return Promise.all(nomes.map(async (n) => JSON.parse(await readFile(join(filaDir, `${n}.json`), 'utf8'))));
}

/** Envia um arquivo como .parcial, confere o SHA-256 relendo do destino e só então dá o nome final. */
async function enviarArquivo(origem, final, shaEsperado, copiar) {
  if (existsSync(final)) {
    if ((await sha256(final)) === shaEsperado) return;
    throw new FalhaBackup('conflito', `Já existe ${final} no servidor com conteúdo diferente; nada foi sobrescrito.`);
  }
  const parcial = `${final}.parcial`;
  try {
    await copiar(origem, parcial);
    if ((await sha256(parcial)) !== shaEsperado) throw new FalhaBackup('sha_divergente', 'O arquivo copiado para o servidor ficou diferente do original (SHA-256).');
    await rename(parcial, final);
  } catch (e) {
    await rm(parcial, { force: true }).catch(() => {});
    if (e instanceof FalhaBackup) throw e;
    if (e.code === 'ENOSPC') throw new FalhaBackup('sem_espaco', 'Sem espaço no servidor durante a cópia.');
    throw new FalhaBackup('falha_envio', `Falha ao copiar para o servidor: ${e.message}`);
  }
}

async function enviarFila({ fila, filaDir, destino, copiar, espacoLivre, folgaBytes, prazoMs }) {
  const enviados = [];
  if (!fila.length) return enviados;
  await comPrazo(access(destino), prazoMs, new FalhaBackup('destino_inacessivel', `Servidor inacessível: ${destino}`))
    .catch((e) => { throw e instanceof FalhaBackup ? e : new FalhaBackup('destino_inacessivel', `Servidor inacessível: ${destino}`); });

  for (const meta of fila) {
    const pasta = join(destino, meta.nome.slice(4, 11)); // AAAA-MM
    await mkdir(pasta, { recursive: true });
    // Sobras de envio interrompido (só arquivos deste backup).
    for (const n of await readdir(pasta)) if (/^hub_.*\.(db|json)\.parcial$/.test(n)) await rm(join(pasta, n), { force: true });

    const livre = await espacoLivre(pasta);
    if (livre < meta.bytes + folgaBytes) {
      throw new FalhaBackup('sem_espaco', `Pouco espaço no servidor: ${Math.round(livre / 1024 / 1024)} MB livres.`);
    }
    const dbFila = join(filaDir, `${meta.nome}.db`);
    const jsonFila = join(filaDir, `${meta.nome}.json`);
    await enviarArquivo(dbFila, join(pasta, `${meta.nome}.db`), meta.sha256, copiar);
    await enviarArquivo(jsonFila, join(pasta, `${meta.nome}.json`), await sha256(jsonFila), copiar);
    await rm(dbFila);
    await rm(jsonFila);
    enviados.push(meta.nome);
  }
  return enviados;
}

/** Relê do servidor o backup mais recente e confere SHA-256 e integrity_check numa cópia local temporária. */
export async function verificarUltimoNoServidor({ destino, tempDir }) {
  const meses = (await readdir(destino)).filter((n) => /^\d{4}-\d{2}$/.test(n)).sort().reverse();
  for (const mes of meses) {
    const nomes = (await readdir(join(destino, mes))).filter((n) => /^hub_.*\.json$/.test(n)).sort().reverse();
    for (const n of nomes) {
      const nome = n.slice(0, -5);
      const dbServidor = join(destino, mes, `${nome}.db`);
      if (!existsSync(dbServidor)) continue;
      const meta = JSON.parse(await readFile(join(destino, mes, n), 'utf8'));
      await mkdir(tempDir, { recursive: true });
      const local = join(tempDir, `verificacao-${nome}.db`);
      try {
        await copyFile(dbServidor, local);
        if ((await sha256(local)) !== meta.sha256) return { nome, ok: false, erro: 'SHA-256 diferente do registrado' };
        const db = new Database(local, { readonly: true, fileMustExist: true });
        try {
          const integridade = db.pragma('integrity_check', { simple: true });
          return { nome, ok: integridade === 'ok', ...(integridade === 'ok' ? {} : { erro: `integrity_check: ${integridade}` }) };
        } finally {
          db.close();
        }
      } finally {
        await rm(local, { force: true });
      }
    }
  }
  return { ok: false, erro: 'Nenhum backup encontrado no servidor.' };
}

async function gravarLog(logPath, registro) {
  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${JSON.stringify(registro)}\n`);
}

const ehDomingo = (agora) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(agora) === 'Sun';

/**
 * Uma execução completa: gera a cópia, envia a fila e registra no log.
 * resultado: 'ok' (tudo no servidor) | 'pendente' (servidor fora; cópia guardada na fila) | 'falha' | 'ignorado' (outra execução em andamento)
 */
export async function executarBackup({
  dbPath, destino, filaDir, logPath, travaPath, agora = new Date(), avisar = avisarWindows,
  copiar = copyFile, espacoLivre = espacoLivrePadrao, folgaBytes = FOLGA_BYTES, prazoMs = PRAZO_REDE_MS,
  verificarServidor = ehDomingo(agora),
}) {
  const inicio = Date.now();
  const registro = { em: agora.toISOString(), resultado: null };

  if (!(await pegarTrava(travaPath, agora))) {
    Object.assign(registro, { resultado: 'ignorado', erro: 'Outra execução do backup está em andamento.' });
    await gravarLog(logPath, registro);
    return registro;
  }

  try {
    const meta = await gerarCopia(dbPath, filaDir, `hub_${carimbo(agora)}`, agora);
    registro.backup = { nome: meta.nome, bytes: meta.bytes, sha256: meta.sha256 };

    let fila = await listarFila(filaDir);
    try {
      registro.enviados = await enviarFila({ fila, filaDir, destino, copiar, espacoLivre, folgaBytes, prazoMs });
      registro.resultado = 'ok';
      if (verificarServidor) {
        registro.verificacaoSemanal = await verificarUltimoNoServidor({ destino, tempDir: join(filaDir, '..', 'verificacao') });
        if (!registro.verificacaoSemanal.ok) {
          registro.resultado = 'falha';
          registro.motivo = 'verificacao_semanal';
          registro.erro = `Conferência semanal do backup no servidor falhou: ${registro.verificacaoSemanal.erro}`;
        }
      }
    } catch (e) {
      if (!(e instanceof FalhaBackup)) throw e;
      registro.resultado = e.motivo === 'destino_inacessivel' ? 'pendente' : 'falha';
      registro.motivo = e.motivo;
      registro.erro = e.message;
    }

    fila = await listarFila(filaDir);
    registro.pendentes = fila.length;
    const maisAntigo = fila.length ? Math.min(...fila.map((m) => Date.parse(m.criadoEm))) : null;
    if (registro.resultado === 'pendente' && maisAntigo !== null && agora.getTime() - maisAntigo > FILA_ATRASADA_MS) {
      registro.alerta = true;
      avisar(`Hub Vértice G: há backup sem enviar ao servidor há mais de 24 horas (${registro.pendentes} na fila). Verifique a rede/VPN.`);
    }
  } catch (e) {
    registro.resultado = 'falha';
    registro.motivo = e instanceof FalhaBackup ? e.motivo : 'erro_inesperado';
    registro.erro = e.message;
    registro.pendentes = (await listarFila(filaDir).catch(() => [])).length;
  } finally {
    registro.duracaoMs = Date.now() - inicio;
    await rm(travaPath, { force: true });
  }

  if (registro.resultado === 'falha') {
    registro.alerta = true;
    avisar(`Hub Vértice G: o backup FALHOU. ${registro.erro} Detalhes em data\\logs\\backup.log.`);
  }
  await gravarLog(logPath, registro);
  return registro;
}

/** Situação para o painel: último resultado e se está há mais de 26 horas sem backup no servidor. */
export function lerStatusBackup(logPath, agora = new Date()) {
  if (!logPath || !existsSync(logPath)) return { registrado: false, atrasado: true };
  const linhas = readFileSync(logPath, 'utf8').trim().split('\n').slice(-500).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const execucoes = linhas.filter((r) => r.resultado !== 'ignorado');
  const ultimo = execucoes.at(-1) || null;
  const ultimoOk = [...execucoes].reverse().find((r) => r.resultado === 'ok') || null;
  return {
    registrado: Boolean(ultimo),
    ultimo: ultimo && { em: ultimo.em, resultado: ultimo.resultado, erro: ultimo.erro || null, pendentes: ultimo.pendentes ?? 0 },
    ultimoOkEm: ultimoOk?.em || null,
    atrasado: !ultimoOk || agora.getTime() - Date.parse(ultimoOk.em) > SEM_SUCESSO_MS,
  };
}
