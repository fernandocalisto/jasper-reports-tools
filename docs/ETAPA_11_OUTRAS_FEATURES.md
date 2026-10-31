# Etapa 11: Outras Features Vale-À-Pena (Backlog Priorizado)

---

## 1. Features Aprovadas (Alto Valor / Baixo-Médio Esforço)

### 1.1 Batch Compile / Export (Lote)
**Objetivo**: Compilar/exportar múltiplos `.jrxml` de uma vez.

| Feature | Detalhes |
|---------|----------|
| **Comando** | `jasper.batchCompile` / `jasper.batchExport` |
| **Input** | Pasta (workspace) ou multi-select no Explorer |
| **Opções** | `--format pdf|jasper|jrprint`, `--output-dir`, `--recursive` |
| **Output** | Progress bar + relatório final (sucessos/falhas) |
| **Paralelismo** | `maxConcurrent` configurável (padrão: 3) |

**Use case**: Deploy de 50 relatórios de uma vez antes de release.

---

### 1.2 Parameter Validation UI (Validação Visual de Parâmetros)
**Objetivo**: Validar parâmetros **antes** de executar o preview.

| Feature | Detalhes |
|---------|----------|
| **Trigger** | Automático ao abrir preview ou botão "Validar" |
| **Checks** | Tipos compatíveis, obrigatórios preenchidos, ranges, regex, datas válidas |
| **UI** | Painel lateral com lista de problemas (erro/aviso) + botão "Ir para campo" |
| **Integração** | Usa `jrxmlParser.getMetadata()` + tipos inferidos |

**Valor**: Evita round-trip de compilação falhada por parâmetro errado.

---

### 1.3 Report Diff / Compare
**Objetivo**: Comparar dois relatórios (`.jrxml` ou `.jasper`) visualmente.

| Feature | Detalhes |
|---------|----------|
| **Comando** | `jasper.compareReports` (duas seleções no Explorer) |
| **UI** | WebView lado a lado (diff2html) ou inline no editor |
| **Escopo** | Estrutura (bands, elementos), queries, parâmetros, campos, estilos |
| **Filtro** | Ignorar whitespace, ordenação de atributos, UUIDs |

**Use case**: Code review de relatório, auditoria de mudanças em produção.

---

### 1.4 JasperServer Scheduler Integration
**Objetivo**: Agendar execuções no JasperServer direto do VS Code.

| Feature | Detalhes |
|---------|----------|
| **Comando** | `jasper.scheduleReport` (clique direito em relatório no Server Explorer) |
| **UI** | WebView: frequência (cron), parâmetros, destinatários email, formato saída |
| **API** | `POST /rest_v2/jobs` + `PUT /rest_v2/jobs/{id}/trigger` |
| **Listagem** | TreeView "Jobs Agendados" com status (próxima execução, última execução) |

**Valor**: Elimina ida ao portal web do JasperServer.

---

## 2. Features "Nice to Have" (Médio Valor / Médio-Alto Esforço)

### 2.1 Report Version History (JasperServer)
- TreeView: clique direito em relatório → "Ver Histórico"
- Lista versões: número, autor, data, comentário
- Ações: baixar versão, restaurar versão, diff com atual

### 2.2 Export to PNG/HTML/Excel/CSV (Além de PDF)
- CLI: `--format png|html|xlsx|csv`
- Preview: abas para alternar formato

### 2.3 Custom Font Manager
- UI para adicionar/remover fontes TTF no JasperReports
- Preview de fonte no editor de expressão/estilo
- Auto-register no `jasperreports_extension.properties`

### 2.2 Data Source Explorer (Além de JDBC)
- Suporte a: JSON, XML, CSV, JavaBean, Hibernate, BigQuery
- Wizard de criação de Data Adapter no JasperServer

---

## 3. Features "Research Needed" (Alto Esforço / Incerto)

| Feature | Por Que Esperar |
|---------|-----------------|
| **Groovy Language Server Integration** | Depende de `groovy-language-server` maduro; hoje instável |
| **Visual Report Designer (WYSIWYG)** | Escopo enorme; concorre com Jaspersoft Studio; melhor contribuir pro JR |
| **AI-Assisted Report Generation** | Experimental; precisa modelo fino-tunado em JRXML |
| **Real-time Collaboration** | Requer backend; fora do escopo "local-first" |

---

## 4. Priorização Sugerida (Próximos 3 Meses)

| Sprint | Feature | Esforço | Valor |
|--------|---------|---------|-------|
| 1 | **Batch Compile/Export** | 2 dias | Alto |
| 2 | **Parameter Validation UI** | 3 dias | Alto |
| 3 | **Report Diff** | 4 dias | Médio |
| 4 | **JasperServer Scheduler** | 5 dias | Médio |
| 5+ | Report History / Export Formats | — | Nice |

---

## 5. Próximos Passos
1. **Aprovar priorização** acima
2. Criar `ETAPA_12_BATCH_OPERATIONS.md` + `ETAPA_13_PARAM_VALIDATION.md` + `ETAPA_14_REPORT_DIFF.md` + `ETAPA_15_SCHEDULER.md` quando for iniciar
3. **Não iniciar** Template Gallery, Visual Designer, AI features

---

## 6. Decisão: Template Gallery
**Status**: **Won't Fix** (documentado em `ETAPA_10_TEMPLATE_GALLERY.md`)  
**Alternativa**: Repo GitHub separado `jasper-templates` + link no README.