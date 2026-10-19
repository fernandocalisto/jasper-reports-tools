# JasperReports Developer Tools

Extensão leve e profissional para o **Visual Studio Code** voltada à criação, manutenção, compilação, visualização (Split Preview PDF), inspeção de campos SQL e deploy de relatórios **JasperReports** (`.jrxml` e `.jasper`) — projetada para substituir o Jaspersoft Studio em ambientes corporativos e hospitalares com zero serviços em background (*Zero-Daemon*).

---

## Requisitos

- **Java 11+** (JRE ou JDK 11, 17 ou 21) configurado no `PATH` ou em `JAVA_HOME`
- **VS Code 1.85+**

---

## Instalação

1. Gere ou baixe o pacote `.vsix` (`jasper-reports-tools-0.1.0.vsix`).
2. No VS Code, acesse a aba **Extensões** (`Ctrl+Shift+X`) → menu **`...`** → **Instalar a partir de VSIX...** (`Install from VSIX...`).
3. Alternativamente, via terminal:
   ```bash
   code --install-extension jasper-reports-tools-0.1.0.vsix
   ```

---

## Configuração Rápida

1. Abra a view **JasperReports** na barra de atividades lateral esquerda do VS Code.
2. Em **Conexões de Banco de Dados**, clique em **`+` (Adicionar Nova Conexão)**:
   - Escolha **PostgreSQL**, **Oracle** (drivers já embutidos no motor) ou **Personalizado (JAR Externo)** para SQL Server, MySQL, Firebird, DB2, etc.
   - Clique em **Testar Conexão** e depois em **Salvar Conexão**.
3. Defina a conexão ativa clicando no ícone de check ao lado da conexão ou pelo item **`Jasper: <Conexão>`** na **Status Bar** inferior.
4. *(Opcional)* Em **JasperServer Explorer**, clique em **`+`** para cadastrar servidores JasperReports Server e navegar/publicar relatórios via REST API v2.

---

## Funcionalidades

- **Edição `.jrxml` de Alta Produtividade**:
  - **Validação XSD Oficial (`jasperreport.xsd` 6.21.x)**: validação em tempo real de tags e atributos obrigatórios (`reportElement`, `band`, `textField`, `parameter`, `field`, etc.).
  - **Autocomplete Inteligente (`CompletionItemProvider`)**:
    - Digite `$F{` para listar todos os campos (`<field>`) do relatório com tipo Java e descrição.
    - Digite `$P{` para listar todos os parâmetros (`<parameter>`) do relatório.
    - Digite `$V{` para listar variáveis (`<variable>`) e variáveis embutidas (`PAGE_NUMBER`, `PAGE_COUNT`, `REPORT_COUNT`, etc.).
    - Digite `.` após um campo/parâmetro/variável (ex.: `$F{NM_PACIENTE}.toUpp` ou `$F{VL_TOTAL}.add(`) para receber sugestões de métodos Java inferidos pelo tipo (`String`, `BigDecimal`, `Integer`, `Long`, `Double`, `Date`, `Timestamp`, `Boolean`).
    - Digite classes utilitárias estáticas (ex.: `Boolean.valueOf`, `Integer.parseInt`, `BigDecimal.ZERO`, `Math.round`, `DateUtils.addDays`, `JRExtendedUtils.formatCurrency`).
- **Preview Dividido (Split View com PDF.js)**:
  - Pressione `Ctrl+Shift+V` com um `.jrxml` aberto para abrir o painel de preview ao lado do código.
  - Formulário automático de parâmetros extraídos do `.jrxml`.
  - Renderização fiel via motor oficial JasperReports + PDF.js (suporta modo **Mock** sem banco via `JREmptyDataSource` ou execução real na conexão JDBC ativa).
  - **Live Reload**: recompila e atualiza o PDF automaticamente ao salvar (`Ctrl+S`).
- **Compilação Instantânea (`.jrxml` → `.jasper`)**:
  - Pressione `Ctrl+Shift+B` ou use o botão de engrenagem no topo do editor para gerar o binário `.jasper` no mesmo diretório.
  - Injeção automática de `SUBREPORT_DIR` e `REPORT_LOCALE` (`pt_BR`).
