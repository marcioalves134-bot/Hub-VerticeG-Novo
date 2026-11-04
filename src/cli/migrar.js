// Migração 001 do banco do Hub (npm run migrar). Só rodar com o Hub fechado e com autorização expressa.
// Roteiro completo: docs/especificacao-clientes-e-modulos.md, seção 7.5.
import { dirname, join } from 'node:path';
import { DB_PATH, HOST, PORTA } from '../config.js';
import { executarMigracao, hubRespondendo } from '../migrar.js';

console.log(`Banco: ${DB_PATH}\n`);
const r = await executarMigracao({
  dbPath: DB_PATH,
  backupDir: join(dirname(DB_PATH), 'backups-migracao'),
  logDir: join(dirname(DB_PATH), 'logs'),
  hubAberto: () => hubRespondendo(`http://${HOST}:${PORTA}/saude`),
});

const titulos = {
  aplicada: 'Migração 001 APLICADA.',
  ja_aplicada: 'Migração 001 já estava aplicada. Nada foi alterado.',
  abortada: 'Migração NÃO executada. Nada foi alterado.',
  revertida: 'Migração FALHOU e foi desfeita. Nada foi alterado.',
  aplicada_com_alerta: 'ATENÇÃO: migração gravada, mas a conferência final falhou.',
};
console.log(titulos[r.resultado] ?? r.resultado);
if (r.motivo) console.log(`Motivo: ${r.motivo}`);
console.log(`Versão do banco: ${r.versaoAntes ?? '?'} → ${r.versaoDepois ?? r.versaoAntes ?? '?'}`);
if (r.backup) console.log(`Backup: ${r.backup.caminho} (${r.backup.bytes} bytes, SHA-256 ${r.backup.sha256})`);
for (const e of r.escritorios) console.log(`Escritório ${e.codigo}: ${e.departamentos} departamentos, ${e.servicos} serviços`);
console.log(`Relatório: ${r.relatorio ?? `não gravado (${r.erroRelatorio})`}`);
process.exit(r.resultado === 'aplicada' || r.resultado === 'ja_aplicada' ? 0 : 1);
