# Etapa 8: Decompile .jasper → .jrxml (Preservando Formatação Original)

---

## 1. Objetivo
Implementar descompilação de relatórios compilados (`.jasper`, binário serializado Java) para XML fonte (`.jrxml`), **preservando ao máximo a formatação textual original** (indentação, ordem de atributos, comentários, quebras de linha).

---

## 2. Requisitos Funcionais

### 2.1 CLI Java (`jasper-cli.jar`)
Nova action:
```bash
java -jar jasper-cli.jar --action decompile \
  --input "report.jasper" \
  --output "report.jrxml"
```

### 2.2 Comando VS Code
- **Comando**: `jasper.decompileJasper`
- **Atalho**: `Ctrl+Shift+D` (quando editor tem `.jasper` ativo)
- **Context Menu**: Botão direito em `.jasper` no Explorer → "Descompilar para .jrxml"
- **Output**: Salva `.jrxml` no mesmo diretório (ou prompt se já existe)

### 2.3 Preservação de Formatação (Requisito Crítico)
O `.jasper` é um objeto Java serializado — **não guarda formatação XML original**. A descompilação **reconstrói** o XML a partir do objeto em memória.

**Estratégia para melhor fidelidade:**
1. **JRXmlWriter padrão** → XML válido, mas formatação genérica (indentação 2 espaços, ordem alfabética de atributos)
2. **Pretty-print customizado** → Reindentação inteligente, ordem lógica de elementos (queryString primeiro, depois fields, parameters, variables, bands)
3. **Opção `--preserve-original`** (futuro): se houver `.jrxml` lado a lado, usar como base e apenas atualizar diferenças (diff/patch)

**MVP**: XML válido, bem indentado, ordem lógica, encoding UTF-8.

---

## 2. Requisitos Não-Funcionais
- **Validação**: `.jrxml` gerado deve compilar novamente sem erros (`jasper-cli.jar --action compile`)
- **Round-trip**: `.jrxml` → compile → `.jasper` → decompile → `.jrxml` → compilar novamente = sucesso
- **Encoding**: UTF-8 sem BOM
- **Encoding de caracteres especiais**: `<`, `>`, `&`, `"`, `&apos;` corretamente escapados

---

## 3. Arquitetura Técnica

### 3.1 Java CLI (`java-engine/src/main/java/com/jasper/cli/`)
| Arquivo | Mudança |
|---------|---------|
| `Main.java` | Nova action `decompile` no Picocli |
| `CommandHandler.java` | Método `handleDecompile(input, output)` |
| `JasperProcessor.java` | Método `decompileReport(inputPath, outputPath)` usando `JRXmlWriter` |
| `OutputPayload.java` | Suporta action `decompile` no JSON de resposta |

### 3.2 JRXmlWriter Usage
```java
JasperReport jasperReport = (JasperReport) JRLoader.loadObject(inputFile);
try (FileOutputStream fos = new FileOutputStream(outputFile);
     OutputStreamWriter osw = new OutputStreamWriter(fos, StandardCharsets.UTF_8)) {
    JRXmlWriter.writeReport(jasperReport, osw, "UTF-8");
}
```

### 3.2 Pretty-Print Pós-Processamento (Opcional MVP)
- Parse XML gerado → `Document` (DOM) → `Transformer` com:
  - `indent = "yes"`
  - `indent-amount = "2"`
  - Ordem fixa de elementos filhos de `<jasperReport>`

---

## 3. Integração TypeScript (VS Code)

### 3.1 RunnerService (`runnerService.ts`)
```typescript
public async decompileReport(
  jasperPath: string,
  outputPath?: string
): Promise<CliSuccessResponse> {
  const args = ['--action', 'decompile', '--input', jasperPath];
  if (outputPath) args.push('--output', outputPath);
  return this.executeCli(args, undefined, path.dirname(jasperPath));
}
```

### 3.2 Commands (`reportCommands.ts`)
```typescript
export const decompileJasperCmd = vscode.commands.registerCommand(
  'jasper.decompileJasper',
  async (uri?: vscode.Uri) => {
    const filePath = resolveTargetJasperPath(uri); // .jasper ativo ou seleção no explorer
    const output = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(filePath.replace(/\.jasper$/, '.jrxml')),
      filters: { 'JRXML': ['jrxml'] }
    });
    if (!output) return;
    await runnerService.decompileReport(filePath, output.fsPath);
    const doc = await vscode.workspace.openTextDocument(output);
    await vscode.window.showTextDocument(doc);
  }
);
```

### 3.3 Package.json
```json
{
  "command": "jasper.decompileJasper",
  "title": "Descompilar .jasper para .jrxml",
  "category": "Jasper",
  "icon": "$(arrow-down)",
  "keybindings": [{ "command": "jasper.decompileJasper", "key": "ctrl+shift+d", "when": "resourceExtname == .jasper" }]
}
```

---

## 4. Critérios de Aceite
- [ ] `java -jar jasper-cli.jar --action decompile --input r.jasper --output r.jrxml` → XML válido
- [ ] Round-trip: `.jrxml` → compile → `.jasper` → decompile → `.jrxml` → compile = sucesso
- [ ] Comando `jasper.decompileJasper` abre `.jrxml` no editor após descompilar
- [ ] Atalho `Ctrl+Shift+D` em arquivo `.jasper` funciona
- [ ] Context menu no Explorer para `.jasper` mostra "Descompilar para .jrxml"
- [ ] XML gerado tem indentação consistente, UTF-8, elementos em ordem lógica

---

## 4. Arquivos a Criar/Modificar

### Java
| Arquivo | Tipo |
|---------|------|
| `java-engine/src/main/java/com/jasper/cli/Main.java` | Modificado (action decompile) |
| `java-engine/src/main/java/com/jasper/cli/CommandHandler.java` | Modificado (handleDecompile) |
| `java-engine/src/main/java/com/jasper/cli/JasperProcessor.java` | Modificado (decompileReport) |
| `java-engine/src/main/java/com/jasper/cli/OutputPayload.java` | Modificado (action decompile) |

### TypeScript
| Arquivo | Tipo |
|---------|------|
| `src/services/runnerService.ts` | Modificado (decompileReport) |
| `src/commands/reportCommands.ts` | Modificado (decompileJasperCmd) |
| `package.json` | Modificado (command, keybinding, menu) |
| `src/extension.ts` | Modificado (registro) |