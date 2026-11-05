// Cadastro de clientes PJ e PF (docs/especificacao-clientes-e-modulos.md, seções 2, 3 e 5; etapa 7).
// Escopo desta etapa: cadastrar, corrigir/editar, consultar, listar, inativar e reativar.
// Serviços contratados e o encerramento automático na inativação entram na etapa 8; permissões e rotas, na etapa 9.
// As funções de gravação supõem que quem chama já conferiu que o autor é administrador (como em escritorios.js).
// Toda consulta filtra pelo escritório (tenant_id). Cliente nunca é excluído. Auditoria sem CPF, CNPJ, nome de PF
// ou código no Domínio (I-12); mensagens de erro nunca repetem o documento.
import { registrar } from './db.js';
import { cnpjValido, cpfValido, prepararCnpj, prepararCpf } from './documentos.js';
import { ErroDeUso } from './erros.js';

const UFS = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);
const CAMPOS_PJ = ['nome_fantasia', 'inscricao_estadual', 'inscricao_municipal', 'tipo_estabelecimento', 'cnpj_matriz', 'contato_responsavel'];
const CAMPOS_PF = ['data_nascimento', 'whatsapp'];
const CAMPOS_COMUNS = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'telefone', 'email', 'codigo_dominio'];
const CAMPOS_EDITAVEIS = ['documento', 'nome', ...CAMPOS_PJ, ...CAMPOS_PF, ...CAMPOS_COMUNS];
const ROTULOS = {
  documento: 'Documento', nome: 'Nome', nome_fantasia: 'Nome fantasia', inscricao_estadual: 'Inscrição estadual',
  inscricao_municipal: 'Inscrição municipal', tipo_estabelecimento: 'Tipo de estabelecimento', cnpj_matriz: 'CNPJ da matriz',
  contato_responsavel: 'Contato responsável', data_nascimento: 'Data de nascimento', whatsapp: 'WhatsApp', cep: 'CEP',
  logradouro: 'Logradouro', numero: 'Número', complemento: 'Complemento', bairro: 'Bairro', municipio: 'Município', uf: 'UF',
  telefone: 'Telefone', email: 'E-mail', codigo_dominio: 'Código no Domínio',
};
// Tamanho máximo dos campos de texto livre (proteção do banco e da tela).
const TAMANHO_MAXIMO = {
  nome: 150, nome_fantasia: 150, inscricao_estadual: 30, inscricao_municipal: 30, contato_responsavel: 100, logradouro: 150,
  numero: 20, complemento: 100, bairro: 100, municipio: 100, email: 150, codigo_dominio: 30,
};
const POR_PAGINA = 100;

