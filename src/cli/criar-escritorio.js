// Cria um escritório (tenant) e o primeiro administrador, perguntando os dados no terminal.
// O banco só é aberto depois de todas as respostas: cancelar no meio não grava nada.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { DB_PATH } from '../config.js';
import { abrirBanco } from '../db.js';
import { validarSenha } from '../auth.js';
import { criarEscritorio } from '../escritorios.js';
import { lerSenha } from './ler-senha.js';

const rl = createInterface({ input: stdin, output: stdout });
rl.on('SIGINT', () => {
  rl.close();
  console.error('\nCancelado. Nada foi gravado.');
  process.exit(130);
});

try {
  console.log(`Banco: ${DB_PATH}\n`);
  const codigo = (await rl.question('Código do escritório (usado no login, ex.: verticeg): ')).trim();
  const nome = (await rl.question('Nome do escritório: ')).trim();
  const adminNome = (await rl.question('Nome do administrador: ')).trim();
  const login = (await rl.question('Login do administrador: ')).trim();
  rl.close(); // libera o teclado para a leitura da senha

  const senha = await lerSenha('Senha (mín. 10 caracteres, não aparece na tela): ');
  validarSenha(senha);
  if (senha !== await lerSenha('Repita a senha: ')) throw new Error('As senhas não conferem.');

  const db = abrirBanco(DB_PATH);
  try {
    criarEscritorio(db, { codigo, nome, admin: { nome: adminNome, login, senha } });
  } finally {
    db.close();
  }
  console.log(`\nEscritório "${nome}" criado. Entre com: escritório "${codigo}", usuário "${login}".`);
} catch (e) {
  console.error(`\nNão criado: ${e.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
