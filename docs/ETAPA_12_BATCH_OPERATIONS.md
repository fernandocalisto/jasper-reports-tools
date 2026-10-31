# Etapa 12: Batch Compile / Export (Operações em Lote)

---

## 1. Objetivo
Permitir compilar e/ou exportar múltiplos arquivos `.jrxml` de uma só vez, a partir de uma pasta do workspace ou seleção múltipla no Explorer, com progress bar, relatório final e paralelismo configurável.

---

## 2. Requisitos Funcionais

### 2.1 Comandos Principais
| Comando | Título | Descrição |
|---------|--------|-----------|
| `jasper.batchCompile` | Compilar em Lote | `.jrxml` → `.jasper` para múltiplos arquivos |
| `jasper.batchExport` | Exportar em Lote | `.jrxml` → `.pdf`/`.jasper`/`.jrprint` para múltiplos arquivos |

### 2.2 Entrada (Input)
| Origem | Detalhes |
|--------|----------|
| **Pasta do Workspace** | `--dir` ou seleção de pasta no Explorer → processa todos `.jrxml` recursivamente |
| **Multi-select no Explorer** | Seleção múltipla (Ctrl+Click / Shift+Click) de arquivos `.jrxml` |
| **Arquivo único** | Fallback: arquivo `.jrxml` ativo no editor |

### 2.3 Opções de Configuração
| Opção | CLI Flag | Padrão | Descrição |
|-------|----------|--------|-----------|
| Formato de saída | `--format` | `pdf` | `pdf` \| `jasper` \| `jrprint` |
| Diretório de saída | `--output-dir` | Mesma pasta do fonte | Onde salvar arquivos gerados |
| Recursivo | `--recursive` | `true` | Processar subpastas |
| Paralelismo | `--max-concurrent` | `3` | Máximo de processos simultâneos |
| Conexão ativa | (usa ativa) | — | Usa conexão JDBC ativa para `fill/export` |
| Parâmetros | `--params` | `{}` | JSON com parâmetros para `fill` |

### 2.4 Saída e Feedback
| Item | Detalhes |
|------|----------|
| **Progress Bar** | `vscode.window.withProgress` com contador `(X/Y) arquivo.jrxml` |
| **Relatório Final** | Toast + Output Channel: `Sucessos: X, Falhas: Y, Tempo: Zms` |
| **Output Channel** | Log detalhado por arquivo (sucesso/erro + tempo) |
| **Arquivo de Relatório** | Opcional: `batch-report-<timestamp>.json` no output-dir |

---

## 3. Requisitos Não-Funcionais
| Requisito | Especificação |
|-----------|---------------|
| **Paralelismo** | `Promise.all` com `p-limit` ou implementação própria (maxConcurrent) |
| **Cancelamento** | Botão "Cancelar" na progress bar → para próximos, finaliza atuais |
| **Erro isolado** | Falha em um arquivo não para os demais; registra erro e continua |
| **Arquivos grandes** | Stream de escrita, sem carregar tudo em memória |
| **Idempotência** | Re-executar sobre mesmos arquivos sobrescreve sem erro |

---

## 4. Arquitetura Técnica

### 4.1 RunnerService (Novos Métodos)
```typescript
interface BatchOptions {
  inputPaths: string[];           // Caminhos .jrxml absolutos
  format: 'pdf' | 'jasper' | 'jrprint';
  outputDir?: string;             // Default: dirname de cada arquivo
  recursive?: boolean;            // Default: true
  maxConcurrent?: number;         // Default: 3
  dbProfile?: DatabaseProfile;    // Conexão ativa
  password?: string;
  params?: Record<string, any>;
}

interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  results: BatchItemResult[];
  totalTimeMs: number;
}

interface BatchItemResult {
  inputPath: string;
  outputPath?: string;
  success: boolean;
  error?: string;
  executionTimeMs: number;
}

public async batchCompile(options: BatchOptions): Promise<BatchResult>;
public async batchExport(options: BatchOptions): Promise<BatchResult>;
```

### 4.2 CLI Java (Reutiliza Actions Existentes)
- `batchCompile` → itera arquivos → chama `--action compile` para cada
- `batchExport` → itera arquivos → chama `--action export` para cada
- **Opcional otimização**: Nova action `--action batch` no Java para processar em lote no mesmo JVM (evita overhead de múltiplos processos)

