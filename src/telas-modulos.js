// Páginas dos módulos (Folha, Fiscal, Contábil), montadas no servidor com o layout comum.
// O acesso já foi conferido pela rota; estas funções só montam o HTML.
import { paginaComLayout } from './telas.js';

const NIVEIS = { consulta: 'Consulta', operacao: 'Operação' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Preenche cabeçalho e menu com os dados do usuário (mesma fonte do painel).
const SCRIPT_CABECALHO = `
api('/api/eu').then(preencherCabecalho).catch(() => {});
async function api(caminho) {
  const r = await fetch(caminho);
  if (r.status === 401) { location.href = '/login'; throw new Error('sessão encerrada'); }
  if (!r.ok) throw new Error('Erro');
  return r.json();
}
`;

const pagina = (titulo, conteudo) => paginaComLayout({ titulo: `${esc(titulo)} — Hub Vértice G`, conteudo, script: SCRIPT_CABECALHO });

/** Tela inicial do módulo. `departamento` é o devolvido por exigirPermissao ({ nome, nivel }). */
export function paginaModulo(modulo, departamento) {
  const origem = departamento.nome === modulo.titulo ? '' : ` · Departamento: ${esc(departamento.nome)}`;
  return pagina(modulo.titulo, `
  <section class="cartao"><h2>${esc(modulo.titulo)}</h2>
    <p>Seu acesso: <strong>${esc(NIVEIS[departamento.nivel])}</strong>${origem}</p>
    <p class="dica">Operações oficiais: Domínio.</p>
  </section>
  <section class="cartao" id="emPreparacao"><h2>Em preparação</h2>
    <p>As ferramentas deste módulo serão liberadas aos poucos.</p>
  </section>`);
}

/** Acesso negado (403). A mensagem vem de exigirPermissao (ou de exigirConsultaClientes, com outro título). */
export function paginaSemAcesso(mensagem, titulo = 'Sem acesso a este módulo') {
  return pagina('Sem acesso', `
  <section class="cartao"><h2>${esc(titulo)}</h2>
    <p>${esc(mensagem)}</p>
    <p class="dica">Se precisar deste acesso, fale com o administrador do escritório.</p>
  </section>`);
}

/** Módulo inexistente ou ainda não disponível no escritório (404). */
export function paginaModuloNaoEncontrado() {
  return pagina('Módulo não encontrado', `
  <section class="cartao"><h2>Módulo não encontrado</h2>
    <p>Este módulo não existe ou ainda não está disponível no seu escritório.</p>
  </section>`);
}
