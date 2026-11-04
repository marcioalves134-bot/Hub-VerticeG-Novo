import { createServer } from 'node:http';
import { BACKUP_LOG, DB_PATH, HOST, PORTA, SESSAO_HORAS } from './config.js';
import { abrirBanco } from './db.js';
import { avisoVersaoBanco, criarApp } from './app.js';

const db = abrirBanco(DB_PATH);
const app = criarApp(db, { sessaoHoras: SESSAO_HORAS, backupLogPath: BACKUP_LOG });
const servidor = createServer(app);

servidor.listen(PORTA, HOST, () => {
  console.log(`Hub Vértice G em http://${HOST}:${PORTA}`);
  console.log(`Banco: ${DB_PATH}`);
  if (!db.prepare('SELECT 1 FROM tenants LIMIT 1').get()) {
    console.log('Nenhum escritório cadastrado ainda. Rode: npm run criar-escritorio');
  }
  const aviso = avisoVersaoBanco(app.versaoBanco);
  if (aviso) console.warn(`\n${aviso}\n`);
});

for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => servidor.close(() => { db.close(); process.exit(0); }));
}
