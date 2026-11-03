import { stdin, stdout } from 'node:process';

/**
 * Lê uma senha no terminal sem mostrar nada do que é digitado (modo bruto do terminal).
 * Enter confirma, Backspace apaga, Ctrl+C cancela; setas e outras teclas especiais são ignoradas.
 */
export function lerSenha(texto, entrada = stdin, saida = stdout) {
  if (!entrada.isTTY) return Promise.reject(new Error('Rode este comando numa janela do PowerShell.'));
  return new Promise((ok, falha) => {
    let senha = '';
    const fim = () => {
      entrada.off('data', tecla);
      entrada.setRawMode(false);
      entrada.pause();
      saida.write('\n');
    };
    const tecla = (teclas) => {
      if (teclas.startsWith('\u001b')) return; // setas, F1… chegam como sequência de escape
      for (const c of teclas) {
        if (c === '\r' || c === '\n') { fim(); return ok(senha); }
        if (c === '\u0003') { fim(); return falha(new Error('Cancelado. Nada foi gravado.')); }
        if (c === '\b' || c === '\u007f') senha = senha.slice(0, -1);
        else if (c >= ' ') senha += c;
      }
    };
    saida.write(texto);
    entrada.setEncoding('utf8');
    entrada.setRawMode(true);
    entrada.resume();
    entrada.on('data', tecla);
  });
}
