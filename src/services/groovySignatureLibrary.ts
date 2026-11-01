import * as vscode from 'vscode';
import {
  JAVA_STANDARD_LIBRARY,
  JAVA_STATIC_MEMBERS,
  JavaMember
} from './javaSignatureLibrary';
import { JrxmlField, JrxmlMetadata, JrxmlParameter, JrxmlVariable } from './jrxmlParser';

export interface GroovyMember extends JavaMember {
  returnType?: string;
  insertText?: string;
  isGroovyOnly?: boolean;
  category?: 'java' | 'groovy-gdk' | 'groovy-operator' | 'jasper-builtin' | 'static';
}

export interface GroovyOperatorInfo {
  operator: string;
  label: string;
  signature: string;
  description: string;
  doc: string;
  insertText: string;
  returnType?: string;
}

export interface ExpressionSnippetDefinition {
  prefix: string;
  label: string;
  description: string;
  expansion: string;
  doc: string;
  expectedType?: string;
}

/**
 * Variáveis nativas (built-in) do JasperReports sempre disponíveis em `$V{...}`.
 */
export const JASPER_BUILTIN_VARIABLES: JrxmlVariable[] = [
  {
    name: 'PAGE_NUMBER',
    className: 'java.lang.Integer',
    description: 'Número da página atual (ou total de páginas quando evaluationTime="Report")'
  },
  {
    name: 'PAGE_COUNT',
    className: 'java.lang.Integer',
    description: 'Quantidade de registros processados na página atual'
  },
  {
    name: 'COLUMN_NUMBER',
    className: 'java.lang.Integer',
    description: 'Número da coluna atual no layout multi-colunas'
  },
  {
    name: 'COLUMN_COUNT',
    className: 'java.lang.Integer',
    description: 'Quantidade de registros processados na coluna atual'
  },
  {
    name: 'REPORT_COUNT',
    className: 'java.lang.Integer',
    description: 'Total acumulado de registros processados no relatório'
  },
  {
    name: 'MASTER_CURRENT_PAGE',
    className: 'java.lang.Integer',
    description: 'Número da página atual do relatório mestre'
  },
  {
    name: 'MASTER_TOTAL_PAGES',
    className: 'java.lang.Integer',
    description: 'Total de páginas do relatório mestre'
  }
];

/**
 * Parâmetros nativos (built-in) do JasperReports sempre disponíveis em `$P{...}`.
 */
export const JASPER_BUILTIN_PARAMETERS: JrxmlParameter[] = [
  {
    name: 'SUBREPORT_DIR',
    className: 'java.lang.String',
    defaultValue: './',
    description: 'Diretório base dos subrelatórios (.jasper)',
    isForPrompting: false
  },
  {
    name: 'REPORT_CONNECTION',
    className: 'java.sql.Connection',
    description: 'Conexão JDBC ativa utilizada pelo relatório',
    isForPrompting: false
  },
  {
    name: 'REPORT_DATA_SOURCE',
    className: 'net.sf.jasperreports.engine.JRDataSource',
    description: 'Fonte de dados principal do relatório',
    isForPrompting: false
  },
  {
    name: 'REPORT_LOCALE',
    className: 'java.util.Locale',
    description: 'Locale de execução do relatório (ex: pt_BR)',
    isForPrompting: false
  },
  {
    name: 'REPORT_TIME_ZONE',
    className: 'java.util.TimeZone',
    description: 'Fuso horário utilizado na formatação de datas',
    isForPrompting: false
  },
  {
    name: 'REPORT_PARAMETERS_MAP',
    className: 'java.util.Map',
    description: 'Mapa contendo todos os parâmetros passados ao relatório',
    isForPrompting: false
  },
  {
    name: 'IS_IGNORE_PAGINATION',
    className: 'java.lang.Boolean',
    defaultValue: 'false',
    description: 'Se true, gera o relatório em uma única página contínua',
    isForPrompting: false
  }
];

/**
 * Snippets de Expressão exigidos na Etapa 9 (3.4 Snippets de Expressão).
 */
