// Encerrar todas as sessões de um usuário. Banco em memória próprio, dados fictícios.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { abrirBanco } from '../src/db.js';
import { criarSessao, encerrarSessoesDoUsuario, usuarioDaSessao } from '../src/auth.js';
import { criarEscritorio, criarUsuario } from '../src/escritorios.js';

const SENHA = 'senha-de-teste-123';
let db, adminA, fulano, adminB;

beforeEach(() => {
  db = abrirBanco(':memory:');
  const a = criarEscritorio(db, { codigo: 'escritorio-a', nome: 'Escritório A (fictício)', admin: { nome: 'Admin A', login: 'admin', senha: SENHA } });
  const b = criarEscritorio(db, { codigo: 'escritorio-b', nome: 'Escritório B (fictício)', admin: { nome: 'Admin B', login: 'admin', senha: SENHA } });
  const buscar = db.prepare('SELECT * FROM usuarios WHERE id = ?');
  adminA = buscar.get(a.usuarioId);
  adminB = buscar.get(b.usuarioId);
  fulano = buscar.get(criarUsuario(db, adminA, { nome: 'Fulano A', login: 'fulano', senha: SENHA }));
});

afterEach(() => db.close());

test('encerra todas as sessões do usuário e só as dele', () => {
  const t1 = criarSessao(db, fulano, 10);
  const t2 = criarSessao(db, fulano, 10);
  const tAdminA = criarSessao(db, adminA, 10);
  const tAdminB = criarSessao(db, adminB, 10);

  assert.equal(encerrarSessoesDoUsuario(db, fulano.id, fulano.tenant_id), 2);
  assert.equal(usuarioDaSessao(db, t1), null);
  assert.equal(usuarioDaSessao(db, t2), null);
  assert.equal(usuarioDaSessao(db, tAdminA).id, adminA.id);
  assert.equal(usuarioDaSessao(db, tAdminB).id, adminB.id);
});

test('não encerra sessões quando o escritório informado não é o do usuário', () => {
  const t = criarSessao(db, fulano, 10);
  assert.equal(encerrarSessoesDoUsuario(db, fulano.id, adminB.tenant_id), 0);
  assert.equal(usuarioDaSessao(db, t).id, fulano.id);
});

test('usuário sem sessão: devolve 0 sem erro', () => {
  assert.equal(encerrarSessoesDoUsuario(db, fulano.id, fulano.tenant_id), 0);
  assert.equal(encerrarSessoesDoUsuario(db, 999999, fulano.tenant_id), 0);
});

test('depois de encerrar, sessão nova do mesmo usuário funciona normalmente', () => {
  criarSessao(db, fulano, 10);
  encerrarSessoesDoUsuario(db, fulano.id, fulano.tenant_id);
  const nova = criarSessao(db, fulano, 10);
  assert.equal(usuarioDaSessao(db, nova).id, fulano.id);
});
