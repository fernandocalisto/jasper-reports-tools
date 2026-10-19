# JasperReports Developer Tools

Lightweight, professional **Visual Studio Code** extension for creating, maintaining, compiling, previewing, and deploying **JasperReports** (`.jrxml` and `.jasper`). Built to **replace Jaspersoft Studio** in corporate/hospital environments — zero background services (*Zero-Daemon*), native editing, real-time PDF preview, secure DB connections, and JasperServer deployment.

---

## 🇧🇷 Versão em Português

**Ferramenta leve e profissional para o Visual Studio Code voltada à criação, manutenção, compilação, visualização (Split Preview PDF), inspeção de campos SQL e deploy de relatórios JasperReports (`.jrxml` e `.jasper`) — projetada para substituir o Jaspersoft Studio em ambientes corporativos e hospitalares com zero serviços em background (*Zero-Daemon*).**

---

## Why This Exists / Por Que Existe

**Jaspersoft Studio is a pain:**
- Based on Eclipse, heavy, slow, memory-hungry
- Constant crashes, UI freezes, broken perspectives
- Requires a running server/daemon just to compile
- Terrible Git integration, awful diff experience
- No native dark theme, feels like 2005

**This extension fixes it:**
- Runs inside VS Code (your editor, your theme, your workflow)
- On-demand Java execution — no daemon, no open ports, no RAM waste
- Real PDF preview with live parameters + live reload on save
- Secure credential storage (OS keyring, never plaintext)
- JasperServer integration via REST API v2 (browse, download, deploy, create)
- Smart autocomplete for `$F{}`, `$P{}`, `$V{}` + Java/Groovy methods

---

## Requirements / Requisitos

- **Java 11+** (JRE or JDK 11, 17, 21) on `PATH` or `JAVA_HOME`
- **VS Code 1.85+**

---

## Installation / Instalação

```bash
# Via VS Code UI
# Extensions → ... → Install from VSIX... → jasper-reports-tools-0.1.0.vsix

# Or CLI
code --install-extension jasper-reports-tools-0.1.0.vsix
```

---

## Quick Start / Configuração Rápida

1. Open **JasperReports** view in Activity Bar (left sidebar)
2. **Database Connections** → `+` → choose **PostgreSQL**, **Oracle** (built-in drivers) or **Custom JAR** (SQL Server, MySQL, Firebird, DB2...)
3. Click **Test Connection** → **Save**
4. Set as active via check icon or Status Bar item `Jasper: <Connection>`
5. *(Optional)* **JasperServer Explorer** → `+` → add server URL/org/user/pass → browse/deploy

---

## Features / Funcionalidades

| Feature | Description / Descrição |
|---------|-------------------------|
| **Smart `.jrxml` Editing** | Official XSD 6.21.x validation, snippets (`jtf`, `jband`, `jparam`...), language config |
| **Completion Provider** | `$F{` → fields, `$P{` → parameters, `$V{` → variables; `.` after field → Java methods by inferred type (`String`, `BigDecimal`, `Date`, `Integer`...); static members (`Boolean.valueOf`, `DateUtils.addDays`, `JRExtendedUtils.formatCurrency`...) |
| **Split Preview (PDF.js)** | `Ctrl+Shift+V` — side panel with live parameter form, real JasperReports rendering, **Live Reload** on `Ctrl+S` |
| **Field Viewer** | `Ctrl+Shift+F` — lists all `<field>` with Java Class + JDBC Type + Nullable; click copies `$F{FIELD}`; **Refresh from DB** runs `--action inspect-query` (no data scan) |
| **One-Click Compile** | `Ctrl+Shift+B` → `.jrxml` → `.jasper` (auto `SUBREPORT_DIR`, `REPORT_LOCALE=pt_BR`) |
| **JasperServer Explorer** | Browse folders/reports, download `.jrxml`, update remote, **deploy compiled `.jasper`**, **create new `.jrxml`** |
| **Zero-Daemon** | No background process; `bin/jasper-cli.jar` runs on-demand and exits |
| **Secure Secrets** | Passwords only in OS keyring via `vscode.SecretStorage` (Windows Credential Manager / macOS Keychain / Linux Secret Service) |

---

## Snippets (prefix → expansion)

| Prefix | Description |
|--------|-------------|
| `jtf` | `<textField>` with `reportElement`, `textElement`, `textFieldExpression` |
| `jband` | `<band splitType="Stretch">` |
| `jparam` | `<parameter>` with class, prompt, default value |
| `jfield` | `<field>` with class selector |
| `jimg` | `<image onErrorType="Icon">` |
| `jsub` | `<subreport>` with parameters & connection |
| `jcurrency` | Currency formatted `R$ #,##0.00` (BR) |
| `jdate` | Date formatted `dd/MM/yyyy` (BR) |
| `jpage` | Page footer with `$V{PAGE_NUMBER} of $V{PAGE_COUNT}` |
| `jstatic` | `<staticText>` complete |
| `jvar` | `<variable>` with calculation |

---

## Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|--------|-----------------|-------|
| Compile Report | `Ctrl+Shift+B` | `Cmd+Shift+B` |
| Open Split Preview | `Ctrl+Shift+V` | `Cmd+Shift+V` |
| Open Field Viewer | `Ctrl+Shift+F` | `Cmd+Shift+F` |

---

## Security & Architecture

- **Credentials**: Never in plaintext, never in `settings.json`, never in Git. Only in OS keyring (`vscode.SecretStorage`).
- **Zero-Daemon**: No resident process. `bin/jasper-cli.jar` (fat JAR ~45MB with JasperReports 6.21.3, PostgreSQL, Oracle, Picocli, Jackson) runs on-demand via `child_process.execFile`, exits immediately.
- **Drivers**: PostgreSQL & Oracle bundled. Custom driver via JAR path + class name (loaded via `URLClassLoader` isolation).
- **JasperServer**: Pure REST API v2 (Node.js `fetch`), no Java involved.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Java not found` | Install JDK 11+ (Adoptium/OpenJDK), ensure `java -version` works or set `JAVA_HOME` |
| `Driver not found` | Use **Custom JAR** driver type, point to vendor `.jar` (mssql, mysql, firebird...) |
| PDF won't render / compile error | Open **Output** → **JasperReports** channel for full stack trace |

---

## License

MIT — see [LICENSE](LICENSE)

---

## Contributing

PRs welcome. For major changes, open an issue first.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md)
