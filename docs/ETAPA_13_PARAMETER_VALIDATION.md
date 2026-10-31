# Etapa 13: Parameter Validation UI (Validação Visual de Parâmetros)

---

## 1. Objetivo
Validar parâmetros do relatório **antes** de executar o preview/compilação, evitando round-trip de compilação falhada por parâmetro inválido. Exibir erros/avisos visuais no painel de preview e no Field Viewer.

---

## 2. Requisitos Funcionais

### 2.1 Validação Automática (Preview e Field Viewer)
| Trigger | Ação |
|---------|------|
| **Ao abrir Preview** | Valida parâmetros atuais contra metadados do `.jrxml` |
| **Ao alterar parâmetro** | Valida em tempo real (debounce 300ms) |
| **Botão "Validar"** | Executa validação completa sob demanda |

### 2.2 Tipos de Validação
| Tipo | Descrição | Severidade |
|------|-----------|------------|
| **Obrigatório** | Parâmetro `isForPrompting=true` sem valor | **Erro** |
| **Tipo** | Valor incompatível com `class` do parâmetro (`Integer`, `Date`, `BigDecimal`, `Boolean`, `String`) | **Erro** |
| **Formato Data** | `Date`/`Timestamp` fora do padrão `yyyy-MM-dd` ou `dd/MM/yyyy` | **Erro** |
| **Range Numérico** | `Integer`/`Long`/`BigDecimal` fora de `min`/`max` (se definido no JRXML) | **Aviso/Erro** |
| **Regex/Pattern** | String não casa com `pattern` (se definido) | **Aviso** |
| **Enum/Valores Permitidos** | Valor não está na lista de valores permitidos (se definido) | **Erro** |
| **Dependências** | Parâmetro condicional obrigatório apenas se outro tem valor X | **Aviso/Erro** |

### 2.3 UI de Validação
| Componente | Localização | Comportamento |
|------------|-------------|---------------|
| **Badge no header do Preview** | Toolbar do Preview | Ícone `error`/`warning` + contador; clique abre painel lateral |
| **Painel Lateral de Validação** | Preview Panel (lado direito) | Lista agrupada: Erros / Avisos; clique foca no campo |
| **Inline no Formulário** | Formulário de parâmetros | Borda vermelha/amarela no input + tooltip ao hover |
| **Resumo no Header** | Toolbar do Preview | `⚠ 2 erros, 1 aviso` + botão "Validar Agora" |

### 2.4 Validação no Field Viewer
- Ao abrir Field Viewer (`Ctrl+Shift+F`), valida se tipos dos fields batem com parâmetros esperados
- Mostra coluna "Validação" na tabela de fields: `OK` / `Tipo incompatível` / `Obrigatório`

---

## 3. Requisitos Não-Funcionais
| Requisito | Especificação |
|-----------|---------------|
| **Performance** | Validação debounce 300ms; não bloqueia UI |
| **Extensibilidade** | Validadores plugáveis (interface `ParameterValidator`) |
| **Cache** | Metadados de validação cacheados por arquivo `.jrxml` |
| **Configurável** | Usuário pode desativar validação automática nas settings |

---

## 4. Arquitetura Técnica

### 4.1 Novo Serviço: `ParameterValidator` (`src/services/parameterValidator.ts`)
```typescript
interface ValidationRule {
  type: 'required' | 'type' | 'format' | 'range' | 'pattern' | 'enum' | 'conditional';
  severity: 'error' | 'warning';
  message: string;
  validate: (value: any, context: ValidationContext) => boolean;
}

interface ValidationContext {
  parameter: JrxmlParameter;      // Metadados do parâmetro do JRXML
  allParameters: Record<string, any>;  // Todos valores atuais
  fields: JrxmlField[];           // Fields do relatório (para cross-ref)
}

interface ValidationResult {
  parameterName: string;
  rule: ValidationRule;
  passed: boolean;
  message: string;
  severity: 'error' | 'warning';
}

export class ParameterValidator {
  private rules: ValidationRule[] = [];
  private cache = new Map<string, ValidationRule[]>(); // key: jrxmlPath

  registerRule(rule: ValidationRule): void;
  validateAll(params: Record<string, any>, context: ValidationContext): ValidationResult[];
  validateSingle(paramName: string, value: any, context: ValidationContext): ValidationResult[];
  getCachedRules(jrxmlPath: string): ValidationRule[] | undefined;
  invalidateCache(jrxmlPath: string): void;
}
```

