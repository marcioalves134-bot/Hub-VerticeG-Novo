// Testes do reconhecimento de rotas com identificador (sem servidor e sem banco).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { casarRota } from '../src/app.js';

const MODELO = 'PUT /api/usuarios/:id';

test('rota com id: reconhece e devolve o id como número', () => {
  assert.deepEqual(casarRota('PUT /api/usuarios/7', MODELO), { id: 7 });
  assert.deepEqual(casarRota('PUT /api/usuarios/123456', MODELO), { id: 123456 });
  assert.deepEqual(casarRota('POST /api/usuarios/9/senha', 'POST /api/usuarios/:id/senha'), { id: 9 });
});

test('rota sem parâmetro: casa só com o texto idêntico', () => {
  assert.deepEqual(casarRota('GET /api/usuarios', 'GET /api/usuarios'), {});
  assert.equal(casarRota('GET /api/usuarios', 'POST /api/usuarios'), null);
});

test('rota com id: recusa método, caminho ou tamanho diferentes', () => {
  assert.equal(casarRota('GET /api/usuarios/7', MODELO), null);
  assert.equal(casarRota('PUT /api/departamentos/7', MODELO), null);
  assert.equal(casarRota('PUT /api/usuarios', MODELO), null);
  assert.equal(casarRota('PUT /api/usuarios/7/', MODELO), null);
  assert.equal(casarRota('PUT /api/usuarios/7/senha', MODELO), null);
  assert.equal(casarRota('POST /api/usuarios/9/outra', 'POST /api/usuarios/:id/senha'), null);
});

test('rota com id: recusa id que não é inteiro positivo', () => {
  for (const id of ['', '0', '007', '-1', '1.5', '1e3', 'abc', '7a', ' 7', '%37', '99999999999999999999']) {
    assert.equal(casarRota(`PUT /api/usuarios/${id}`, MODELO), null, `id "${id}" deveria ser recusado`);
  }
});

test('rota com chave de departamento: reconhece chave válida, sozinha ou com id', () => {
  assert.deepEqual(casarRota('GET /api/dep/pessoal/funcionarios', 'GET /api/dep/:chave/funcionarios'), { chave: 'pessoal' });
  assert.deepEqual(casarRota('GET /api/dep/fiscal', 'GET /api/dep/:chave'), { chave: 'fiscal' });
  assert.deepEqual(casarRota('PUT /api/dep/dp_2/itens/7', 'PUT /api/dep/:chave/itens/:id'), { chave: 'dp_2', id: 7 });
  assert.deepEqual(casarRota('GET /api/dep/a-b/x', 'GET /api/dep/:chave/x'), { chave: 'a-b' });
  assert.deepEqual(casarRota(`GET /api/dep/${'a'.repeat(40)}/x`, 'GET /api/dep/:chave/x'), { chave: 'a'.repeat(40) });
});

test('rota com chave de departamento: recusa chave inválida', () => {
  const modelo = 'GET /api/dep/:chave/funcionarios';
  for (const chave of ['', 'PESSOAL', 'Pessoal', 'pes.soal', 'pes soal', '%70essoal', 'pessoal%2Ffiscal', 'açaí', 'a'.repeat(41), '..']) {
    assert.equal(casarRota(`GET /api/dep/${chave}/funcionarios`, modelo), null, `chave "${chave}" deveria ser recusada`);
  }
  assert.equal(casarRota('GET /api/dep/pessoal/outra', modelo), null);
  assert.equal(casarRota('GET /api/dep/pessoal/funcionarios/1', modelo), null);
});

test('rota com id continua só aceitando número (chave não vale como id)', () => {
  assert.equal(casarRota('PUT /api/usuarios/pessoal', 'PUT /api/usuarios/:id'), null);
  assert.equal(casarRota('PUT /api/dep/pessoal/itens/abc', 'PUT /api/dep/:chave/itens/:id'), null);
});
