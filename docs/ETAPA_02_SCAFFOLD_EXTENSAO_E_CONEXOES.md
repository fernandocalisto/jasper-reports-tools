# Etapa 02: Scaffold da Extensão VS Code e Gestão Segura de Conexões

---

## 1. Objetivo da Etapa
Inicializar a estrutura TypeScript da extensão VS Code (`package.json`, `tsconfig.json`, `src/`), criar o container da extensão na Activity Bar (barra lateral esquerda), implementar a camada segura de armazenamento de conexões (`context.globalState` e `vscode.SecretStorage`), criar a TreeView de bancos de dados, o item de Status Bar para troca rápida de conexão ativa e o formulário Webview de cadastro/edição de perfis.

---

## 2. Escopo Técnico e Requisitos

### 2.1 Configuração Base do Projeto (`package.json` e `tsconfig.json`)
* Configurar `package.json` com TypeScript, devDependencies (`@types/vscode`, `@types/node`, `typescript`).
* Contributes:
  * **Activity Bar Container:** ID `jasper-tools`, título `JasperReports`, ícone `media/icons/jasper.svg`.
  * **View na Barra Lateral:** ID `jasper-databases`, nome `Conexões de Banco de Dados`.
  * **Comandos:**
    * `jasper.addConnection`: Abre o painel Webview para nova conexão.
    * `jasper.editConnection`: Abre o painel Webview com os dados de uma conexão existente.
    * `jasper.deleteConnection`: Remove o perfil e deleta o segredo associado.
    * `jasper.setActiveConnection`: Define o perfil como conexão ativa para relatórios.
    * `jasper.testConnection`: Dispara teste de validação de conexão.

### 2.2 Modelos de Dados (`src/models/database.ts`)
```typescript
export type SupportedDriver = 'postgres' | 'oracle' | 'custom';

export interface DatabaseProfile {
  id: string;                      // Identificador único (UUID)
  name: string;                    // Nome amigável (ex: 'Docker Local', 'Hospital Prod')
  driver: SupportedDriver;         // 'postgres' | 'oracle' | 'custom'
  host?: string;                   // Host do banco
  port?: number;                   // Porta (padrão 5432 p/ postgres, 1521 p/ oracle)
  database?: string;               // Database, SID ou Service Name
  user?: string;                   // Usuário
  customDriverPath?: string;       // Caminho absoluto para o .jar customizado
  customDriverClass?: string;      // Nome da classe (ex: com.microsoft.sqlserver.jdbc.SQLServerDriver)
  createdAt: number;
  updatedAt: number;
}
```

### 2.3 Serviço de Conexões (`src/services/connectionManager.ts`)
* Utilizar `vscode.ExtensionContext`:
  * Metadados: Salvos em `context.globalState.get<DatabaseProfile[]>('jasper_db_profiles', [])`.
  * Senhas: Salvas exclusivamente em `context.secrets.store(`jasper_db_secret_${profileId}`, password)`.
  * Ao deletar um perfil, executar `context.secrets.delete(`jasper_db_secret_${profileId}`)`.
* Gerenciamento de Conexão Ativa:
  * Gravar o ID da conexão ativa em `context.workspaceState` (por workspace) ou `context.globalState`.
  * Método `getActiveProfile(): Promise<DatabaseProfile | undefined>`.
  * Método `setActiveProfile(id: string): Promise<void>`.

### 2.4 Árvore na Barra Lateral (`src/providers/databaseTreeProvider.ts`)
* Implementar `vscode.TreeDataProvider<DatabaseTreeItem>`.
* Itens da árvore:
  * Exibir o ícone de status ativo (ex: círculo verde preenchido para ativo, círculo transparente ou cinza para inativo).
  * Exibir nome da conexão e detalhes secundários (ex: `postgres@localhost:5432/hospital`).
  * Botões de ação em cada item (hover / menu de contexto):
    * Definir como Ativa (`check` / `star`).
    * Editar (`pencil`).
    * Excluir (`trash`).
    * Testar Conexão (`zap` ou `plug`).
  * Botão de adição no cabeçalho da view: `+` (Adicionar Nova Conexão).

### 2.5 Status Bar Item
* Criar item na barra de status inferior do VS Code:
  * Texto: `$(database) Jasper: [Nome da Conexão Ativa]` (ou `$(database) Jasper: Nenhuma Conexão`).
  * Tooltip: "Clique para alternar a conexão de banco de dados ativa".
  * Comando: abre um `vscode.window.showQuickPick` com a lista de conexões disponíveis para troca rápida com um único clique.

### 2.6 Painel Webview de Cadastro/Edição (`src/webviewPanels/databaseFormPanel.ts` e `webviews/connection-form/`)
* Criar Webview com formulário elegante e integrado ao tema do VS Code:
  * **Campos:**
    * Nome da Conexão.
    * Driver: Select com opções `PostgreSQL`, `Oracle` e `Personalizado (.jar)`.
    * Se Personalizado: campo com botão de busca no disco para o arquivo `.jar` e input para a Classe do Driver.
    * Host, Porta, Database / Service Name.
    * Usuário e Senha.
  * **Ações:**
    * Botão **Salvar**: valida campos, envia mensagem para a extensão persistir no `ConnectionManager` e fecha o painel.
    * Botão **Testar Conexão**: envia mensagem para a extensão disparar teste (na Etapa 03 integrará com o Runner).
  * **Diretrizes Visuais (Taste Design):**
    * Utilizar estritamente variáveis de CSS do VS Code: `var(--vscode-editor-background)`, `var(--vscode-input-background)`, `var(--vscode-button-background)`, etc.
    * Tipografia padrão da interface do VS Code.
    * Sem cantos excessivamente arredondados (`rounded-full`), sem efeitos neon, visual profissional e limpo.

---

## 3. Critérios de Aceite e Validação

1. **Compilação TypeScript:**
   * `npm run compile` deve compilar todo o código TypeScript sem erros (`tsc --noEmit` limpo).
2. **Execução no VS Code:**
   * Ao abrir a extensão em modo de desenvolvimento (F5):
     * O ícone da extensão aparece na Activity Bar lateral.
     * Clicar no botão `+` abre a Webview de cadastro de conexão.
     * Preencher dados e salvar cria o item na árvore de conexões.
     * A senha não é visível em nenhum arquivo local e fica armazenada no `SecretStorage`.
     * Clicar na conexão permite marcá-la como ativa, e o nome é refletido imediatamente no item da Status Bar inferior.
     * Clicar na Status Bar abre o menu de seleção rápida e permite alternar entre conexões.

---

## 4. Instruções para o AGY

1. Configure a raiz do projeto com `package.json`, `tsconfig.json` e dependências necessárias.
2. Crie os arquivos em `src/models/`, `src/services/`, `src/providers/`, `src/commands/` e `src/webviewPanels/`.
3. Desenvolva os arquivos estáticos da Webview em `webviews/connection-form/` (HTML, CSS nativo e JS de comunicação).
4. Registre todos os providers e comandos no `src/extension.ts`.
5. Execute `npm run compile` para validar a ausência de erros de tipagem e verifique a integridade do código.
