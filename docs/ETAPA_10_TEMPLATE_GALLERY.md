# Etapa 10: Template Gallery (Análise de Viabilidade)

---

## 1. Conceito
Galeria visual de templates prontos (relatórios hospitalares, financeiros, etiquetas, cartas, dashboards) que o usuário pode inserir no workspace com um clique.

---

## 2. Análise de Viabilidade (Por Que Pode Ser Ruim)

### ✅ Prós
- **Onboarding rápido**: Usuário novo vê relatório funcionando em segundos
- **Padronização**: Templates seguem boas práticas (bands, fontes, márgenes)
- **Snippets visuais**: Melhor que snippets de texto para iniciantes

### ❌ Contras (Peso Real)
| Problema | Impacto |
|----------|---------|
| **Manutenção** | Templates quebram a cada versão do JasperReports / mudança de schema |
| **Diversidade** | Hospitalar ≠ Financeiro ≠ Logística ≠ Varejo → centenas de variações |
| **Customização** | Template "pronto" sempre precisa ajustes → usuário edita XML anyway |
| **Tamanho** | Templates com imagens/fontes → `.vsix` inchado |
| **Atualização** | Como versionar templates? Marketplace não suporta assets versionados separados |
| **Uso real** | Usuários experientes *nunca* usam templates; novatos usam uma vez |

### 🎯 Veredito
**Não implementar como feature nativa da extensão.**

**Alternativa melhor**: Documentação + Repositório GitHub separado (`jasper-templates`) com:
- Templates versionados independentemente
- Issues/PRs da comunidade
- Raw GitHub URLs para download direto no VS Code
- Zero manutenção no core da extensão

---

## 3. Alternativa Implementável (Leve)
Se quiser *alguma* coisa no produto:

### 3.1 Comando `jasper.openTemplateGallery`
- Abre página Web (GitHub Pages / docs site) com cards de templates
- Cada card: preview PNG + botão "Baixar" → baixa `.jrxml` para workspace
- Zero assets no `.vsix`

### 3.2 Snippets Avançados (Já existe em Etapa 6)
- `jtf`, `jband`, `jparam`, `jsub`, `jcurrency`, `jdate` → cobrem 80% dos casos
- Expansíveis pelo usuário via `snippets/jasper-snippets.json`

---

## 4. Decisão Final

| Opção | Decisão |
|-------|---------|
| Gallery nativa com assets | ❌ **Não** |
| Gallery web externa (GitHub Pages) | ✅ **Opcional, baixo esforço** |
| Snippets + Documentação | ✅ **Já feito (Etapa 6)** |
| Template Gallery como feature core | ❌ **Não** |

---

## 5. Conclusão
**Não criar markdown de implementação.**  
A feature não justifica o custo de manutenção. O que usuários precisam:
1. **Bons snippets** (já têm)
2. **Documentação clara** (README + Wiki)
3. **Exemplos no GitHub** (repositório separado)

---

## 6. Ação Recomendada
- Criar repo separado: `github.com/fernandocalisto/jasper-templates`
- Popular com 5-10 templates referência (hospitalar, financeiro, etiqueta)
- Linkar no README da extensão: "Templates prontos → [aqui](link)"
- Fechar esta etapa como "Won't Fix" no backlog