/** Data de hoje (AAAA-MM-DD) no horário de Brasília. */
export function hojeEmBrasilia(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

function texto(campo, valor) {
  if (valor == null) return null;
  if (typeof valor !== 'string') throw new ErroDeUso(`${ROTULOS[campo]}: valor inválido.`);
  const t = valor.trim();
  if (!t) return null;
  if (TAMANHO_MAXIMO[campo] && t.length > TAMANHO_MAXIMO[campo]) throw new ErroDeUso(`${ROTULOS[campo]}: no máximo ${TAMANHO_MAXIMO[campo]} caracteres.`);
  return t;
}

/** Telefone, WhatsApp e CEP: aceita máscara comum (espaço, parênteses, ponto, hífen) e grava só números. */
function digitos(campo, valor, tamanhos) {
  const t = texto(campo, valor);
  if (t == null) return null;
  const d = t.replace(/[\s().-]/g, '');
  if (!/^\d+$/.test(d) || !tamanhos.includes(d.length)) throw new ErroDeUso(`${ROTULOS[campo]} inválido.`);
  return d;
}

function dataValida(campo, valor, agora) {
  const t = texto(campo, valor);
  if (t == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const d = m && new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (!d || d.toISOString().slice(0, 10) !== t) throw new ErroDeUso(`${ROTULOS[campo]} inválida (use AAAA-MM-DD).`);
  if (t > hojeEmBrasilia(agora)) throw new ErroDeUso(`${ROTULOS[campo]} não pode ser futura.`);
  return t;
}

/** Normaliza um campo informado (máscaras, espaços, maiúsculas). Não confere regras entre campos. */
function normalizarCampo(campo, valor, tipo, agora) {
  switch (campo) {
    case 'documento':
      if (valor == null) return null;
      if (typeof valor !== 'string') throw new ErroDeUso(tipo === 'PJ' ? 'CNPJ inválido.' : 'CPF inválido.');
      return (tipo === 'PJ' ? prepararCnpj(valor) : prepararCpf(valor)) || null;
    case 'cnpj_matriz':
      if (valor == null) return null;
      if (typeof valor !== 'string') throw new ErroDeUso('CNPJ da matriz inválido.');
      return prepararCnpj(valor) || null;
    case 'tipo_estabelecimento': {
      const t = texto(campo, valor);
      return t == null ? null : t.toLowerCase();
    }
    case 'uf': {
      const t = texto(campo, valor);
      return t == null ? null : t.toUpperCase();
    }
    case 'cep': return digitos(campo, valor, [8]);
    case 'telefone':
    case 'whatsapp': return digitos(campo, valor, [10, 11]);
    case 'data_nascimento': return dataValida(campo, valor, agora);
    default: return texto(campo, valor);
  }
}

/** Regras do cliente completo (cadastro ou resultado de uma edição). */
function validarCliente(c) {
  if (!c.nome) throw new ErroDeUso('Informe o nome.');
  if (c.tipo === 'PJ') {
    if (!c.documento) throw new ErroDeUso('Informe o CNPJ.');
    if (!cnpjValido(c.documento)) throw new ErroDeUso('CNPJ inválido.');
    for (const campo of CAMPOS_PF) if (c[campo] != null) throw new ErroDeUso(`${ROTULOS[campo]} não se aplica a pessoa jurídica.`);
    if (!['matriz', 'filial'].includes(c.tipo_estabelecimento)) throw new ErroDeUso('Informe o tipo de estabelecimento: matriz ou filial.');
    if (c.tipo_estabelecimento === 'filial') {
      if (!c.cnpj_matriz) throw new ErroDeUso('Informe o CNPJ da matriz.');
      if (!cnpjValido(c.cnpj_matriz)) throw new ErroDeUso('CNPJ da matriz inválido.');
      if (c.cnpj_matriz === c.documento) throw new ErroDeUso('O CNPJ da matriz não pode ser o próprio CNPJ da filial.');
      if (c.cnpj_matriz.slice(0, 8) !== c.documento.slice(0, 8)) throw new ErroDeUso('O CNPJ da matriz deve ter a mesma raiz (8 primeiras posições) do CNPJ da filial.');
    } else if (c.cnpj_matriz != null) {
      throw new ErroDeUso('Matriz não tem CNPJ da matriz; deixe o campo vazio.');
    }
  } else {
    if (!c.documento) throw new ErroDeUso('Informe o CPF.');
    if (!cpfValido(c.documento)) throw new ErroDeUso('CPF inválido.');
    for (const campo of CAMPOS_PJ) if (c[campo] != null) throw new ErroDeUso(`${ROTULOS[campo]} não se aplica a pessoa física.`);
  }
  if (c.uf != null && !UFS.has(c.uf)) throw new ErroDeUso('UF inválida.');
  if (c.email != null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new ErroDeUso('E-mail inválido.');
}

function conferirCampos(dados) {
  if (dados == null || typeof dados !== 'object' || Array.isArray(dados)) throw new ErroDeUso('Dados do cliente inválidos.');
  for (const campo of Object.keys(dados)) {
    if (campo !== 'tipo' && !CAMPOS_EDITAVEIS.includes(campo)) throw new ErroDeUso(`Campo desconhecido: ${campo}`);
  }
}

function conferirUnicidade(db, tenantId, c, ignorarId = null) {
  const mesmoDoc = db.prepare('SELECT id FROM clientes WHERE tenant_id = ? AND documento = ? AND id IS NOT ?').get(tenantId, c.documento, ignorarId);
  if (mesmoDoc) throw new ErroDeUso(c.tipo === 'PJ' ? 'Já existe cliente com este CNPJ neste escritório.' : 'Já existe cliente com este CPF neste escritório.');
  if (c.codigo_dominio != null) {
    const mesmoCodigo = db.prepare('SELECT id FROM clientes WHERE tenant_id = ? AND codigo_dominio = ? AND id IS NOT ?').get(tenantId, c.codigo_dominio, ignorarId);
    if (mesmoCodigo) throw new ErroDeUso('Já existe cliente com este código no Domínio neste escritório.');
  }
}

/** Cadastra cliente PJ ou PF no escritório de quem pede. Devolve o número do cliente. */
export function cadastrarCliente(db, autor, dados, agora = new Date()) {
  conferirCampos(dados);
  if (!['PJ', 'PF'].includes(dados.tipo)) throw new ErroDeUso('Informe o tipo de pessoa: PJ ou PF.');
  const c = { tipo: dados.tipo };
  for (const campo of CAMPOS_EDITAVEIS) c[campo] = normalizarCampo(campo, dados[campo], c.tipo, agora);
  validarCliente(c);
  return db.transaction(() => {
    conferirUnicidade(db, autor.tenant_id, c);
    const colunas = ['tenant_id', 'tipo', ...CAMPOS_EDITAVEIS];
    const id = Number(db.prepare(`INSERT INTO clientes (${colunas.join(', ')}) VALUES (${colunas.map(() => '?').join(', ')})`)
      .run(autor.tenant_id, c.tipo, ...CAMPOS_EDITAVEIS.map((campo) => c[campo])).lastInsertRowid);
    registrar(db, { tenantId: autor.tenant_id, usuarioId: autor.id, acao: 'cliente.criado', detalhe: { cliente: id, tipo: c.tipo } });
    return id;
  })();
}

function buscarDoEscritorio(db, tenantId, clienteId) {
  const c = db.prepare('SELECT * FROM clientes WHERE id = ? AND tenant_id = ?').get(clienteId, tenantId);
  if (!c) throw new ErroDeUso('Cliente não encontrado.', 404);
  return c;
}

/**
 * Edita só os campos informados (campo com valor vazio ou null é apagado, salvo os obrigatórios).
 * O tipo de pessoa não muda (I-14). O documento pode ser corrigido (A-12). Corrigir o CNPJ de uma matriz não
 * altera as filiais (A-15). Sem mudança, não grava nada.
 */
export function editarCliente(db, autor, clienteId, dados, agora = new Date()) {
  conferirCampos(dados);
  return db.transaction(() => {
    const atual = buscarDoEscritorio(db, autor.tenant_id, clienteId);
    if (dados.tipo !== undefined && dados.tipo !== atual.tipo) throw new ErroDeUso('O tipo de pessoa (PJ/PF) não pode ser alterado.');
    const novo = { ...atual };
    for (const campo of CAMPOS_EDITAVEIS) if (Object.hasOwn(dados, campo)) novo[campo] = normalizarCampo(campo, dados[campo], atual.tipo, agora);
    validarCliente(novo);
    const campos = CAMPOS_EDITAVEIS.filter((campo) => novo[campo] !== atual[campo]);
    if (!campos.length) return;
    conferirUnicidade(db, autor.tenant_id, novo, atual.id);
    db.prepare(`UPDATE clientes SET ${campos.map((campo) => `${campo} = ?`).join(', ')}, atualizado_em = datetime('now') WHERE id = ? AND tenant_id = ?`)
      .run(...campos.map((campo) => novo[campo]), atual.id, autor.tenant_id);
    registrar(db, { tenantId: autor.tenant_id, usuarioId: autor.id, acao: 'cliente.editado', detalhe: { cliente: atual.id, campos } });
  })();
}

/** Inativa (ativo = false) ou reativa (ativo = true). Nunca exclui. Serviços em aberto: encerramento entra na etapa 8. */
export function alterarSituacaoCliente(db, autor, clienteId, ativo) {
  if (typeof ativo !== 'boolean') throw new ErroDeUso('Situação inválida.');
  return db.transaction(() => {
    const atual = buscarDoEscritorio(db, autor.tenant_id, clienteId);
    if (Boolean(atual.ativo) === ativo) throw new ErroDeUso(ativo ? 'O cliente já está ativo.' : 'O cliente já está inativo.');
    db.prepare("UPDATE clientes SET ativo = ?, atualizado_em = datetime('now') WHERE id = ? AND tenant_id = ?").run(ativo ? 1 : 0, atual.id, autor.tenant_id);
    registrar(db, { tenantId: autor.tenant_id, usuarioId: autor.id, acao: ativo ? 'cliente.reativado' : 'cliente.inativado', detalhe: { cliente: atual.id } });
  })();
}

/** Detalhe do cliente do escritório, com a matriz (se cadastrada no Hub) e as filiais cadastradas. */
export function consultarCliente(db, tenantId, clienteId) {
  const c = buscarDoEscritorio(db, tenantId, clienteId);
  const resumo = 'SELECT id, nome, documento, ativo FROM clientes WHERE tenant_id = ?';
  return {
    ...c,
    matriz: c.cnpj_matriz ? db.prepare(`${resumo} AND documento = ?`).get(tenantId, c.cnpj_matriz) ?? null : null,
    filiais: c.tipo === 'PJ' ? db.prepare(`${resumo} AND cnpj_matriz = ? ORDER BY nome, id`).all(tenantId, c.documento) : [],
  };
}

/**
 * Lista os clientes do escritório: filtro por tipo e situação ('ativos' — padrão —, 'inativos' ou 'todos'),
 * busca por nome ou documento (máscara ignorada; % e _ valem como texto) e páginas de 100.
 */
export function listarClientes(db, tenantId, { tipo, situacao = 'ativos', busca, pagina = 1 } = {}) {
  const condicoes = ['tenant_id = ?'];
  const params = [tenantId];
  if (tipo != null) {
    if (!['PJ', 'PF'].includes(tipo)) throw new ErroDeUso('Tipo inválido.');
    condicoes.push('tipo = ?');
    params.push(tipo);
  }
  if (!['ativos', 'inativos', 'todos'].includes(situacao)) throw new ErroDeUso('Situação inválida.');
  if (situacao !== 'todos') condicoes.push(`ativo = ${situacao === 'ativos' ? 1 : 0}`);
  if (busca != null) {
    if (typeof busca !== 'string') throw new ErroDeUso('Busca inválida.');
    const termo = busca.trim();
    if (termo) {
      const escapar = (s) => s.replace(/[\\%_]/g, (x) => `\\${x}`);
      const doc = termo.replace(/[\s./-]/g, '').toUpperCase();
      condicoes.push(doc ? "(nome LIKE ? ESCAPE '\\' OR documento LIKE ? ESCAPE '\\')" : "nome LIKE ? ESCAPE '\\'");
      params.push(`%${escapar(termo)}%`);
      if (doc) params.push(`%${escapar(doc)}%`);
    }
  }
  if (!Number.isSafeInteger(pagina) || pagina < 1) throw new ErroDeUso('Página inválida.');
  const onde = condicoes.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM clientes WHERE ${onde}`).get(...params).n;
  const itens = db.prepare(`SELECT id, tipo, documento, nome, nome_fantasia, tipo_estabelecimento, municipio, uf, ativo FROM clientes
    WHERE ${onde} ORDER BY nome, id LIMIT ? OFFSET ?`).all(...params, POR_PAGINA, (pagina - 1) * POR_PAGINA);
  return { itens, total, pagina, porPagina: POR_PAGINA };
}
