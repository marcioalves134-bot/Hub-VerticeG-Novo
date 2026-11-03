# Hub Vértice G

Fundação do novo Hub Vértice G: escritórios (multi-tenant), usuários, departamentos com nível de acesso, login e registro de ações.

## Primeiro uso

1. Dê duplo clique em `Abrir Hub Vertice G.cmd` uma vez (instala as dependências) e feche a janela.
2. Abra o PowerShell nesta pasta e rode `npm run criar-escritorio`. Responda às perguntas (código do escritório, nome, administrador, senha).
3. Dê duplo clique em `Abrir Hub Vertice G.cmd`. O painel abre em http://127.0.0.1:3200.
4. Entre com o código do escritório, o usuário e a senha.

## O que já funciona (versão 0.1)

- Login por escritório + usuário + senha; 5 erros seguidos bloqueiam por 15 minutos.
- Painel com os departamentos liberados para o usuário (Fiscal e Pessoal (DP)).
- Administrador: lista e cria usuários, define o acesso por departamento (Consulta ou Operação) e vê o registro de ações.
- Cada escritório só enxerga os próprios dados.