export const EXPRESSION_SNIPPETS: ExpressionSnippetDefinition[] = [
  {
    prefix: 'if',
    label: 'if — Ternário Null-Check',
    description: 'Verifica se o campo não é nulo antes de exibir',
    expansion: '$F{CAMPO} != null ? $F{CAMPO} : ""',
    doc: 'Expande uma expressão condicional ternária verificando se `$F{CAMPO}` é diferente de `null`.',
    expectedType: 'java.lang.Object'
  },
  {
    prefix: 'fmt',
    label: 'fmt — Formatar Data (SimpleDateFormat)',
    description: 'Formata data no padrão brasileiro dd/MM/yyyy',
    expansion: 'new java.text.SimpleDateFormat("dd/MM/yyyy").format($F{DATA})',
    doc: 'Formata um campo do tipo `java.util.Date` ou `java.sql.Timestamp` como `dd/MM/yyyy`.',
    expectedType: 'java.lang.String'
  },
  {
    prefix: 'money',
    label: 'money — Formatar Valor Monetário (DecimalFormat)',
    description: 'Formata número/BigDecimal no padrão #,##0.00',
    expansion: 'new java.text.DecimalFormat("#,##0.00").format($F{VALOR})',
    doc: 'Formata um valor numérico (`BigDecimal`, `Double`, `Number`) com duas casas decimais e separador de milhar.',
    expectedType: 'java.lang.String'
  },
  {
    prefix: 'nullsafe',
    label: 'nullsafe — Navegação Segura Groovy (?. / ?:)',
    description: 'Converte para String com operador seguro ?. e Elvis ?:',
    expansion: '$F{CAMPO}?.toString() ?: ""',
    doc: 'Usa os operadores Groovy Safe Navigation (`?.`) e Elvis (`?:`) para evitar `NullPointerException`.',
    expectedType: 'java.lang.String'
  },
  {
    prefix: 'cond',
    label: 'cond — Condicional Booleano SIM / NÃO',
    description: 'Retorna "SIM" ou "NÃO" conforme condição booleana',
    expansion: '$F{COND} ? "SIM" : "NÃO"',
    doc: 'Avalia uma condição booleana e retorna `"SIM"` quando verdadeira ou `"NÃO"` quando falsa.',
    expectedType: 'java.lang.String'
  }
];

/**
 * Operadores específicos da linguagem Groovy para expressões JasperReports.
 */
export const GROOVY_OPERATORS: GroovyOperatorInfo[] = [
  {
    operator: '?.',
    label: '?. (Safe Navigation)',
    signature: 'objeto?.metodo()',
    description: 'Navegação segura contra null (Groovy)',
    doc: 'Evita `NullPointerException`: se a expressão à esquerda for `null`, retorna `null` sem avaliar o membro à direita.',
    insertText: '?.',
    returnType: 'java.lang.Object'
  },
  {
    operator: '?:',
    label: '?: (Elvis Operator)',
    signature: 'valor ?: valorPadrao',
    description: 'Operador Elvis — fallback se null/falsy (Groovy)',
    doc: 'Retorna o operando da esquerda se não for `null` (e verdadeiro segundo Groovy Truth); caso contrário retorna o operando da direita.',
    insertText: ' ?: ',
    returnType: 'java.lang.Object'
  },
  {
    operator: '*.',
    label: '*. (Spread-Dot)',
    signature: 'colecao*.propriedade',
    description: 'Aplica propriedade/método a cada item da coleção (Groovy)',
    doc: 'Equivalente a `colecao.collect { it?.propriedade }`. Extrai um atributo de todos os elementos de uma lista.',
    insertText: '*.',
    returnType: 'java.util.List'
  },
  {
    operator: '**. ',
    label: '** (Spread-All / Power)',
    signature: 'objeto.**propriedade / base ** exp',
    description: 'Busca profunda ou exponenciação em Groovy',
    doc: 'Operador Groovy de busca recursiva de propriedades ou potência numérica.',
    insertText: '**',
    returnType: 'java.lang.Object'
  },
  {
    operator: '<=>',
    label: '<=> (Spaceship)',
    signature: 'a <=> b',
    description: 'Comparação null-safe compareTo (-1, 0, 1)',
    doc: 'Delega para `compareTo` de forma segura para `null`: retorna `-1` se `a < b`, `0` se `a == b`, ou `1` se `a > b`.',
    insertText: ' <=> ',
    returnType: 'java.lang.Integer'
  },
  {
    operator: '==~',
    label: '==~ (Regex Match)',
    signature: 'texto ==~ /padrao/',
    description: 'Verifica match exato de Regex (boolean)',
    doc: 'Retorna `true` se a string corresponder integralmente à expressão regular informada.',
    insertText: ' ==~ ',
    returnType: 'java.lang.Boolean'
  },
  {
    operator: '=~',
    label: '=~ (Regex Find)',
    signature: 'texto =~ /padrao/',
    description: 'Cria Matcher para busca de Regex',
    doc: 'Cria um `java.util.regex.Matcher` que pode ser avaliado em contexto booleano.',
    insertText: ' =~ ',
    returnType: 'java.util.regex.Matcher'
  }
];

