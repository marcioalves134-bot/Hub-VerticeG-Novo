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
