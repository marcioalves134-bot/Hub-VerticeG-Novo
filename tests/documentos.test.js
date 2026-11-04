// CPF e CNPJ. Só documentos fictícios ou vetores oficiais com letras da Receita/Serpro — nenhum documento real.
// CPFs e CNPJ numérico: calculados à mão (ver comentários). CNPJ alfanumérico: exemplos oficiais (Receita, pergunta 14; pacote Serpro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularDvCnpj, cnpjValido, cpfValido, formatarCnpj, formatarCpf, prepararCnpj, prepararCpf } from '../src/documentos.js';

// CPFs fictícios calculados à mão:
// 280012389 → soma 162, resto 8 → DV1 3; soma 201, resto 3 → DV2 8.
// 305112468 → soma 143, resto 0 → DV1 0 (regra do resto < 2); soma 173, resto 8 → DV2 3.
// 846013592 → soma 236, resto 5 → DV1 6; soma 286, resto 0 → DV2 0 (regra do resto < 2).
const CPFS_VALIDOS = ['28001238938', '30511246803', '84601359260'];

// CNPJ numérico fictício calculado à mão: 987654320001 → soma 222, resto 2 → DV1 9; soma 245, resto 3 → DV2 8.
const CNPJ_NUMERICO = '98765432000198';
// Vetores oficiais com letras (Receita pergunta 14 e Serpro TesterCalculo/TesterValidacao/test.ts).
const CNPJS_OFICIAIS = ['12ABC34501DE35', '1345C3A5000106', 'R55231B3000757', 'ABCDEFGHIJKL80'];

// --- CPF ---

test('CPF: fictícios calculados à mão são válidos, inclusive os casos de resto 0', () => {
  for (const cpf of CPFS_VALIDOS) assert.equal(cpfValido(cpf), true, cpf);
});

test('CPF: dígito verificador errado é inválido', () => {
  for (const cpf of ['28001238939', '28001238948', '28001238930', '30511246813', '84601359261']) assert.equal(cpfValido(cpf), false, cpf);
});

test('CPF: todos os dígitos iguais são inválidos (111.111.111-11 passaria no cálculo)', () => {
  for (const d of '0123456789') assert.equal(cpfValido(d.repeat(11)), false, d.repeat(11));
});

test('CPF: tamanho, letras, máscara e espaço interno são inválidos sem preparação', () => {
  for (const cpf of ['', '2800123893', '280012389388', '2800123893A', '280.012.389-38', '280012389 38', ' 28001238938', null, undefined, 28001238938, ['28001238938']]) {
    assert.equal(cpfValido(cpf), false, String(cpf));
  }
});

test('CPF: preparação remove máscara e espaços das pontas; espaço interno continua e invalida', () => {
  assert.equal(prepararCpf('280.012.389-38'), '28001238938');
  assert.equal(prepararCpf('  280.012.389-38\t'), '28001238938');
  assert.equal(prepararCpf('28001238938'), '28001238938');
  assert.equal(prepararCpf('280 012 389 38'), '280 012 389 38');
  assert.equal(cpfValido(prepararCpf(' 280.012.389-38 ')), true);
  assert.equal(cpfValido(prepararCpf('280.012 .389-38')), false);
  assert.equal(cpfValido(prepararCpf('280/012/389-38')), false, 'barra não é máscara de CPF');
  for (const entrada of [null, undefined, 123, {}]) assert.equal(prepararCpf(entrada), '');
});

// --- CNPJ: algoritmo oficial ---

test('CNPJ: exemplo oficial 12.ABC.345/01DE tem DV 35, conforme o cálculo publicado (somas 459 e 424)', () => {
  assert.equal(calcularDvCnpj('12ABC34501DE'), '35');
});

test('CNPJ: DVs oficiais do pacote Serpro (inclui DV1 = 0 pela regra do resto < 2)', () => {
  assert.equal(calcularDvCnpj('1345C3A50001'), '06');
  assert.equal(calcularDvCnpj('R55231B30007'), '57');
});

