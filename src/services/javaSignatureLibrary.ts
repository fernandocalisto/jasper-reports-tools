import * as vscode from 'vscode';

export interface JavaMember {
  name: string;
  kind: vscode.CompletionItemKind;
  signature: string;
  description: string;
  doc: string;
}

/**
 * Membros de instância por tipo Java completo (FQCN) para expressões JasperReports.
 */
export const JAVA_STANDARD_LIBRARY: Record<string, JavaMember[]> = {
  'java.lang.String': [
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Compara strings',
      doc: 'Retorna `true` se o argumento não é nulo e representa a mesma sequência de caracteres.'
    },
    {
      name: 'equalsIgnoreCase',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equalsIgnoreCase(String): boolean',
      description: 'Compara ignorando case',
      doc: 'Compara esta `String` com outra `String`, ignorando diferenças entre maiúsculas e minúsculas.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Retorna a própria string',
      doc: 'Retorna o próprio objeto `String`.'
    },
    {
      name: 'toUpperCase',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toUpperCase(): String',
      description: 'Maiúsculas',
      doc: 'Converte todos os caracteres desta `String` para letras maiúsculas.'
    },
    {
      name: 'toLowerCase',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toLowerCase(): String',
      description: 'Minúsculas',
      doc: 'Converte todos os caracteres desta `String` para letras minúsculas.'
    },
    {
      name: 'trim',
      kind: vscode.CompletionItemKind.Method,
      signature: 'trim(): String',
      description: 'Remove espaços nas pontas',
      doc: 'Retorna uma cópia da string sem espaços em branco no início e no fim.'
    },
    {
      name: 'length',
      kind: vscode.CompletionItemKind.Property,
      signature: 'length(): int',
      description: 'Tamanho da string',
      doc: 'Retorna o comprimento (quantidade de caracteres) desta string.'
    },
    {
      name: 'isEmpty',
      kind: vscode.CompletionItemKind.Method,
      signature: 'isEmpty(): boolean',
      description: 'Verifica se vazia',
      doc: 'Retorna `true` se, e somente se, `length()` for `0`.'
    },
    {
      name: 'substring',
      kind: vscode.CompletionItemKind.Method,
      signature: 'substring(int, int): String',
      description: 'Substring',
      doc: 'Retorna uma nova string que é uma subsequência desta string.'
    },
    {
      name: 'indexOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'indexOf(String): int',
      description: 'Posição da substring',
      doc: 'Retorna o índice da primeira ocorrência da substring especificada, ou `-1`.'
    },
    {
      name: 'contains',
      kind: vscode.CompletionItemKind.Method,
      signature: 'contains(CharSequence): boolean',
      description: 'Contém substring',
      doc: 'Retorna `true` se esta string contiver a sequência de caracteres especificada.'
    },
    {
      name: 'startsWith',
      kind: vscode.CompletionItemKind.Method,
      signature: 'startsWith(String): boolean',
      description: 'Começa com',
      doc: 'Testa se esta string começa com o prefixo especificado.'
    },
    {
      name: 'endsWith',
      kind: vscode.CompletionItemKind.Method,
      signature: 'endsWith(String): boolean',
      description: 'Termina com',
      doc: 'Testa se esta string termina com o sufixo especificado.'
    },
    {
      name: 'replace',
      kind: vscode.CompletionItemKind.Method,
      signature: 'replace(CharSequence, CharSequence): String',
      description: 'Substitui',
      doc: 'Substitui cada substring correspondente ao texto alvo pelo texto substituto.'
    },
    {
      name: 'replaceAll',
      kind: vscode.CompletionItemKind.Method,
      signature: 'replaceAll(String, String): String',
      description: 'Substitui por regex',
      doc: 'Substitui cada substring correspondente à expressão regular informada.'
    },
    {
      name: 'split',
      kind: vscode.CompletionItemKind.Method,
      signature: 'split(String): String[]',
      description: 'Divide por regex',
      doc: 'Divide esta string em torno das correspondências da expressão regular fornecida.'
    },
    {
      name: 'format',
      kind: vscode.CompletionItemKind.Method,
      signature: 'format(String, Object...): String',
      description: 'Formata (printf)',
      doc: 'Retorna uma string formatada usando a string de formato e argumentos fornecidos.'
    },
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(Object): String',
      description: 'Converte para String',
      doc: 'Retorna a representação em `String` do argumento `Object`.'
    }
  ],
  'java.lang.Integer': [
    {
      name: 'intValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'intValue(): int',
      description: 'Valor primitivo int',
      doc: 'Retorna o valor deste `Integer` como um `int` primitivo.'
    },
    {
      name: 'longValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'longValue(): long',
      description: 'Valor primitivo long',
      doc: 'Retorna o valor deste `Integer` como um `long` primitivo.'
    },
    {
      name: 'doubleValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'doubleValue(): double',
      description: 'Valor primitivo double',
      doc: 'Retorna o valor deste `Integer` como um `double` primitivo.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Converte para String',
      doc: 'Retorna um objeto `String` representando o valor deste `Integer`.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Compara valores',
      doc: 'Compara este objeto com o objeto especificado.'
    },
    {
      name: 'compareTo',
      kind: vscode.CompletionItemKind.Method,
      signature: 'compareTo(Integer): int',
      description: 'Compara ordenação',
      doc: 'Compara dois objetos `Integer` numericamente.'
    }
  ],
  'java.lang.Long': [
    {
      name: 'longValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'longValue(): long',
      description: 'Valor primitivo long',
      doc: 'Retorna o valor deste `Long` como um `long` primitivo.'
    },
    {
      name: 'intValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'intValue(): int',
      description: 'Valor primitivo int',
      doc: 'Retorna o valor deste `Long` como um `int` primitivo.'
    },
    {
      name: 'doubleValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'doubleValue(): double',
      description: 'Valor primitivo double',
      doc: 'Retorna o valor deste `Long` como um `double` primitivo.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Converte para String',
      doc: 'Retorna um objeto `String` representando o valor deste `Long`.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Compara valores',
      doc: 'Compara este objeto com o objeto especificado.'
    },
    {
      name: 'compareTo',
      kind: vscode.CompletionItemKind.Method,
      signature: 'compareTo(Long): int',
      description: 'Compara ordenação',
      doc: 'Compara dois objetos `Long` numericamente.'
    }
  ],
  'java.lang.Double': [
    {
      name: 'doubleValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'doubleValue(): double',
      description: 'Valor primitivo double',
      doc: 'Retorna o valor deste `Double` como um `double` primitivo.'
    },
    {
      name: 'intValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'intValue(): int',
      description: 'Valor primitivo int',
      doc: 'Retorna o valor deste `Double` como um `int` primitivo.'
    },
    {
      name: 'longValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'longValue(): long',
      description: 'Valor primitivo long',
      doc: 'Retorna o valor deste `Double` como um `long` primitivo.'
    },
    {
      name: 'isNaN',
      kind: vscode.CompletionItemKind.Method,
      signature: 'isNaN(): boolean',
      description: 'Verifica se é NaN',
      doc: 'Retorna `true` se este valor `Double` for Not-a-Number (NaN).'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Converte para String',
      doc: 'Retorna uma representação em `String` deste objeto `Double`.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Compara valores',
      doc: 'Compara este objeto com o objeto especificado.'
    },
    {
      name: 'compareTo',
      kind: vscode.CompletionItemKind.Method,
      signature: 'compareTo(Double): int',
      description: 'Compara ordenação',
      doc: 'Compara dois objetos `Double` numericamente.'
    }
  ],
  'java.lang.Float': [
    {
      name: 'floatValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'floatValue(): float',
      description: 'Valor primitivo float',
      doc: 'Retorna o valor deste `Float` como um `float` primitivo.'
    },
    {
      name: 'doubleValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'doubleValue(): double',
      description: 'Valor primitivo double',
      doc: 'Retorna o valor deste `Float` como um `double` primitivo.'
    },
    {
      name: 'intValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'intValue(): int',
      description: 'Valor primitivo int',
      doc: 'Retorna o valor deste `Float` como um `int` primitivo.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Converte para String',
      doc: 'Retorna uma representação em `String` deste objeto `Float`.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Compara valores',
      doc: 'Compara este objeto com o objeto especificado.'
    },
    {
      name: 'compareTo',
      kind: vscode.CompletionItemKind.Method,
      signature: 'compareTo(Float): int',
      description: 'Compara ordenação',
      doc: 'Compara dois objetos `Float` numericamente.'
    }
  ],
  'java.lang.Number': [
    {
      name: 'intValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'intValue(): int',
      description: 'Valor int',
      doc: 'Retorna o valor do número especificado como `int`.'
    },
    {
      name: 'longValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'longValue(): long',
      description: 'Valor long',
      doc: 'Retorna o valor do número especificado como `long`.'
    },
    {
      name: 'doubleValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'doubleValue(): double',
      description: 'Valor double',
      doc: 'Retorna o valor do número especificado como `double`.'
    },
    {
      name: 'floatValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'floatValue(): float',
      description: 'Valor float',
      doc: 'Retorna o valor do número especificado como `float`.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Converte para String',
      doc: 'Retorna a representação textual do número.'
    }
  ],
  'java.math.BigDecimal': [
    {
      name: 'add',
      kind: vscode.CompletionItemKind.Method,
      signature: 'add(BigDecimal): BigDecimal',
      description: 'Soma',
      doc: 'Retorna um `BigDecimal` cujo valor é `(this + augend)`.'
    },
    {
      name: 'subtract',
      kind: vscode.CompletionItemKind.Method,
      signature: 'subtract(BigDecimal): BigDecimal',
      description: 'Subtração',
      doc: 'Retorna um `BigDecimal` cujo valor é `(this - subtrahend)`.'
    },
    {
      name: 'multiply',
      kind: vscode.CompletionItemKind.Method,
      signature: 'multiply(BigDecimal): BigDecimal',
      description: 'Multiplicação',
      doc: 'Retorna um `BigDecimal` cujo valor é `(this × multiplicand)`.'
    },
    {
      name: 'divide',
      kind: vscode.CompletionItemKind.Method,
      signature: 'divide(BigDecimal, RoundingMode): BigDecimal',
      description: 'Divisão com arredondamento',
      doc: 'Retorna um `BigDecimal` cujo valor é `(this / divisor)` com arredondamento.'
    },
    {
      name: 'setScale',
      kind: vscode.CompletionItemKind.Method,
      signature: 'setScale(int, RoundingMode): BigDecimal',
      description: 'Define casas decimais',
      doc: 'Retorna um `BigDecimal` com a escala especificada aplicando o modo de arredondamento.'
    },
    {
      name: 'abs',
      kind: vscode.CompletionItemKind.Method,
      signature: 'abs(): BigDecimal',
      description: 'Valor absoluto',
      doc: 'Retorna um `BigDecimal` cujo valor é o valor absoluto deste `BigDecimal`.'
    },
    {
      name: 'negate',
      kind: vscode.CompletionItemKind.Method,
      signature: 'negate(): BigDecimal',
      description: 'Inverte o sinal',
      doc: 'Retorna um `BigDecimal` cujo valor é `(-this)`.'
    },
    {
      name: 'doubleValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'doubleValue(): double',
      description: 'Converte para double',
      doc: 'Converte este `BigDecimal` para um `double`.'
    },
    {
      name: 'intValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'intValue(): int',
      description: 'Converte para int',
      doc: 'Converte este `BigDecimal` para um `int`.'
    },
    {
      name: 'compareTo',
      kind: vscode.CompletionItemKind.Method,
      signature: 'compareTo(BigDecimal): int',
      description: 'Compara',
      doc: 'Compara este `BigDecimal` com o `BigDecimal` especificado (`-1`, `0` ou `1`).'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Para String',
      doc: 'Retorna a representação em `String` deste `BigDecimal`.'
    }
  ],
  'java.util.Date': [
    {
      name: 'getTime',
      kind: vscode.CompletionItemKind.Method,
      signature: 'getTime(): long',
      description: 'Timestamp (ms)',
      doc: 'Retorna o número de milissegundos desde 1 de janeiro de 1970, 00:00:00 GMT.'
    },
    {
      name: 'before',
      kind: vscode.CompletionItemKind.Method,
      signature: 'before(Date): boolean',
      description: 'É anterior?',
      doc: 'Testa se esta data é estritamente anterior à data especificada.'
    },
    {
      name: 'after',
      kind: vscode.CompletionItemKind.Method,
      signature: 'after(Date): boolean',
      description: 'É posterior?',
      doc: 'Testa se esta data é estritamente posterior à data especificada.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Compara datas',
      doc: 'Compara duas datas quanto à igualdade.'
    },
    {
      name: 'compareTo',
      kind: vscode.CompletionItemKind.Method,
      signature: 'compareTo(Date): int',
      description: 'Ordenação',
      doc: 'Compara duas datas para ordenação.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Representação textual',
      doc: 'Converte este objeto `Date` em uma `String`.'
    }
  ],
  'java.sql.Timestamp': [
    {
      name: 'getTime',
      kind: vscode.CompletionItemKind.Method,
      signature: 'getTime(): long',
      description: 'Timestamp (ms)',
      doc: 'Retorna o número de milissegundos desde 1 de janeiro de 1970, 00:00:00 GMT.'
    },
    {
      name: 'before',
      kind: vscode.CompletionItemKind.Method,
      signature: 'before(Timestamp): boolean',
      description: 'É anterior?',
      doc: 'Indica se este `Timestamp` é anterior ao `Timestamp` fornecido.'
    },
    {
      name: 'after',
      kind: vscode.CompletionItemKind.Method,
      signature: 'after(Timestamp): boolean',
      description: 'É posterior?',
      doc: 'Indica se este `Timestamp` é posterior ao `Timestamp` fornecido.'
    },
    {
      name: 'toLocalDateTime',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toLocalDateTime(): LocalDateTime',
      description: 'Converte para LocalDateTime',
      doc: 'Converte este objeto `Timestamp` para um `LocalDateTime`.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Compara timestamps',
      doc: 'Testa a igualdade deste `Timestamp` com outro objeto.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Formato JDBC timestamp',
      doc: 'Formata um timestamp no formato de escape JDBC `yyyy-mm-dd hh:mm:ss.fffffffff`.'
    }
  ],
  'java.sql.Date': [
    {
      name: 'getTime',
      kind: vscode.CompletionItemKind.Method,
      signature: 'getTime(): long',
      description: 'Timestamp (ms)',
      doc: 'Retorna o número de milissegundos desde 1 de janeiro de 1970, 00:00:00 GMT.'
    },
    {
      name: 'before',
      kind: vscode.CompletionItemKind.Method,
      signature: 'before(Date): boolean',
      description: 'É anterior?',
      doc: 'Testa se esta data é anterior à data especificada.'
    },
    {
      name: 'after',
      kind: vscode.CompletionItemKind.Method,
      signature: 'after(Date): boolean',
      description: 'É posterior?',
      doc: 'Testa se esta data é posterior à data especificada.'
    },
    {
      name: 'toLocalDate',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toLocalDate(): LocalDate',
      description: 'Converte para LocalDate',
      doc: 'Converte este objeto `java.sql.Date` para um `LocalDate`.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Formato yyyy-mm-dd',
      doc: 'Formata uma data no formato de escape JDBC `yyyy-mm-dd`.'
    }
  ],
  'java.lang.Boolean': [
    {
      name: 'booleanValue',
      kind: vscode.CompletionItemKind.Method,
      signature: 'booleanValue(): boolean',
      description: 'Valor primitivo',
      doc: 'Retorna o valor deste objeto `Boolean` como uma primitiva `boolean`.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'String "true"/"false"',
      doc: 'Retorna um objeto `String` representando o valor deste `Boolean`.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Igualdade',
      doc: 'Retorna `true` se o argumento não é nulo e é um objeto `Boolean` com o mesmo valor.'
    }
  ],
  'java.lang.Object': [
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(): String',
      description: 'Representação textual',
      doc: 'Retorna uma representação em `String` do objeto.'
    },
    {
      name: 'equals',
      kind: vscode.CompletionItemKind.Method,
      signature: 'equals(Object): boolean',
      description: 'Igualdade',
      doc: 'Indica se algum outro objeto é "igual a" este.'
    },
    {
      name: 'hashCode',
      kind: vscode.CompletionItemKind.Method,
      signature: 'hashCode(): int',
      description: 'Hash code',
      doc: 'Retorna um valor de código hash para o objeto.'
    },
    {
      name: 'getClass',
      kind: vscode.CompletionItemKind.Method,
      signature: 'getClass(): Class<?>',
      description: 'Runtime class',
      doc: 'Retorna a classe em tempo de execução deste `Object`.'
    }
  ]
};

