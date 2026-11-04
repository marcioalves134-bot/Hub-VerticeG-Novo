// CPF e CNPJ (docs/especificacao-clientes-e-modulos.md, seção 5.2).
// A preparação (o que o usuário digitou) é separada da validação (regra oficial):
// primeiro prepararCpf/prepararCnpj, depois cpfValido/cnpjValido sobre o valor preparado.

// --- CPF ---------------------------------------------------------------

/** Remove espaços das pontas e a máscara (. e -). Não valida; espaço interno continua e invalida. */
export function prepararCpf(entrada) {
  return typeof entrada === 'string' ? entrada.trim().replace(/[.-]/g, '') : '';
}

function digitoCpf(digitos, pesoInicial) {
  let soma = 0;
  for (let i = 0; i < digitos.length; i++) soma += Number(digitos[i]) * (pesoInicial - i);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** CPF já preparado: 11 dígitos, não todos iguais, com os dois dígitos verificadores (módulo 11). */
export function cpfValido(cpf) {
  if (typeof cpf !== 'string' || !/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv1 = digitoCpf(cpf.slice(0, 9), 10);
  const dv2 = digitoCpf(cpf.slice(0, 9) + dv1, 11);
  return cpf.slice(9) === `${dv1}${dv2}`;
}

// --- CNPJ (numérico e alfanumérico) ------------------------------------
// Algoritmo oficial da Receita Federal / Serpro: valor de cada caractere = código ASCII − 48,
// pesos de 2 a 9 da direita para a esquerda, módulo 11 (resto 0 ou 1 → dígito 0; senão 11 − resto).
// O CNPJ só numérico passa pelo mesmo cálculo.

const PESOS_CNPJ = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const VALOR_BASE = '0'.charCodeAt(0);

/** Remove espaços das pontas e a máscara (. / -) e converte letras para maiúsculas. Não valida. */
export function prepararCnpj(entrada) {
  return typeof entrada === 'string' ? entrada.trim().replace(/[./-]/g, '').toUpperCase() : '';
}

function digitoCnpj(caracteres) {
  let soma = 0;
  for (let i = 0; i < caracteres.length; i++) {
    soma += (caracteres.charCodeAt(i) - VALOR_BASE) * PESOS_CNPJ[PESOS_CNPJ.length - caracteres.length + i];
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

/** Dígitos verificadores dos 12 primeiros caracteres (já preparados). Base inválida lança erro. */
export function calcularDvCnpj(base) {
  if (typeof base !== 'string' || !/^[A-Z\d]{12}$/.test(base) || base === '000000000000') {
    throw new Error('Base de CNPJ inválida para o cálculo do dígito verificador.');
  }
  const dv1 = digitoCnpj(base);
  return `${dv1}${digitoCnpj(base + dv1)}`;
}

/** CNPJ já preparado: 12 caracteres A–Z/0–9 + 2 dígitos, diferente de zeros, com os dígitos verificadores oficiais. */
export function cnpjValido(cnpj) {
  if (typeof cnpj !== 'string' || !/^[A-Z\d]{12}\d{2}$/.test(cnpj) || cnpj === '00000000000000') return false;
  return calcularDvCnpj(cnpj.slice(0, 12)) === cnpj.slice(12);
}

// --- Máscaras para exibição --------------------------------------------

/** 000.000.000-00 para um CPF preparado; outro valor volta sem alteração. */
export function formatarCpf(cpf) {
  return typeof cpf === 'string' && /^\d{11}$/.test(cpf) ? cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : cpf;
}

/** XX.XXX.XXX/XXXX-00 para um CNPJ preparado (numérico ou alfanumérico); outro valor volta sem alteração. */
export function formatarCnpj(cnpj) {
  return typeof cnpj === 'string' && /^[A-Z\d]{12}\d{2}$/.test(cnpj)
    ? cnpj.replace(/^(.{2})(.{3})(.{3})(.{4})(\d{2})$/, '$1.$2.$3/$4-$5') : cnpj;
}
