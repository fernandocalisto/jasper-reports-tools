# Etapa 7: JasperServer UX Improvements

---

## 1. Objetivo
Melhorar drasticamente a experiência de navegação, busca e operações no **JasperServer Explorer** (TreeView `jasper-servers`), mantendo busca **client-side** (rápida, sem round-trip) e adicionando **reload manual** para sincronização com servidor.

---

## 2. Requisitos Funcionais

### 2.1 Busca Client-Side (Ctrl+F)
- **Atalho**: `Ctrl+F` (ou `Cmd+F`) quando TreeView `jasper-servers` tem foco
- **UI**: Input de busca no header da TreeView (inline) ou QuickPick modal
- **Comportamento**:
  - Filtra árvore **em memória** (já carregada) por nome, caminho, tipo
  - Highlight de matches no label do TreeItem
  - Expande automaticamente pastas que contenham matches
  - Limpa busca com `Escape` ou botão `×`

### 2.2 Copy/Paste (Ctrl+C / Ctrl+V)
- **Copy**: Seleciona um ou mais itens (arquivos `.jrxml`, `.jasper`, pastas) → `Ctrl+C`
- **Paste**: No Explorer do VS Code (workspace local) ou editor aberto → `Ctrl+V`
  - Baixa o(s) arquivo(s) do servidor → salva no workspace local (mantendo estrutura de pastas opcional)
  - Abre automaticamente o primeiro `.jrxml` no editor
- **Copy Path**: `Ctrl+Shift+C` → copia caminho do recurso no servidor (ex: `/reports/hospitalar/Atendimento.jrxml`)

### 2.3 Reload Manual (Sync com Servidor)
- **Botão no header da TreeView**: ícone `refresh` → recarrega árvore do servidor
- **Comando**: `jasper.refreshServerTree` (já existe) → agora com feedback visual (spinner + toast)
- **Auto-expand**: Mantém expansão das pastas que estavam abertas antes do reload

### 2.4 Navegação Melhorada
- **Breadcrumbs** no header da TreeView: `Servidor > reports > hospitalar > Atendimento.jrxml`
- **Clique no breadcrumb** → navega para aquele nível
- **Duplo-clique em pasta** → expande/contrai (além da seta)
- **Contexto de teclado**: `Enter` abre arquivo, `Backspace` sobe um nível

### 2.5 Multi-Select (Checkboxes)
- **Modo seleção**: `Shift+Click` ou `Ctrl+Click` → checkboxes aparecem
- **Barra de ações flutuante** (ou no header): Download, Delete, Deploy, Copy Path
- **Selecionar tudo na pasta**: checkbox no header da pasta

---

## 3. Requisitos Não-Funcionais
- **Busca 100% client-side**: Zero chamadas REST durante digitação
- **Carregamento preguiçoso (lazy)**: Mantém — só carrega filhos ao expandir
- **Persistência de estado**: Expansão de pastas, scroll, seleção sobrevivem a reload
- **Performance**: Árvore com 10k+ itens deve filtrar em <50ms

---

## 4. Arquitetura Técnica

### 4.1 TreeView Data Provider (`serverTreeProvider.ts`)
- **Cache em memória**: `Map<string, RepositoryResource[]>` por `folderUri`
- **Método `getAllResourcesFlat()`**: retorna lista plana de todos recursos já carregados (para busca)
- **Método `filterTree(filterFn)`**: aplica filtro e chama `refresh()` com itens filtrados
- **Estado de expansão**: `Set<string>` de `folderUri` expandidos — preservado no reload

### 4.2 Search Controller (`serverSearchController.ts`)
- **Registra keybinding** `Ctrl+F` quando `view == jasper-servers`
- **Mostra input inline** no header da TreeView (via `view/title` menu contribution ou WebView overlay)
- **Debounce** 150ms na digitação
- **Highlight**: injeta `<mark>` no label via `TreeItem.label` (MarkdownString)

### 4.3 Clipboard Integration
- **Copy**: `vscode.env.clipboard.writeText()` com JSON custom:
  ```json
  { "type": "jasperServerResources", "items": [{ "uri": "...", "name": "...", "type": "jrxml", "serverId": "..." }] }
  ```
- **Paste**: `vscode.env.clipboard.readText()` → parse JSON → `serverClient.downloadResource()` para cada → salva no workspace

### 4.4 Keybindings (package.json)
```json
{
  "keybindings": [
    { "command": "jasper.searchServerResources", "key": "ctrl+f", "when": "view == jasper-servers" },
    { "command": "jasper.copyServerResource", "key": "ctrl+c", "when": "view == jasper-servers && viewItem =~ /^serverReport/" },
    { "command": "jasper.pasteServerResource", "key": "ctrl+v", "when": "explorerViewletFocus" },
    { "command": "jasper.copyServerResourcePath", "key": "ctrl+shift+c", "when": "view == jasper-servers" },
    { "command": "jasper.refreshServerTree", "key": "f5", "when": "view == jasper-servers" }
  ]
```

---

## 5. Comandos Novos
| Command | Title | When |
|---------|-------|------|
| `jasper.searchServerResources` | Buscar no JasperServer | `view == jasper-servers` |
| `jasper.copyServerResource` | Copiar Recurso | `view == jasper-servers && viewItem =~ /^serverReport/` |
| `jasper.pasteServerResource` | Colar Recurso do Servidor | `explorerViewletFocus` |
| `jasper.copyServerResourcePath` | Copiar Caminho no Servidor | `view == jasper-servers` |
| `jasper.toggleServerSelectionMode` | Alternar Modo Seleção | `view == jasper-servers` |
| `jasper.downloadSelectedServerResources` | Baixar Selecionados | `view == jasper-servers && selectionCount > 0` |

---

## 6. Critérios de Aceite
- [ ] `Ctrl+F` abre busca inline → filtra árvore em <50ms
- [ ] `Ctrl+C` em arquivo `.jrxml` no servidor → `Ctrl+V` no workspace salva arquivo local
- [ ] `F5` na TreeView recarrega do servidor mantendo expansão
- [ ] Breadcrumbs funcionam para navegação rápida
- [ ] Multi-select com checkboxes + barra de ações
- [ ] Zero chamadas REST durante busca (client-side only)
- [ ] Botão "Recarregar do Servidor" no header da TreeView

---

## 7. Arquivos a Criar/Modificar
| Arquivo | Tipo |
|---------|------|
| `src/providers/serverTreeProvider.ts` | Modificado (cache, filtro, breadcrumbs) |
| `src/controllers/serverSearchController.ts` | Novo |
| `src/controllers/serverClipboardController.ts` | Novo |
| `src/commands/serverCommands.ts` | Modificado (novos comandos) |
| `src/extension.ts` | Modificado (registro keybindings) |
| `package.json` | Modificado (keybindings, menus) |
| `src/providers/serverTreeProvider.ts` | Modificado (checkboxes, breadcrumbs) |