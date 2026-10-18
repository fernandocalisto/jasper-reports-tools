# Etapa 05: JasperServer Explorer (REST API v2)

---

## 1. Objetivo da Etapa
Implementar a integração completa com o JasperServer via REST API v2 diretamente em TypeScript (Node.js), sem dependência do motor Java. Funcionalidades: cadastro de servidores, navegação preguiçosa (lazy loading) de pastas e relatórios na TreeView da Activity Bar, download de `.jrxml` para edição local, e deploy (upload) de `.jrxml` ou `.jasper` compilado de volta para o servidor.

---

## 2. Escopo Técnico e Requisitos

### 2.1 Modelos de Dados (`src/models/jasperserver.ts`)
```typescript
export interface JasperServerProfile {
  id: string;                      // UUID
  name: string;                    // Nome amigável (ex: 'Homologação', 'Produção')
  baseUrl: string;                 // Ex: 'http://servidor:8080/jasperserver'
  organization?: string;           // Organização (para JasperServer Pro/Enterprise), ex: 'organization_1'
  username: string;
  // Senha armazenada APENAS em SecretStorage: chave 'jasper_server_secret_${id}'
  createdAt: number;
  updatedAt: number;
}

export interface RepositoryResource {
  uri: string;                     // URI completo no repositório (ex: '/reports/hospitalar/Atendimento.jrxml')
  name: string;                    // Nome do arquivo
  resourceType: 'folder' | 'reportUnit' | 'jrxml' | 'jasper' | 'datasource' | 'other';
  description?: string;
  version?: number;
  parentFolderUri: string;
}
```

### 2.2 Cliente HTTP (`src/services/jasperServerClient.ts`)
* **Autenticação:**
  * Login via `POST /rest_v2/login` com `j_username` e `j_password` (form-urlencoded).
  * Manter cookie de sessão (`JSESSIONID`) em memória para requisições subsequentes.
  * Tratar expiração de sessão (401) com re-login automático transparente.
* **Métodos Principais:**
  * `testConnection(profile): Promise<{ version: string; user: string }>` → `GET /rest_v2/serverInfo`
  * `listResources(folderUri: string): Promise<RepositoryResource[]>` → `GET /rest_v2/resources?folderUri=...&recursive=false`
  * `downloadResource(uri: string): Promise<string>` → `GET /rest_v2/resources{uri}?file=jrxml` (retorna XML bruto)
  * `uploadResource(folderUri: string, fileName: string, content: string, resourceType: 'jrxml' | 'jasper'): Promise<void>` → `PUT /rest_v2/resources{uri}` com `multipart/form-data` ou `POST` para criação.
  * `deleteResource(uri: string): Promise<void>` → `DELETE /rest_v2/resources{uri}`

### 2.3 Gerenciamento de Perfis de Servidor (`src/services/serverManager.ts`)
* Espelha a estrutura do `ConnectionManager`:
  * Metadados em `context.globalState` (`jasper_server_profiles`).
  * Senhas em `context.secrets` (`jasper_server_secret_${id}`).
  * CRUD completo: adicionar, editar, remover, listar.
  * Definição de servidor "ativo" (contexto atual).

### 2.4 TreeView do Repositório (`src/providers/serverTreeProvider.ts`)
* Implementar `vscode.TreeDataProvider<ServerTreeItem>`.
* **Raiz da árvore:** Itens são os servidores cadastrados.
* **Expansão preguiçosa (Lazy Loading):**
  * Ao expandir um servidor → chama `listResources('/')`.
  * Ao expandir uma pasta → chama `listResources(folderUri)`.
* **Itens de Relatório (`.jrxml`, `.jasper`):**
  * Ícone diferenciado por tipo.
  * Menu de contexto (clique direito):
    * **Baixar e Abrir:** Faz download do XML, salva em arquivo temporário ou no workspace do usuário e abre no editor.
    * **Deploy .jasper (Compilar e Enviar):** Compila o arquivo aberto localmente (via `RunnerService`) e faz upload do `.jasper` gerado para a mesma pasta do servidor.
    * **Atualizar .jrxml no Servidor:** Envia o conteúdo do editor atual para o servidor (sobrescreve).
    * **Excluir no Servidor:** `DELETE` com confirmação.

### 2.5 Webview de Cadastro/Edição de Servidor (`src/webviewPanels/serverFormPanel.ts` + `webviews/jasperserver-form/`)
* Formulário com campos:
  * Nome do Perfil.
  * URL Base (ex: `http://localhost:8080/jasperserver`).
  * Organização (opcional).
  * Usuário e Senha.
* Botão **Testar Comunicação**: Chama `client.testConnection()` e exibe versão do servidor e usuário logado.
* Estilo visual consistente com a Webview de banco de dados (variáveis CSS do VS Code).

### 2.6 Comandos Registrados (`src/commands/serverCommands.ts`)
* `jasper.addServer` → Abre Webview de novo servidor.
* `jasper.editServer` → Abre Webview preenchida.
* `jasper.deleteServer` → Remove perfil e segredo.
* `jasper.setActiveServer` → Define servidor ativo.
* `jasper.refreshServerTree` → Recarrega a raiz da árvore.
* `jasper.downloadServerReport` → Baixa recurso selecionado na árvore.
* `jasper.deployJasperToServer` → Compila local + upload do `.jasper`.
* `jasper.updateJrxmlOnServer` → Upload do `.jrxml` do editor ativo.

---

## 3. Critérios de Aceite e Validação

1. **Cadastro e Teste:**
   * Adicionar servidor aponta para JasperServer real, botão "Testar" retorna versão do servidor (ex: "8.2.0") e usuário.
2. **Navegação:**
   * Árvore expande pastas sob demanda sem travar a UI.
   * Ícones corretos para pastas, relatórios (unidades de relatório), arquivos `.jrxml` e `.jasper`.
3. **Download:**
   * Clicar em "Baixar e Abrir" em um relatório do servidor abre o `.jrxml` no editor do VS Code com syntax highlighting.
4. **Deploy:**
   * Com um `.jrxml` aberto e válido, acionar "Deploy .jasper" compila localmente, sobe o binário para a pasta de origem no servidor e notifica sucesso.
5. **Segurança:**
   * Senhas nunca aparecem em logs, arquivos ou `globalState`.

---

## 4. Instruções para o AGY

1. Crie `src/models/jasperserver.ts`, `src/services/jasperServerClient.ts`, `src/services/serverManager.ts`.
2. Implemente `src/providers/serverTreeProvider.ts` com lazy loading.
3. Crie a Webview em `webviews/jasperserver-form/` e o controlador em `src/webviewPanels/serverFormPanel.ts`.
4. Registre comandos e provedores no `src/extension.ts` e `package.json` (nova View `jasper-servers` no container `jasper-tools`).
5. Valide compilação: `npm run compile`.