- **Field Viewer (Visualizador de Campos da Query)**:
  - Pressione `Ctrl+Shift+F` ou acesse **Jasper: Visualizar Campos da Query (Field Viewer)** no menu de contexto do editor `.jrxml`.
  - Exibe todos os `<field>` com **Field Name**, **Java Class**, **JDBC Type** e **Nullable**.
  - Botão **Atualizar Tipos no Banco** executa introspecção real (`--action inspect-query`) na conexão ativa sem varrer dados (`LIMIT 0` / `WHERE 1=0`).
  - Clique em qualquer linha para copiar `$F{NOME_DO_CAMPO}` ou `<field name="..." class="..."/>` para a área de transferência.
- **JasperServer Explorer (REST API v2)**:
  - Navegue por pastas e relatórios (`reportUnit`) diretamente pelo VS Code.
  - Baixe `.jrxml` do servidor para edição local, atualize o `.jrxml` remoto ou faça **Deploy direto de `.jasper`** compilado.

---

## Snippets Inclusos (`.jrxml` / XML)

| Prefixo | Descrição |
|---------|-----------|
| `jtf` | `<textField>` completo com `reportElement`, `textElement` e `textFieldExpression` |
| `jband` | `<band>` com `splitType="Stretch"` |
| `jparam` | `<parameter>` com `class`, `isForPrompting`, `parameterDescription` e `defaultValueExpression` |
| `jfield` | `<field>` com seletor de classes Java e `fieldDescription` |
| `jimg` | `<image>` com `onErrorType="Icon"` e `imageExpression` |
| `jsub` | `<subreport>` completo com `subreportParameter`, `connectionExpression` e `subreportExpression` |
| `jcurrency` | `<textField>` formatado para moeda brasileira (`R$ #,##0.00`) |
| `jdate` | `<textField>` formatado para data brasileira (`dd/MM/yyyy`) |
| `jpage` | `<pageFooter>` com numeração `Page $V{PAGE_NUMBER} of $V{PAGE_COUNT}` |
| `jstatic` | `<staticText>` completo com `reportElement`, `textElement` e `<text>` |
| `jvar` | `<variable>` com `calculation` e `variableExpression` |

---

## Atalhos de Teclado

| Ação | Atalho (Windows / Linux) | Atalho (macOS) |
|------|--------------------------|----------------|
| Compilar Relatório (`.jrxml` → `.jasper`) | `Ctrl+Shift+B` | `Cmd+Shift+B` |
| Abrir Preview Dividido (Split PDF) | `Ctrl+Shift+V` | `Cmd+Shift+V` |
| Abrir Field Viewer (Campos da Query) | `Ctrl+Shift+F` | `Cmd+Shift+F` |

---

## Segurança e Arquitetura

- **Segurança de Credenciais**: Nenhuma senha de banco de dados ou de JasperServer é gravada em texto plano ou em `settings.json`. Todas as senhas são armazenadas exclusivamente no cofre nativo do sistema operacional via `vscode.SecretStorage`.
- **Zero-Daemon**: Nenhum servidor fica residente em memória. O motor `bin/jasper-cli.jar` é executado sob demanda e encerrado imediatamente após cada operação.

---

## Troubleshooting

- **"JRE/JDK 11+ não foi encontrado no PATH"**: Instale o OpenJDK/Adoptium 11 ou superior e certifique-se de que `java -version` responde no terminal ou configure a variável de ambiente `JAVA_HOME`.
- **"Driver não encontrado"**: Para bancos diferentes de PostgreSQL e Oracle, selecione o driver **Personalizado (JAR Externo)** no cadastro da conexão e aponte para o arquivo `.jar` do fabricante (ex.: `mssql-jdbc.jar`, `mysql-connector-j.jar`).
- **PDF não renderiza ou erro de compilação JRXML**: Abra o painel **Output** (`Ctrl+Shift+U`) e selecione o canal **JasperReports** para visualizar o stack trace detalhado retornado pelo motor Java.
