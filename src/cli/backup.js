// Backup do banco do Hub para o servidor (rodado pela tarefa agendada ou à mão: npm run backup).
import { executarBackup } from '../backup.js';
import { BACKUP_DESTINO, BACKUP_FILA, BACKUP_LOG, BACKUP_TRAVA, DB_PATH } from '../config.js';

if (!BACKUP_DESTINO) {
  console.error('Configure HUB_BACKUP_DESTINO no arquivo .env (pasta do servidor).');
  process.exit(1);
}

const r = await executarBackup({ dbPath: DB_PATH, destino: BACKUP_DESTINO, filaDir: BACKUP_FILA, logPath: BACKUP_LOG, travaPath: BACKUP_TRAVA });

const textos = {
  ok: `Backup OK: ${r.backup?.nome} enviado ao servidor${r.enviados?.length > 1 ? ` (com ${r.enviados.length - 1} da fila)` : ''}.`,
  pendente: `Servidor inacessível: backup ${r.backup?.nome} guardado na fila local (${r.pendentes} pendente(s)).`,
  falha: `Backup FALHOU: ${r.erro}`,
  ignorado: 'Outra execução do backup está em andamento; nada feito.',
};
console.log(textos[r.resultado]);
console.log(`Registro: ${BACKUP_LOG}`);
// Encerra mesmo que uma operação de rede presa ainda esteja pendurada no sistema.
process.exit(r.resultado === 'ok' || r.resultado === 'ignorado' ? 0 : 1);
