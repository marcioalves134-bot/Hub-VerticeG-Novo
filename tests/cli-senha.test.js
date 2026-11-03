// Leitura da senha no terminal com teclado simulado, e o comando criar-escritorio com banco temporário.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerSenha } from '../src/cli/ler-senha.js';

const RAIZ = join(import.meta.dirname, '..');

function terminalFalso() {
  const entrada = new EventEmitter();
  Object.assign(entrada, {
    isTTY: true, bruto: false, pausado: true,
    setRawMode(v) { this.bruto = v; }, setEncoding() {}, resume() { this.pausado = false; }, pause() { this.pausado = true; },
    digitar(...pedacos) { for (const p of pedacos) this.emit('data', p); },
  });
  const saida = { texto: '', write(s) { this.texto += s; } };
  return { entrada, saida };
}

test('senha: Enter confirma e nada do que foi digitado aparece na tela', async () => {
  const { entrada, saida } = terminalFalso();
  const p = lerSenha('Senha: ', entrada, saida);
  assert.equal(entrada.bruto, true);
  entrada.digitar('s', 'e', 'g', 'r', 'e', 'd', 'o', '-', '1', '2', '\r');
  assert.equal(await p, 'segredo-12');
  assert.equal(saida.texto, 'Senha: \n');
  assert.equal(entrada.bruto, false);
  assert.equal(entrada.pausado, true);
  assert.equal(entrada.listenerCount('data'), 0);
});

test('senha: Backspace apaga o último caractere (\\b e DEL)', async () => {
  const { entrada, saida } = terminalFalso();
  const p = lerSenha('Senha: ', entrada, saida);
  entrada.digitar('abcX', '\b', 'dY', '\u007f', 'e', '\r');
  assert.equal(await p, 'abcde');
  assert.equal(saida.texto, 'Senha: \n');
});

test('senha: Backspace com campo vazio não quebra', async () => {
  const { entrada, saida } = terminalFalso();
  const p = lerSenha('Senha: ', entrada, saida);
  entrada.digitar('\b', '\b', 'a', '\r');
  assert.equal(await p, 'a');
});

test('senha: Ctrl+C cancela, devolve o terminal ao normal e não mostra nada', async () => {
  const { entrada, saida } = terminalFalso();
  const p = lerSenha('Senha: ', entrada, saida);
  entrada.digitar('meio-digit', '\u0003');
  await assert.rejects(p, /Cancelado\. Nada foi gravado\./);
  assert.equal(entrada.bruto, false);
  assert.equal(entrada.listenerCount('data'), 0);
  assert.ok(!saida.texto.includes('meio'));
});

test('senha: colada de uma vez com Enter no fim funciona', async () => {
  const { entrada, saida } = terminalFalso();
  const p = lerSenha('Senha: ', entrada, saida);
  entrada.digitar('colada-123456\r');
  assert.equal(await p, 'colada-123456');
});

test('senha: setas e teclas especiais são ignoradas', async () => {
  const { entrada, saida } = terminalFalso();
  const p = lerSenha('Senha: ', entrada, saida);
  entrada.digitar('ab', '\u001b[D', '\u001b[A', 'c', '\t', '\r');
  assert.equal(await p, 'abc');
});

test('senha: fora de um terminal de verdade é recusada', async () => {
  const { entrada, saida } = terminalFalso();
  entrada.isTTY = false;
  await assert.rejects(lerSenha('Senha: ', entrada, saida), /janela do PowerShell/);
  assert.equal(saida.texto, '');
});

test('criar-escritorio: parar antes da senha não cria banco nem cadastro', async () => {
  const pasta = mkdtempSync(join(tmpdir(), 'hub-teste-cli-'));
  const dbPath = join(pasta, 'hub.db');
  try {
    const proc = spawn(process.execPath, ['src/cli/criar-escritorio.js'], {
      cwd: RAIZ, env: { ...process.env, HUB_DB_PATH: dbPath }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let erro = '';
    proc.stderr.on('data', (d) => { erro += d; });
    // Responde cada pergunta só quando ela aparece, como uma pessoa (dados fictícios).
    // A senha não é lida porque a entrada não é um terminal de verdade.
    const respostas = [['Código do escritório', 'teste-cli'], ['Nome do escritório', 'Escritório Fictício'],
      ['Nome do administrador', 'Admin Fictício'], ['Login do administrador', 'admin']];
    let tela = '';
    proc.stdout.on('data', (d) => {
      tela += d;
      while (respostas.length && tela.includes(respostas[0][0])) {
        tela = tela.slice(tela.indexOf(respostas[0][0]) + respostas[0][0].length);
        proc.stdin.write(`${respostas.shift()[1]}\n`);
        if (!respostas.length) proc.stdin.end();
      }
    });
    const codigo = await new Promise((ok) => proc.on('close', ok));
    assert.equal(codigo, 1);
    assert.match(erro, /Não criado: Rode este comando numa janela do PowerShell/);
    assert.equal(existsSync(dbPath), false);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