### 4.3 Paralelismo (TypeScript)
```typescript
async function processWithConcurrency<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  maxConcurrent: number
): Promise<R[]> {
  const executing: Promise<R>[] = [];
  const results: R[] = [];
  
  for (const item of items) {
    const promise = processor(item).then(result => {
      results.push(result);
      return result;
    });
    
    executing.push(promise);
    
    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
      // Remove completed
      const completedIdx = executing.findIndex(p => 
        results.some(r => r === p) // simplificado
      );
      // Implementação real usa array de promises e splice
    }
  }
  return Promise.all(executing).then(() => results);
}
```

---

## 5. Integração VS Code

### 5.1 Comandos (package.json)
```json
{
  "command": "jasper.batchCompile",
  "title": "Compilar em Lote",
  "category": "Jasper",
  "icon": "$(gear)",
  "keybindings": [{ "command": "jasper.batchCompile", "key": "ctrl+shift+alt+b", "when": "explorerViewletFocus" }]
},
{
  "command": "jasper.batchExport",
  "title": "Exportar em Lote (PDF/Jasper)",
  "category": "Jasper",
  "icon": "$(cloud-upload)",
  "keybindings": [{ "command": "jasper.batchExport", "key": "ctrl+shift+alt+e", "when": "explorerViewletFocus" }]
}
```

### 5.2 Menus
| Menu | When | Group |
|------|------|-------|
| `explorer/context` | `resourceExtname == .jrxml` | `1_jasper@6` |
| `explorer/context` | `viewItem == folder` | `1_jasper@6` |
| `view/title` (jasper-databases) | `view == jasper-databases` | `navigation@8` |

### 5.3 QuickPick de Opções (Opcional)
Ao invocar comando sem argumentos → abre QuickPick para escolher:
- Pasta vs Arquivos selecionados
- Formato (PDF/Jasper/Jrprint)
- Output dir
- Max concurrent

---

## 6. Critérios de Aceite

| Critério | Validação |
|----------|-----------|
| **Batch Compile pasta** | Seleciona pasta no Explorer → `jasper.batchCompile` → gera `.jasper` para todos `.jrxml` recursivamente |
| **Batch Export multi-select** | Seleciona 5 `.jrxml` no Explorer → `jasper.batchExport` → gera 5 PDFs no output-dir |
| **Progress Bar** | Mostra `(3/10) relatorio_03.jrxml` com barra de progresso |
| **Relatório Final** | Toast: `Batch Export concluído: 8 sucessos, 1 falha em 12.3s` |
| **Erro isolado** | 1 arquivo com erro de SQL → loga erro, continua processando os demais |
| **Cancelamento** | Clica "Cancelar" na progress bar → para próximos, finaliza atuais |
| **Paralelismo** | `maxConcurrent=3` → no máximo 3 processos `java -jar` simultâneos |
| **Output Channel** | Log detalhado por arquivo com tempo de execução |

---

## 7. Arquivos a Criar/Modificar

| Arquivo | Tipo |
|---------|------|
| `src/services/batchProcessor.ts` | **Novo** (orquestração, paralelismo, progress) |
| `src/services/runnerService.ts` | Modificado (métodos `batchCompile`, `batchExport`) |
| `src/commands/reportCommands.ts` | Modificado (comandos `batchCompile`, `batchExport`) |
| `src/extension.ts` | Modificado (registro) |
| `package.json` | Modificado (comandos, keybindings, menus) |
| `java-engine/.../CommandHandler.java` | Opcional: action `batch` para otimização |

---

## 8. Critérios de Validação Técnica

| Teste | Comando | Esperado |
|-------|---------|----------|
| Compilação TS | `npm run compile` | Exit code 0 |
| Batch Compile 10 arquivos | `jasper.batchCompile` em pasta com 10 `.jrxml` | 10 `.jasper` gerados, progress bar, toast final |
| Batch Export PDF | `jasper.batchExport --format pdf` em 5 arquivos | 5 PDFs no output-dir, progress bar |
| Erro isolado | 1 arquivo com query inválida + 4 válidos | 4 sucessos, 1 falha logada, processa todos |
| Paralelismo | `maxConcurrent=2` em 6 arquivos | Nunca mais de 2 processos `java` simultâneos |
| Cancelamento | Clicar "Cancelar" no meio | Para agendamento, finaliza atuais, relatório parcial |