test('CNPJ: alfanuméricos oficiais e numérico fictício são válidos', () => {
  for (const cnpj of [...CNPJS_OFICIAIS, CNPJ_NUMERICO]) assert.equal(cnpjValido(cnpj), true, cnpj);
  assert.equal(calcularDvCnpj(CNPJ_NUMERICO.slice(0, 12)), '98');
});

test('CNPJ: inválidos oficiais (DV errado, letra no DV, zeros)', () => {
  for (const cnpj of ['R55231B3000700', 'ABCDEFGHIJKL81', '12ABC34501DE36', '987654320001P8', '9876543200019L', '00000000000000', '98765432000189']) {
    assert.equal(cnpjValido(cnpj), false, cnpj);
  }
});

test('CNPJ: todos os caracteres iguais são inválidos (só os zeros passariam no cálculo e são barrados)', () => {
  for (const d of '0123456789') assert.equal(cnpjValido(d.repeat(14)), false, d.repeat(14));
});

test('CNPJ: validação é estrita — minúscula, máscara, espaço, tamanho e caractere fora de A–Z/0–9 são inválidos', () => {
  const invalidos = ['', '1345c3A5000106', '12.ABC.345/01DE-35', ' 12ABC34501DE35', '12ABC 34501DE35', '9876543200019', '987654320001981',
    '$0123456789ABC', '0123456?789ABC', '0123456789ABC#', '12ÇBC34501DE35', '12ABC34501DE3 ', null, undefined, 98765432000198];
  for (const cnpj of invalidos) assert.equal(cnpjValido(cnpj), false, String(cnpj));
});

test('CNPJ: base inválida para o cálculo lança erro', () => {
  for (const base of ['', '12abc34501de', '12ABC34501D', '12ABC34501DE3', '000000000000', '12ABC345/1DE', '12ABC 4501DE', null, 123]) {
    assert.throws(() => calcularDvCnpj(base), /Base de CNPJ inválida/, String(base));
  }
});

// --- CNPJ: preparação (decisões aprovadas: máscara, minúsculas → maiúsculas, espaços só nas pontas) ---

test('CNPJ: preparação remove máscara, converte minúsculas e tira espaços das pontas', () => {
  assert.equal(prepararCnpj('12.ABC.345/01DE-35'), '12ABC34501DE35');
  assert.equal(prepararCnpj('  12.abc.345/01de-35 \n'), '12ABC34501DE35');
  assert.equal(prepararCnpj('98.765.432/0001-98'), CNPJ_NUMERICO);
  assert.equal(prepararCnpj('98.7654.32/000198'), CNPJ_NUMERICO, 'máscara em qualquer posição é removida, como no oficial');
  for (const entrada of [null, undefined, 123, {}]) assert.equal(prepararCnpj(entrada), '');
});

test('CNPJ: fluxo preparar + validar aceita o que o usuário digita com minúsculas e máscara; espaço interno continua inválido', () => {
  for (const entrada of ['12.abc.345/01de-35', ' 1345c3a5000106 ', 'r5.523.1b3/0007-57', '98.765.432/0001-98']) {
    assert.equal(cnpjValido(prepararCnpj(entrada)), true, entrada);
  }
  assert.equal(prepararCnpj('12.abc.345/01de-35'), '12ABC34501DE35', 'gravado sempre em maiúsculas');
  for (const entrada of ['12.ABC.345 /01DE-35', '12 ABC34501DE35', '12.ABC.345/01DE-3 5', '12.ABC.345/01DE_35', '12.ABC.345\\01DE-35']) {
    assert.equal(cnpjValido(prepararCnpj(entrada)), false, entrada);
  }
});

// --- Máscaras de exibição ---

test('máscaras: CPF e CNPJ (numérico e alfanumérico) formatados; outro valor volta sem alteração', () => {
  assert.equal(formatarCpf('28001238938'), '280.012.389-38');
  assert.equal(formatarCnpj('12ABC34501DE35'), '12.ABC.345/01DE-35');
  assert.equal(formatarCnpj(CNPJ_NUMERICO), '98.765.432/0001-98');
  for (const valor of ['', '2800123893', '12ABC34501DE3', '12ABC34501DEAB', null]) {
    assert.equal(formatarCpf(valor), valor);
    assert.equal(formatarCnpj(valor), valor);
  }
});