/**
 * Métodos GDK (Groovy Development Kit) estendidos por tipo Java.
 */
export const GROOVY_GDK_METHODS: Record<string, GroovyMember[]> = {
  'java.lang.Object': [
    {
      name: 'collect',
      kind: vscode.CompletionItemKind.Method,
      signature: 'collect { it -> ... }: List',
      description: 'Transforma elementos (map Groovy)',
      doc: 'Itera sobre o objeto/coleção aplicando a closure a cada elemento e retornando uma nova `List` com os resultados.',
      returnType: 'java.util.List',
      insertText: 'collect { it }',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'findAll',
      kind: vscode.CompletionItemKind.Method,
      signature: 'findAll { it -> ... }: Collection',
      description: 'Filtra elementos (filter Groovy)',
      doc: 'Retorna todos os elementos que satisfazem a condição booleana da closure.',
      returnType: 'java.util.List',
      insertText: 'findAll { it != null }',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'find',
      kind: vscode.CompletionItemKind.Method,
      signature: 'find { it -> ... }: Object',
      description: 'Encontra primeiro elemento correspondente',
      doc: 'Retorna o primeiro elemento que satisfaz o predicado da closure, ou `null`.',
      returnType: 'java.lang.Object',
      insertText: 'find { it != null }',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'sum',
      kind: vscode.CompletionItemKind.Method,
      signature: 'sum(): Object',
      description: 'Soma elementos da coleção (Groovy)',
      doc: 'Soma os elementos da coleção ou o resultado da closure aplicada a cada item.',
      returnType: 'java.math.BigDecimal',
      insertText: 'sum()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'groupBy',
      kind: vscode.CompletionItemKind.Method,
      signature: 'groupBy { it -> ... }: Map',
      description: 'Agrupa elementos por chave (Groovy)',
      doc: 'Agrupa os elementos de uma coleção em um `Map` usando o retorno da closure como chave.',
      returnType: 'java.util.Map',
      insertText: 'groupBy { it }',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'any',
      kind: vscode.CompletionItemKind.Method,
      signature: 'any { it -> ... }: boolean',
      description: 'Algum elemento satisfaz condição',
      doc: 'Retorna `true` se pelo menos um elemento satisfizer o predicado.',
      returnType: 'java.lang.Boolean',
      insertText: 'any { it != null }',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'every',
      kind: vscode.CompletionItemKind.Method,
      signature: 'every { it -> ... }: boolean',
      description: 'Todos os elementos satisfazem condição',
      doc: 'Retorna `true` se todos os elementos satisfizerem o predicado.',
      returnType: 'java.lang.Boolean',
      insertText: 'every { it != null }',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'with',
      kind: vscode.CompletionItemKind.Method,
      signature: 'with { ... }: Object',
      description: 'Executa closure no contexto do objeto',
      doc: 'Permite acessar propriedades e métodos do objeto diretamente dentro do bloco closure.',
      returnType: 'java.lang.Object',
      insertText: 'with { it }',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'asBoolean',
      kind: vscode.CompletionItemKind.Method,
      signature: 'asBoolean(): boolean',
      description: 'Avalia Groovy Truth',
      doc: 'Converte o objeto para `boolean` segundo as regras de Groovy Truth (strings não vazias, números != 0, coleções não vazias = `true`).',
      returnType: 'java.lang.Boolean',
      insertText: 'asBoolean()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    }
  ],
  'java.lang.String': [
    {
      name: 'capitalize',
      kind: vscode.CompletionItemKind.Method,
      signature: 'capitalize(): String',
      description: 'Primeira letra maiúscula (Groovy)',
      doc: 'Converte o primeiro caractere da `String` para maiúscula.',
      returnType: 'java.lang.String',
      insertText: 'capitalize()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'uncapitalize',
      kind: vscode.CompletionItemKind.Method,
      signature: 'uncapitalize(): String',
      description: 'Primeira letra minúscula (Groovy)',
      doc: 'Converte o primeiro caractere da `String` para minúscula.',
      returnType: 'java.lang.String',
      insertText: 'uncapitalize()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'padLeft',
      kind: vscode.CompletionItemKind.Method,
      signature: 'padLeft(Number, String): String',
      description: 'Preenche à esquerda (Groovy)',
      doc: 'Preenche a string à esquerda até atingir o tamanho especificado (ex: `padLeft(5, "0")`).',
      returnType: 'java.lang.String',
      insertText: 'padLeft(10, "0")',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'padRight',
      kind: vscode.CompletionItemKind.Method,
      signature: 'padRight(Number, String): String',
      description: 'Preenche à direita (Groovy)',
      doc: 'Preenche a string à direita até atingir o tamanho especificado.',
      returnType: 'java.lang.String',
      insertText: 'padRight(10, " ")',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'center',
      kind: vscode.CompletionItemKind.Method,
      signature: 'center(Number, String): String',
      description: 'Centraliza string (Groovy)',
      doc: 'Centraliza a string em um tamanho total preenchendo com o caractere informado.',
      returnType: 'java.lang.String',
      insertText: 'center(20, " ")',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'reverse',
      kind: vscode.CompletionItemKind.Method,
      signature: 'reverse(): String',
      description: 'Inverte os caracteres (Groovy)',
      doc: 'Retorna uma nova `String` com os caracteres na ordem inversa.',
      returnType: 'java.lang.String',
      insertText: 'reverse()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'toInteger',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toInteger(): Integer',
      description: 'Converte String para Integer (Groovy)',
      doc: 'Analisa a string e retorna um `java.lang.Integer`.',
      returnType: 'java.lang.Integer',
      insertText: 'toInteger()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'toBigDecimal',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toBigDecimal(): BigDecimal',
      description: 'Converte String para BigDecimal (Groovy)',
      doc: 'Analisa a string e retorna um `java.math.BigDecimal`.',
      returnType: 'java.math.BigDecimal',
      insertText: 'toBigDecimal()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'toDouble',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toDouble(): Double',
      description: 'Converte String para Double (Groovy)',
      doc: 'Analisa a string e retorna um `java.lang.Double`.',
      returnType: 'java.lang.Double',
      insertText: 'toDouble()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'toBoolean',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toBoolean(): Boolean',
      description: 'Converte String para Boolean (Groovy)',
      doc: 'Retorna `true` se a string for `"true"`, `"1"` ou `"y"` (case-insensitive).',
      returnType: 'java.lang.Boolean',
      insertText: 'toBoolean()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'isNumber',
      kind: vscode.CompletionItemKind.Method,
      signature: 'isNumber(): boolean',
      description: 'Verifica se é numérico (Groovy)',
      doc: 'Retorna `true` se a string puder ser convertida em um número válido.',
      returnType: 'java.lang.Boolean',
      insertText: 'isNumber()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'isBlank',
      kind: vscode.CompletionItemKind.Method,
      signature: 'isBlank(): boolean',
      description: 'Verifica se vazia ou apenas espaços',
      doc: 'Retorna `true` se a string for vazia ou contiver apenas espaços em branco.',
      returnType: 'java.lang.Boolean',
      insertText: 'isBlank()',
      isGroovyOnly: false,
      category: 'java'
    },
    {
      name: 'take',
      kind: vscode.CompletionItemKind.Method,
      signature: 'take(int): String',
      description: 'Primeiros N caracteres (Groovy)',
      doc: 'Retorna uma substring com os primeiros `n` caracteres de forma segura.',
      returnType: 'java.lang.String',
      insertText: 'take(10)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'drop',
      kind: vscode.CompletionItemKind.Method,
      signature: 'drop(int): String',
      description: 'Remove primeiros N caracteres (Groovy)',
      doc: 'Retorna a string sem os primeiros `n` caracteres.',
      returnType: 'java.lang.String',
      insertText: 'drop(1)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'tokenize',
      kind: vscode.CompletionItemKind.Method,
      signature: 'tokenize(String): List<String>',
      description: 'Divide em Lista de tokens (Groovy)',
      doc: 'Divide a string pelos delimitadores informados retornando uma `List<String>`.',
      returnType: 'java.util.List',
      insertText: 'tokenize(",")',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    }
  ],
  'java.math.BigDecimal': [
    {
      name: 'round',
      kind: vscode.CompletionItemKind.Method,
      signature: 'round(int): BigDecimal',
      description: 'Arredonda para N casas decimais (Groovy)',
      doc: 'Arredonda o `BigDecimal` para o número de casas decimais informado.',
      returnType: 'java.math.BigDecimal',
      insertText: 'round(2)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'plus',
      kind: vscode.CompletionItemKind.Method,
      signature: 'plus(Number): BigDecimal',
      description: 'Soma (Groovy +)',
      doc: 'Soma outro número a este `BigDecimal`.',
      returnType: 'java.math.BigDecimal',
      insertText: 'plus(0)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'minus',
      kind: vscode.CompletionItemKind.Method,
      signature: 'minus(Number): BigDecimal',
      description: 'Subtrai (Groovy -)',
      doc: 'Subtrai outro número deste `BigDecimal`.',
      returnType: 'java.math.BigDecimal',
      insertText: 'minus(0)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'div',
      kind: vscode.CompletionItemKind.Method,
      signature: 'div(Number): BigDecimal',
      description: 'Divide (Groovy /)',
      doc: 'Divide este `BigDecimal` por outro número.',
      returnType: 'java.math.BigDecimal',
      insertText: 'div(1)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    }
  ],
  'java.util.Date': [
    {
      name: 'format',
      kind: vscode.CompletionItemKind.Method,
      signature: 'format(String): String',
      description: 'Formata data com máscara (Groovy GDK)',
      doc: 'Formata este `Date` utilizando o padrão `SimpleDateFormat` informado (ex.: `"dd/MM/yyyy"`).',
      returnType: 'java.lang.String',
      insertText: 'format("dd/MM/yyyy")',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'clearTime',
      kind: vscode.CompletionItemKind.Method,
      signature: 'clearTime(): Date',
      description: 'Zera horas/minutos/segundos (Groovy)',
      doc: 'Define a parte de tempo (hora, minuto, segundo, milissegundo) desta data para zero.',
      returnType: 'java.util.Date',
      insertText: 'clearTime()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'plus',
      kind: vscode.CompletionItemKind.Method,
      signature: 'plus(int): Date',
      description: 'Adiciona dias à data (Groovy +)',
      doc: 'Retorna uma nova `Date` com a quantidade de dias adicionada.',
      returnType: 'java.util.Date',
      insertText: 'plus(1)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'minus',
      kind: vscode.CompletionItemKind.Method,
      signature: 'minus(int): Date',
      description: 'Subtrai dias da data (Groovy -)',
      doc: 'Retorna uma nova `Date` com a quantidade de dias subtraída.',
      returnType: 'java.util.Date',
      insertText: 'minus(1)',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    }
  ],
  'java.util.Collection': [
    {
      name: 'size',
      kind: vscode.CompletionItemKind.Method,
      signature: 'size(): int',
      description: 'Quantidade de elementos',
      doc: 'Retorna o número de elementos nesta coleção.',
      returnType: 'java.lang.Integer',
      insertText: 'size()',
      category: 'java'
    },
    {
      name: 'isEmpty',
      kind: vscode.CompletionItemKind.Method,
      signature: 'isEmpty(): boolean',
      description: 'Verifica se vazia',
      doc: 'Retorna `true` se esta coleção não contiver elementos.',
      returnType: 'java.lang.Boolean',
      insertText: 'isEmpty()',
      category: 'java'
    },
    {
      name: 'contains',
      kind: vscode.CompletionItemKind.Method,
      signature: 'contains(Object): boolean',
      description: 'Contém elemento',
      doc: 'Retorna `true` se esta coleção contiver o elemento especificado.',
      returnType: 'java.lang.Boolean',
      insertText: 'contains()',
      category: 'java'
    },
    {
      name: 'join',
      kind: vscode.CompletionItemKind.Method,
      signature: 'join(String): String',
      description: 'Concatena itens com separador (Groovy)',
      doc: 'Une todos os elementos da coleção em uma única `String` usando o separador especificado.',
      returnType: 'java.lang.String',
      insertText: 'join(", ")',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'first',
      kind: vscode.CompletionItemKind.Method,
      signature: 'first(): Object',
      description: 'Primeiro elemento (Groovy)',
      doc: 'Retorna o primeiro elemento da coleção.',
      returnType: 'java.lang.Object',
      insertText: 'first()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'last',
      kind: vscode.CompletionItemKind.Method,
      signature: 'last(): Object',
      description: 'Último elemento (Groovy)',
      doc: 'Retorna o último elemento da coleção.',
      returnType: 'java.lang.Object',
      insertText: 'last()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'unique',
      kind: vscode.CompletionItemKind.Method,
      signature: 'unique(): Collection',
      description: 'Remove duplicados (Groovy)',
      doc: 'Retorna a coleção sem elementos duplicados.',
      returnType: 'java.util.List',
      insertText: 'unique()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    },
    {
      name: 'sort',
      kind: vscode.CompletionItemKind.Method,
      signature: 'sort(): List',
      description: 'Ordena elementos (Groovy)',
      doc: 'Retorna uma cópia ordenada dos elementos da coleção.',
      returnType: 'java.util.List',
      insertText: 'sort()',
      isGroovyOnly: true,
      category: 'groovy-gdk'
    }
  ]
};

/**
 * Funções nativas (Built-in Functions) de expressões JasperReports.
 */
export const JASPER_BUILTIN_FUNCTIONS: GroovyMember[] = [
  {
    name: 'IF',
    kind: vscode.CompletionItemKind.Function,
    signature: 'IF(boolean cond, Object seVerdadeiro, Object seFalso): Object',
    description: 'Condicional ternário JasperReports',
    doc: 'Retorna `seVerdadeiro` se a condição for `true`; caso contrário, retorna `seFalso`.',
    returnType: 'java.lang.Object',
    insertText: 'IF($F{COND}, "SIM", "NÃO")',
    category: 'jasper-builtin'
  },
  {
    name: 'CONCATENATE',
    kind: vscode.CompletionItemKind.Function,
    signature: 'CONCATENATE(String... textos): String',
    description: 'Concatena múltiplas strings',
    doc: 'Une múltiplas strings em um único texto de forma segura para `null`.',
    returnType: 'java.lang.String',
    insertText: 'CONCATENATE($F{CAMPO1}, " - ", $F{CAMPO2})',
    category: 'jasper-builtin'
  },
  {
    name: 'NVL',
    kind: vscode.CompletionItemKind.Function,
    signature: 'NVL(Object valor, Object padrao): Object',
    description: 'Retorna valor padrão se nulo',
    doc: 'Se `valor` for `null`, retorna `padrao`; caso contrário retorna o próprio `valor`.',
    returnType: 'java.lang.Object',
    insertText: 'NVL($F{CAMPO}, "")',
    category: 'jasper-builtin'
  },
  {
    name: 'ISNULL',
    kind: vscode.CompletionItemKind.Function,
    signature: 'ISNULL(Object valor): Boolean',
    description: 'Verifica se o objeto é null',
    doc: 'Retorna `true` se o argumento for `null`.',
    returnType: 'java.lang.Boolean',
    insertText: 'ISNULL($F{CAMPO})',
    category: 'jasper-builtin'
  },
  {
    name: 'UPPER',
    kind: vscode.CompletionItemKind.Function,
    signature: 'UPPER(String texto): String',
    description: 'Converte texto para maiúsculas',
    doc: 'Converte todos os caracteres da string informada para maiúsculas.',
    returnType: 'java.lang.String',
    insertText: 'UPPER($F{CAMPO})',
    category: 'jasper-builtin'
  },
  {
    name: 'LOWER',
    kind: vscode.CompletionItemKind.Function,
    signature: 'LOWER(String texto): String',
    description: 'Converte texto para minúsculas',
    doc: 'Converte todos os caracteres da string informada para minúsculas.',
    returnType: 'java.lang.String',
    insertText: 'LOWER($F{CAMPO})',
    category: 'jasper-builtin'
  },
  {
    name: 'TRIM',
    kind: vscode.CompletionItemKind.Function,
    signature: 'TRIM(String texto): String',
    description: 'Remove espaços nas extremidades',
    doc: 'Remove espaços em branco do início e do fim da string.',
    returnType: 'java.lang.String',
    insertText: 'TRIM($F{CAMPO})',
    category: 'jasper-builtin'
  },
  {
    name: 'DATEFORMAT',
    kind: vscode.CompletionItemKind.Function,
    signature: 'DATEFORMAT(Date data, String padrao): String',
    description: 'Formata data usando padrão SimpleDateFormat',
    doc: 'Formata um objeto `Date` utilizando a máscara informada (ex: `"dd/MM/yyyy"`).',
    returnType: 'java.lang.String',
    insertText: 'DATEFORMAT($F{DATA}, "dd/MM/yyyy")',
    category: 'jasper-builtin'
  },
  {
    name: 'NOW',
    kind: vscode.CompletionItemKind.Function,
    signature: 'NOW(): Date',
    description: 'Data e hora atual',
    doc: 'Retorna um objeto `java.util.Date` representando o instante atual.',
    returnType: 'java.util.Date',
    insertText: 'NOW()',
    category: 'jasper-builtin'
  },
  {
    name: 'TODAY',
    kind: vscode.CompletionItemKind.Function,
    signature: 'TODAY(): Date',
    description: 'Data de hoje',
    doc: 'Retorna a data atual.',
    returnType: 'java.util.Date',
    insertText: 'TODAY()',
    category: 'jasper-builtin'
  },
  {
    name: 'ABS',
    kind: vscode.CompletionItemKind.Function,
    signature: 'ABS(Number numero): Number',
    description: 'Valor absoluto',
    doc: 'Retorna o valor absoluto (sem sinal) do número informado.',
    returnType: 'java.math.BigDecimal',
    insertText: 'ABS($F{VALOR})',
    category: 'jasper-builtin'
  },
  {
    name: 'ROUND',
    kind: vscode.CompletionItemKind.Function,
    signature: 'ROUND(Number numero, int casas): BigDecimal',
    description: 'Arredonda número',
    doc: 'Arredonda o número para a quantidade de casas decimais especificada.',
    returnType: 'java.math.BigDecimal',
    insertText: 'ROUND($F{VALOR}, 2)',
    category: 'jasper-builtin'
  }
];

/**
 * Classes estáticas extras além de JAVA_STATIC_MEMBERS.
 */
export const EXTRA_STATIC_MEMBERS: Record<string, GroovyMember[]> = {
  SimpleDateFormat: [
    {
      name: 'format',
      kind: vscode.CompletionItemKind.Method,
      signature: 'new SimpleDateFormat(String).format(Date): String',
      description: 'Formata Date para String',
      doc: 'Cria um formatador de data e converte `Date` em `String`.',
      returnType: 'java.lang.String',
      insertText: 'format($F{DATA})',
      category: 'static'
    }
  ],
  DecimalFormat: [
    {
      name: 'format',
      kind: vscode.CompletionItemKind.Method,
      signature: 'new DecimalFormat(String).format(Number): String',
      description: 'Formata Number/BigDecimal para String',
      doc: 'Formata um número segundo a máscara especificada (ex: `"#,##0.00"`).',
      returnType: 'java.lang.String',
      insertText: 'format($F{VALOR})',
      category: 'static'
    }
  ],
  Objects: [
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object, Object): boolean',
      description: 'Igualdade null-safe',
      doc: 'Retorna `true` se os argumentos forem iguais entre si e `false` caso contrário.',
      returnType: 'java.lang.Boolean',
      insertText: 'equals(a, b)',
      category: 'static'
    },
    {
      name: 'nonNull',
      kind: vscode.CompletionItemKind.Method,
      signature: 'nonNull(Object): boolean',
      description: 'Verifica se não é null',
      doc: 'Retorna `true` se a referência fornecida não for `null`.',
      returnType: 'java.lang.Boolean',
      insertText: 'nonNull(obj)',
      category: 'static'
    },
    {
      name: 'isNull',
      kind: vscode.CompletionItemKind.Method,
      signature: 'isNull(Object): boolean',
      description: 'Verifica se é null',
      doc: 'Retorna `true` se a referência fornecida for `null`.',
      returnType: 'java.lang.Boolean',
      insertText: 'isNull(obj)',
      category: 'static'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(Object, String nullDefault): String',
      description: 'toString com fallback para null',
      doc: 'Retorna o `toString` do primeiro argumento ou `nullDefault` se for `null`.',
      returnType: 'java.lang.String',
      insertText: 'toString(obj, "")',
      category: 'static'
    }
  ]
};

/**
 * Normaliza nomes curtos de classes Java para FQCN (ex: `String` -> `java.lang.String`, `BigDecimal` -> `java.math.BigDecimal`).
 */
export function normalizeJavaTypeName(rawType?: string | null): string {
  if (!rawType) {
    return 'java.lang.Object';
  }
  const trimmed = rawType.trim();
  const shortMap: Record<string, string> = {
    String: 'java.lang.String',
    string: 'java.lang.String',
    Integer: 'java.lang.Integer',
    int: 'java.lang.Integer',
    Long: 'java.lang.Long',
    long: 'java.lang.Long',
    Double: 'java.lang.Double',
    double: 'java.lang.Double',
    Float: 'java.lang.Float',
    float: 'java.lang.Float',
    Short: 'java.lang.Integer',
    short: 'java.lang.Integer',
    Byte: 'java.lang.Integer',
    byte: 'java.lang.Integer',
    Number: 'java.lang.Number',
    BigDecimal: 'java.math.BigDecimal',
    BigInteger: 'java.math.BigDecimal',
    Boolean: 'java.lang.Boolean',
    boolean: 'java.lang.Boolean',
    Date: 'java.util.Date',
    Timestamp: 'java.sql.Timestamp',
    LocalDate: 'java.sql.Date',
    LocalDateTime: 'java.sql.Timestamp',
    Object: 'java.lang.Object',
    List: 'java.util.Collection',
    ArrayList: 'java.util.Collection',
    Set: 'java.util.Collection',
    Collection: 'java.util.Collection',
    Iterable: 'java.util.Collection',
    'java.util.List': 'java.util.Collection',
    'java.util.ArrayList': 'java.util.Collection',
    'java.util.Set': 'java.util.Collection'
  };

  return shortMap[trimmed] || trimmed;
}

/**
 * Infere o tipo de retorno Java a partir da assinatura de um membro (`signature: "multiply(BigDecimal): BigDecimal"`).
 */
export function extractReturnTypeFromSignature(signature: string): string {
  const colonIdx = signature.lastIndexOf(':');
  if (colonIdx < 0) {
    return 'java.lang.Object';
  }
  const rawReturn = signature.slice(colonIdx + 1).trim();
  if (rawReturn.endsWith('[]') || rawReturn.startsWith('List') || rawReturn.startsWith('Collection')) {
    return 'java.util.Collection';
  }
  return normalizeJavaTypeName(rawReturn);
}

/**
 * Retorna todos os membros de instância (Java Standard Library + Groovy GDK quando aplicável) para um tipo.
 */
export function getCombinedMembersForType(
  rawType: string,
  language: 'groovy' | 'java' = 'groovy'
): GroovyMember[] {
  const normalized = normalizeJavaTypeName(rawType);
  const baseJava = JAVA_STANDARD_LIBRARY[normalized] || [];
  const objectJava = normalized !== 'java.lang.Object' ? JAVA_STANDARD_LIBRARY['java.lang.Object'] || [] : [];

  const javaMembers: GroovyMember[] = [...baseJava, ...objectJava].map((m) => ({
    ...m,
    returnType: extractReturnTypeFromSignature(m.signature),
    insertText: m.signature.includes('()') ? `${m.name}()` : m.name,
    isGroovyOnly: false,
    category: 'java'
  }));

  if (language === 'java') {
    return deduplicateMembers(javaMembers);
  }

  const gdkSpecific = GROOVY_GDK_METHODS[normalized] || [];
  const gdkDateExtra =
    normalized === 'java.sql.Timestamp' || normalized === 'java.sql.Date'
      ? GROOVY_GDK_METHODS['java.util.Date'] || []
      : [];
  const gdkNumberExtra =
    normalized === 'java.lang.Integer' ||
    normalized === 'java.lang.Long' ||
    normalized === 'java.lang.Double' ||
    normalized === 'java.lang.Float' ||
    normalized === 'java.lang.Number'
      ? GROOVY_GDK_METHODS['java.math.BigDecimal'] || []
      : [];
  const gdkObject = GROOVY_GDK_METHODS['java.lang.Object'] || [];

  return deduplicateMembers([
    ...javaMembers,
    ...gdkSpecific,
    ...gdkDateExtra,
    ...gdkNumberExtra,
    ...gdkObject
  ]);
}

function deduplicateMembers(members: GroovyMember[]): GroovyMember[] {
  const seen = new Set<string>();
  const result: GroovyMember[] = [];
  for (const m of members) {
    const key = `${m.name}::${m.signature}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(m);
    }
  }
  return result;
}

/**
 * Retorna membros estáticos para uma classe (ex: `Boolean`, `Integer`, `BigDecimal`, `DateUtils`, `JRExtendedUtils`, `Math`, `Objects`).
 */
export function getCombinedStaticMembers(className: string): GroovyMember[] {
  const cleanName = className.replace(/^java\.(?:lang|math|util|text)\./, '');
  const base = JAVA_STATIC_MEMBERS[cleanName] || [];
  const extra = EXTRA_STATIC_MEMBERS[cleanName] || [];

  return [
    ...base.map((m) => ({
      ...m,
      returnType: extractReturnTypeFromSignature(m.signature),
      insertText: m.kind === vscode.CompletionItemKind.Constant ? m.name : `${m.name}()`,
      category: 'static' as const
    })),
    ...extra
  ];
}

/**
 * Lista todas as classes estáticas suportadas no autocomplete.
 */
export function getStaticClassNames(): string[] {
  const names = new Set<string>([
    ...Object.keys(JAVA_STATIC_MEMBERS),
    ...Object.keys(EXTRA_STATIC_MEMBERS)
  ]);
  return Array.from(names);
}

/**
 * Infere o tipo de retorno de uma chamada de método sobre um tipo receptor conhecido.
 */
export function inferMethodReturnType(
  receiverType: string,
  methodName: string,
  language: 'groovy' | 'java' = 'groovy'
): string | null {
  const members = getCombinedMembersForType(receiverType, language);
  const found = members.find((m) => m.name === methodName);
  if (found) {
    return found.returnType || extractReturnTypeFromSignature(found.signature);
  }
  return null;
}

/**
 * Retorna os snippets de expressão com sugestões contextuais opcionais baseadas nos campos do relatório.
 */
export function getContextualSnippets(
  _metadata?: JrxmlMetadata,
  _fields?: JrxmlField[]
): ExpressionSnippetDefinition[] {
  return EXPRESSION_SNIPPETS.map((s) => ({ ...s }));
}