### 4.2 Regras Built-in (Registradas por Padrão)
```typescript
const BUILTIN_RULES: ValidationRule[] = [
  // Obrigatório
  { type: 'required', severity: 'error', validate: (v, ctx) => 
    ctx.parameter.isForPrompting && (v === undefined || v === '' || v === null) },
  
  // Tipo - Java primitives
  { type: 'type', severity: 'error', validate: (v, ctx) => 
    validateJavaType(v, ctx.parameter.className) },
  
  // Formato Data
  { type: 'format', severity: 'error', validate: (v, ctx) => 
    isJavaDateType(ctx.parameter.className) && isValidDateFormat(v) },
  
  // Range numérico
  { type: 'range', severity: 'warning', validate: (v, ctx) => 
    isNumericType(ctx.parameter.className) && inRange(v, ctx.parameter.min, ctx.parameter.max) },
  
  // Pattern/Regex
  { type: 'pattern', severity: 'warning', validate: (v, ctx) => 
    isStringType(ctx.parameter.className) && ctx.parameter.pattern && new RegExp(ctx.parameter.pattern).test(v) },
  
  // Enum
  { type: 'enum', severity: 'error', validate: (v, ctx) => 
    ctx.parameter.validValues && ctx.parameter.validValues.includes(v) },
];
```

### 4.3 Integração com Preview Panel
```typescript
// PreviewPanel.ts - integra validação
private async validateParameters(params: Record<string, any>): Promise<void> {
  const metadata = jrxmlParser.getMetadata(this.jrxmlPath);
  const context = { 
    parameters: metadata.parameters, 
    allParameters: params, 
    fields: metadata.fields 
  };
  
  const results = this.parameterValidator.validateAll(params, context);
  
  // Atualiza UI
  this.updateValidationUI(results);
  
  // Se houver erros, desabilita botão "Atualizar" ou mostra warning
  this.updateActionButtons(results);
}
```

### 4.4 Integração com Field Viewer
```typescript
// FieldViewerPanel.ts - adiciona coluna de validação
private renderFieldsWithValidation(fields: JrxmlField[], params: Record<string, any>): void {
  // Adiciona coluna "Validação" na tabela
  // Cross-referencia: field tipo vs parâmetro tipo esperado
}
```

---

## 4.4 Settings (Configuração do Usuário)
```json
// settings.json (contribuição)
{
  "jasper.validation.enabled": true,
  "jasper.validation.autoValidateOnPreviewOpen": true,
  "jasper.validation.debounceMs": 300,
  "jasper.validation.showWarningsAsErrors": false
}
```

---

## 5. Critérios de Aceite

| Critério | Validação |
|----------|-----------|
| **Validação automática ao abrir Preview** | Abre Preview → valida parâmetros → mostra badge `⚠ 2 erros` no header |
| **Validação em tempo real** | Digita valor inválido no campo → borda vermelha + tooltip em <300ms |
| **Erros bloqueiam execução** | Botão "Atualizar" desabilitado se houver erros; tooltip explica |
| **Avisos não bloqueiam** | Avisos mostram amarelo, mas permitem executar |
| **Painel lateral de validação** | Clique no badge → abre painel com lista agrupada Erros/Avisos |
| **Clique no erro foca campo** | Clica no item da lista → foca input correspondente no formulário |
| **Field Viewer mostra validação** | Coluna "Validação" na tabela de fields mostra `OK` / `Tipo incompatível` |
| **Settings respeitadas** | Desativar validação automática nas settings → não valida ao abrir |
| **Performance** | Validação de 20 parâmetros < 50ms; debounce 300ms não trava UI |

---

## 5. Arquivos a Criar/Modificar

| Arquivo | Tipo |
|---------|------|
| `src/services/parameterValidator.ts` | **Novo** (core validation engine) |
| `src/services/parameterValidatorRules.ts` | **Novo** (regras built-in) |
| `src/webviewPanels/previewPanel.ts` | Modificado (integra validação + UI) |
| `src/webviewPanels/fieldViewerPanel.ts` | Modificado (coluna validação) |
| `webviews/preview/` | Modificado (UI validação inline + painel lateral) |
| `webviews/field-viewer/` | Modificado (coluna validação) |
| `src/extension.ts` | Modificado (registro settings + validador) |
| `package.json` | Modificado (settings contribution) |

---

## 6. Critérios de Validação Técnica

| Teste | Comando | Esperado |
|-------|---------|----------|
| Compilação TS | `npm run compile` | Exit code 0 |
| Validação obrigatório | Abre preview sem parâmetro obrigatório | Badge `⚠ 1 erro`, botão Atualizar desabilitado |
| Validação tipo | Digita "abc" em campo Integer | Borda vermelha, tooltip "Esperado número inteiro" |
| Validação data | Digita "31/02/2024" em campo Date | Borda vermelha, tooltip "Data inválida" |
| Validação range | Digita 150 em campo 0-100 | Borda amarela, tooltip "Valor fora do range 0-100" |
| Validação regex | Digita "abc" em campo pattern `^\d+$` | Borda amarela, tooltip "Formato inválido" |
| Enum | Seleciona valor não listado | Borda vermelha, tooltip "Valor não permitido" |
| Field Viewer validação | Abre Field Viewer | Coluna "Validação" mostra status por field |
| Settings | Desativa `jasper.validation.enabled` | Não valida ao abrir preview |
| Performance | 20 parâmetros | Validação < 50ms |