/**
 * Membros estáticos de classes comuns e utilitários do JasperReports.
 */
export const JAVA_STATIC_MEMBERS: Record<string, JavaMember[]> = {
  Boolean: [
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(boolean): Boolean',
      description: 'Boxing',
      doc: 'Retorna uma instância de `Boolean` representando o valor `boolean` especificado.'
    },
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(String): Boolean',
      description: 'Parse "true"/"false"',
      doc: 'Retorna um `Boolean` com valor `true` se o argumento string não for nulo e for igual a `"true"`.'
    },
    {
      name: 'parseBoolean',
      kind: vscode.CompletionItemKind.Method,
      signature: 'parseBoolean(String): boolean',
      description: 'Parse primitivo',
      doc: 'Analisa o argumento string como um `boolean` primitivo.'
    },
    {
      name: 'TRUE',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'TRUE: Boolean',
      description: 'Constante true',
      doc: 'O objeto `Boolean` correspondente ao valor primitivo `true`.'
    },
    {
      name: 'FALSE',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'FALSE: Boolean',
      description: 'Constante false',
      doc: 'O objeto `Boolean` correspondente ao valor primitivo `false`.'
    }
  ],
  Integer: [
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(int): Integer',
      description: 'Boxing',
      doc: 'Retorna uma instância de `Integer` representando o valor `int` especificado.'
    },
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(String): Integer',
      description: 'Parse int',
      doc: 'Retorna um objeto `Integer` contendo o valor da `String` especificada.'
    },
    {
      name: 'parseInt',
      kind: vscode.CompletionItemKind.Method,
      signature: 'parseInt(String): int',
      description: 'Parse primitivo',
      doc: 'Analisa o argumento string como um inteiro decimal com sinal.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(int): String',
      description: 'Int para String',
      doc: 'Retorna um objeto `String` representando o inteiro especificado.'
    },
    {
      name: 'MAX_VALUE',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'MAX_VALUE: int',
      description: '2^31-1',
      doc: 'Constante contendo o valor máximo que um `int` pode ter (2³¹-1).'
    },
    {
      name: 'MIN_VALUE',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'MIN_VALUE: int',
      description: '-2^31',
      doc: 'Constante contendo o valor mínimo que um `int` pode ter (-2³¹).'
    }
  ],
  Long: [
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(long): Long',
      description: 'Boxing',
      doc: 'Retorna uma instância de `Long` representando o valor `long` especificado.'
    },
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(String): Long',
      description: 'Parse long',
      doc: 'Retorna um objeto `Long` contendo o valor extraído da `String` especificada.'
    },
    {
      name: 'parseLong',
      kind: vscode.CompletionItemKind.Method,
      signature: 'parseLong(String): long',
      description: 'Parse primitivo',
      doc: 'Analisa o argumento string como um `long` decimal com sinal.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(long): String',
      description: 'Long para String',
      doc: 'Retorna um objeto `String` representando o `long` especificado.'
    },
    {
      name: 'MAX_VALUE',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'MAX_VALUE: long',
      description: '2^63-1',
      doc: 'Constante contendo o valor máximo que um `long` pode ter.'
    },
    {
      name: 'MIN_VALUE',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'MIN_VALUE: long',
      description: '-2^63',
      doc: 'Constante contendo o valor mínimo que um `long` pode ter.'
    }
  ],
  Double: [
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(double): Double',
      description: 'Boxing',
      doc: 'Retorna uma instância de `Double` representando o valor `double` especificado.'
    },
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(String): Double',
      description: 'Parse double',
      doc: 'Retorna um objeto `Double` contendo o valor `double` representado pela string.'
    },
    {
      name: 'parseDouble',
      kind: vscode.CompletionItemKind.Method,
      signature: 'parseDouble(String): double',
      description: 'Parse primitivo',
      doc: 'Retorna um novo `double` inicializado com o valor representado pela `String`.'
    },
    {
      name: 'toString',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toString(double): String',
      description: 'Double para String',
      doc: 'Retorna uma representação textual do argumento `double`.'
    }
  ],
  Float: [
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(float): Float',
      description: 'Boxing',
      doc: 'Retorna uma instância de `Float` representando o valor `float` especificado.'
    },
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(String): Float',
      description: 'Parse float',
      doc: 'Retorna um objeto `Float` contendo o valor `float` representado pela string.'
    },
    {
      name: 'parseFloat',
      kind: vscode.CompletionItemKind.Method,
      signature: 'parseFloat(String): float',
      description: 'Parse primitivo',
      doc: 'Retorna um novo `float` inicializado com o valor representado pela `String`.'
    }
  ],
  BigDecimal: [
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(double): BigDecimal',
      description: 'Cria a partir de double',
      doc: 'Converte um `double` em um `BigDecimal` usando a representação textual canônica.'
    },
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(String): BigDecimal',
      description: 'Parse String',
      doc: 'Converte um valor numérico em `BigDecimal`.'
    },
    {
      name: 'ZERO',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'ZERO: BigDecimal',
      description: 'Constante 0',
      doc: 'O valor 0, com uma escala de 0.'
    },
    {
      name: 'ONE',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'ONE: BigDecimal',
      description: 'Constante 1',
      doc: 'O valor 1, com uma escala de 0.'
    },
    {
      name: 'TEN',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'TEN: BigDecimal',
      description: 'Constante 10',
      doc: 'O valor 10, com uma escala de 0.'
    },
    {
      name: 'ROUND_HALF_UP',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'ROUND_HALF_UP: RoundingMode',
      description: 'Arredondamento padrão',
      doc: 'Modo de arredondamento para o vizinho mais próximo (arredonda para cima se equidistante).'
    },
    {
      name: 'ROUND_HALF_EVEN',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'ROUND_HALF_EVEN: RoundingMode',
      description: 'Arredondamento bancário',
      doc: 'Modo de arredondamento para o vizinho par mais próximo.'
    }
  ],
  String: [
    {
      name: 'valueOf',
      kind: vscode.CompletionItemKind.Method,
      signature: 'valueOf(Object): String',
      description: 'Qualquer objeto para String',
      doc: 'Retorna a representação em `String` do argumento `Object`.'
    },
    {
      name: 'format',
      kind: vscode.CompletionItemKind.Method,
      signature: 'format(String, Object...): String',
      description: 'Format estilo printf',
      doc: 'Retorna uma string formatada usando a máscara e argumentos especificados.'
    },
    {
      name: 'join',
      kind: vscode.CompletionItemKind.Method,
      signature: 'join(CharSequence, Iterable): String',
      description: 'Junta com delimitador',
      doc: 'Retorna uma nova `String` composta de cópias dos elementos unidos pelo delimitador.'
    }
  ],
  Math: [
    {
      name: 'round',
      kind: vscode.CompletionItemKind.Method,
      signature: 'round(double): long',
      description: 'Arredonda',
      doc: 'Retorna o `long` mais próximo do argumento.'
    },
    {
      name: 'floor',
      kind: vscode.CompletionItemKind.Method,
      signature: 'floor(double): double',
      description: 'Chão',
      doc: 'Retorna o maior valor (mais próximo do infinito positivo) menor ou igual ao argumento.'
    },
    {
      name: 'ceil',
      kind: vscode.CompletionItemKind.Method,
      signature: 'ceil(double): double',
      description: 'Teto',
      doc: 'Retorna o menor valor (mais próximo do infinito negativo) maior ou igual ao argumento.'
    },
    {
      name: 'abs',
      kind: vscode.CompletionItemKind.Method,
      signature: 'abs(double): double',
      description: 'Valor absoluto',
      doc: 'Retorna o valor absoluto de um valor `double`.'
    },
    {
      name: 'max',
      kind: vscode.CompletionItemKind.Method,
      signature: 'max(double, double): double',
      description: 'Máximo',
      doc: 'Retorna o maior de dois valores numéricos.'
    },
    {
      name: 'min',
      kind: vscode.CompletionItemKind.Method,
      signature: 'min(double, double): double',
      description: 'Mínimo',
      doc: 'Retorna o menor de dois valores numéricos.'
    },
    {
      name: 'PI',
      kind: vscode.CompletionItemKind.Constant,
      signature: 'PI: double',
      description: '3.14159...',
      doc: 'O valor `double` mais próximo de pi, a razão entre a circunferência de um círculo e seu diâmetro.'
    }
  ],
  DateUtils: [
    {
      name: 'addDays',
      kind: vscode.CompletionItemKind.Method,
      signature: 'addDays(Date, int): Date',
      description: 'Adiciona dias',
      doc: 'Adiciona uma quantidade de dias a uma data retornando um novo objeto `Date`.'
    },
    {
      name: 'addMonths',
      kind: vscode.CompletionItemKind.Method,
      signature: 'addMonths(Date, int): Date',
      description: 'Adiciona meses',
      doc: 'Adiciona uma quantidade de meses a uma data retornando um novo objeto `Date`.'
    },
    {
      name: 'addYears',
      kind: vscode.CompletionItemKind.Method,
      signature: 'addYears(Date, int): Date',
      description: 'Adiciona anos',
      doc: 'Adiciona uma quantidade de anos a uma data retornando um novo objeto `Date`.'
    },
    {
      name: 'toDate',
      kind: vscode.CompletionItemKind.Method,
      signature: 'toDate(String, String): Date',
      description: 'Parse com formato',
      doc: 'Converte uma `String` em `Date` utilizando o padrão especificado (ex.: `"dd/MM/yyyy"`).'
    },
    {
      name: 'format',
      kind: vscode.CompletionItemKind.Method,
      signature: 'format(Date, String): String',
      description: 'Formata data',
      doc: 'Formata um objeto `Date` em `String` segundo a máscara informada.'
    }
  ],
  JRExtendedUtils: [
    {
      name: 'formatCurrency',
      kind: vscode.CompletionItemKind.Method,
      signature: 'formatCurrency(Number, Locale): String',
      description: 'Formata moeda',
      doc: 'Formata um valor numérico como moeda para o `Locale` especificado.'
    },
    {
      name: 'formatNumber',
      kind: vscode.CompletionItemKind.Method,
      signature: 'formatNumber(Number, String, Locale): String',
      description: 'Formata número',
      doc: 'Formata um valor numérico usando a máscara e o `Locale` especificados.'
    }
  ]
};
