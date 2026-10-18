# Etapa 04: Webview de Visualização Dividida (Split Preview) com PDF.js

---

## 1. Objetivo da Etapa
Implementar o painel lateral de visualização em tempo real (*Split View*), integrando a biblioteca PDF.js em uma Webview do VS Code para renderizar o PDF real gerado pelo motor Java. O painel deve conter uma barra superior com formulário dinâmico de parâmetros detectados no `.jrxml`, botões de ação (Recompilar, Exportar PDF, Exportar .jasper) e suporte a Live Reload ao salvar o arquivo.

---

## 2. Escopo Técnico e Requisitos

### 2.1 Estrutura da Webview (`webviews/preview/` e `src/webviewPanels/previewPanel.ts`)

* **Abertura do Painel Lateral:**
  * O painel deve abrir ao lado do editor atual: `vscode.ViewColumn.Beside`.
  * Manter uma única instância por arquivo aberto ou reutilizar o painel ativo.
  * Habilitar scripts e configurar `localResourceRoots` apontando para as pastas `media/` e `webviews/preview/`.

* **Content Security Policy (CSP) Estrita:**
  * A Webview deve respeitar uma política de segurança rígida:
    ```text
    default-src 'none';
    script-src ${webview.cspSource};
    style-src ${webview.cspSource} 'unsafe-inline';
    font-src ${webview.cspSource};
    img-src ${webview.cspSource} data: blob:;
    worker-src ${webview.cspSource} blob:;
    ```
  * Todas as bibliotecas locais (PDF.js, worker e scripts próprios) devem ser carregadas via `webview.asWebviewUri`.

* **Biblioteca PDF.js:**
  * Integrar os arquivos estáticos em `media/pdfjs/`:
    * `pdf.min.js`
    * `pdf.worker.min.js`
  * O worker deve ser configurado adequadamente via URI do VS Code (`GlobalWorkerOptions.workerSrc`).

### 2.2 Barra Superior de Ações e Formulário Dinâmico

* **Detecção e Renderização de Parâmetros:**
  * Ao abrir o preview para um `.jrxml`, invocar `jrxmlParser.getMetadata(document)`.
  * Na barra superior colapsável, gerar inputs para cada parâmetro encontrado:
    * Parâmetros do tipo `java.lang.String`, `java.lang.Integer`, `java.lang.Long`, `java.math.BigDecimal`: inputs de texto com máscara/validação básica.
    * Parâmetros do tipo `java.util.Date`, `java.sql.Timestamp`: input de data (`type="date"` ou campo formatado `dd/MM/yyyy`).
    * Parâmetros do tipo `java.lang.Boolean`: checkbox/toggle.
    * Pré-preencher com o valor padrão caso exista `<defaultValueExpression>`.

* **Botões de Controle:**
  * **Atualizar / Executar:** Dispara compilação e preenchimento com os parâmetros informados nos inputs.
  * **Exportar PDF:** Abre `vscode.window.showSaveDialog` para o usuário salvar o PDF em disco de forma definitiva.
  * **Exportar .jasper:** Compila e gera o binário final para implantação.
  * **Checkbox/Toggle "Auto-reload ao salvar":** Quando marcado, salva a preferência e recarrega a visualização automaticamente a cada `Ctrl+S` no arquivo `.jrxml`.

* **Controles de Visualização do PDF:**
  * Paginação: `Anterior`, `Página X de Y`, `Próxima`.
  * Zoom: `Zoom In (+)`, `Zoom Out (-)`, `Ajustar à Largura`, `100%`.

### 2.3 Fluxo de Processamento e Arquivo Temporário

1. O usuário clica em "Atualizar" ou salva o arquivo (com Auto-reload ativo).
2. A Webview envia mensagem com o mapa de parâmetros `{ "CD_ATENDIMENTO": "12345" }` para o `previewPanel.ts`.
3. `previewPanel.ts` obtém a conexão ativa do `ConnectionManager` e a senha do `SecretStorage`.
4. Define o caminho do PDF temporário em pasta segura de scratch/temp (`os.tmpdir()/jasper_preview_<hash>.pdf`).
5. Invoca `runnerService.fillAndExport({ jrxmlPath, outputPath, dbProfile, password, params })`.
6. O motor Java executa com injeção automática de `SUBREPORT_DIR` e `REPORT_LOCALE`.
7. Ao receber a resposta de sucesso com o caminho do arquivo:
   * A extensão lê o arquivo temporário ou converte para URI da Webview e despacha a mensagem `loadPdf` com os bytes/URI para o script da Webview.
   * O PDF.js renderiza a primeira página e atualiza os contadores.

### 2.4 Diretrizes Visuais (Taste Design)

* Seguir rigorosamente o padrão visual nativo do VS Code.
* Sem cores extravagantes ou fontes exóticas. A barra superior deve parecer uma toolbar nativa do VS Code (`background: var(--vscode-editor-background); border-bottom: 1px solid var(--vscode-widget-border);`).
* Inputs estilizados com `var(--vscode-input-background)`, `var(--vscode-input-foreground)` e `var(--vscode-input-border)`.
* Feedback visual de carregamento discreto (barra de progresso no topo ou spinner nativo do VS Code).

---

## 3. Critérios de Aceite e Validação

1. **Abertura do Painel:**
   * Com um arquivo `.jrxml` aberto, acionar o comando `Jasper: Abrir Preview Dividido (Split)`.
   * A aba de preview abre ao lado sem fechar nem sobrepor o editor de código.
2. **Renderização do PDF:**
   * Caso o relatório possua conexão configurada, o PDF gerado é renderizado com texto nítido, margens corretas e paginação funcional.
3. **Formulário de Parâmetros:**
   * Alterar um valor no formulário da toolbar e clicar em "Atualizar" regera o PDF com o novo parâmetro refletido no documento.
4. **Live Reload:**
   * Com a opção de auto-reload habilitada, modificar um texto no XML e pressionar `Ctrl+S` deve atualizar a visualização em menos de 2 segundos.

---

## 4. Instruções para o AGY

1. Configure a pasta `media/pdfjs/` com os arquivos essenciais do PDF.js (`pdf.min.js`, `pdf.worker.min.js`).
2. Crie a estrutura da Webview em `webviews/preview/` (`index.html`, `style.css`, `main.js`).
3. Desenvolva `src/webviewPanels/previewPanel.ts` implementando a comunicação bidirecional via `postMessage`.
4. Registre o listener de salvamento `vscode.workspace.onDidSaveTextDocument` para o Live Reload.
5. Registre o comando `jasper.openPreview` no `package.json` e `src/extension.ts`.
6. Valide a compilação do TypeScript com `npm run compile`.
