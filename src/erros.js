/** Erro causado pelo pedido (dado inválido); a mensagem vai para a tela. */
export class ErroDeUso extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}
