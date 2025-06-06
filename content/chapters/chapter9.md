---
typora-root-url: ./..\..\public
---

# 第 9 章 解析 (Parsing)

JDBC 客户端将 SQL 语句作为字符串提交给数据库引擎。引擎必须从这个字符串中提取必要的信息来创建查询树。这种提取过程有两个阶段：基于语法的阶段，称为**解析 (parsing)**；以及基于语义的阶段，称为**规划 (planning)**。本章介绍解析。规划将在第 10 章中介绍。

## 9.1 语法与语义 (Syntax Versus Semantics)

语言的语法 (syntax) 是一组规则，描述了可能构成有意义语句的字符串。例如，考虑以下字符串：

select from tables T1 and T2 where b - 3

这个字符串在语法上不合法有几个原因：

- `select` 子句必须包含内容。
- 标识符 `tables` 不是关键字，将被视为表名。
- 表名之间需要用逗号分隔，而不是关键字 `and`。
- 字符串 “b - 3” 不表示谓词。

这些问题中的每一个都导致这个字符串作为 SQL 语句完全没有意义。无论标识符 `tables`、`T1`、`T2` 和 `b` 实际表示什么，引擎都无法弄清楚如何执行它。

语言的语义 (semantics) 指定了语法正确的字符串的实际含义。考虑以下语法上合法的字符串：

select a from x, z where b = 3

您可以推断此语句是一个查询，它请求两个表（名为 `x` 和 `z`）中的一个字段（名为 `a`），并且具有谓词 `b = 3`。因此，该语句可能是有意义的。

该语句是否实际有意义取决于关于 `x`、`z`、`a` 和 `b` 的**语义信息 (semantic information)**。特别是，`x` 和 `z` 必须是表名，并且这些表必须包含一个名为 `a` 的字段和一个名为 `b` 的数字字段。这种语义信息可以从数据库的**元数据 (metadata)** 中确定。**解析器 (parser)** 对元数据一无所知，因此无法评估 SQL 语句的含义。相反，检查元数据的责任属于**规划器 (planner)**，将在第 10 章中讨论。

## 9.2 词法分析 (Lexical Analysis)

解析器的首要任务是将输入字符串分解成称为**标记 (tokens)** 的“块”。执行此任务的解析器部分称为**词法分析器 (lexical analyzer)**。

每个标记都具有类型和值。SimpleDB 词法分析器支持五种标记类型：

- **单字符分隔符 (Single-character delimiters)**，例如逗号 `,`
- **整数常量 (Integer constants)**，例如 `123`
- **字符串常量 (String constants)**，例如 `'joe'`
- **关键字 (Keywords)**，例如 `select`、`from` 和 `where`
- **标识符 (Identifiers)**，例如 `STUDENT`、`x` 和 `glop34a`

**空白字符 (Whitespace characters)**（空格、制表符和换行符）通常不属于标记的一部分；唯一的例外是字符串常量内部。空白的目的是增强可读性并分隔标记。

再次考虑之前的 SQL 语句：

`select a from x, z where b = 3`

词法分析器为其创建了十个标记，如 图 9.1 所示。

**图 9.1 词法分析器生成的标记 (Tokens produced by the lexical analyzer)**

| **类型**      | **值**   |
| ------------- | -------- |
| `keyword`     | `select` |
| `identifier`  | `a`      |
| `keyword`     | `from`   |
| `identifier`  | `x`      |
| `delimiter`   | `,`      |
| `identifier`  | `z`      |
| `keyword`     | `where`  |
| `identifier`  | `b`      |
| `delimiter`   | `=`      |
| `intconstant` | `3`      |

从概念上讲，词法分析器的行为很简单——它一次读取一个字符的输入字符串，当它确定下一个标记已被读取时停止。词法分析器的复杂性与标记类型的集合成正比：要查找的标记类型越多，实现就越复杂。

Java 提供了两种不同的内置标记器（它们对词法分析器的术语）：一个在 `StringTokenizer` 类中，另一个在 `StreamTokenizer` 类中。`StringTokenizer` 更简单易用，但它只支持两种类型的标记：分隔符和单词（即分隔符之间的子字符串）。这不适用于 SQL，特别是由于 `StringTokenizer` 不理解数字或带引号的字符串。另一方面，`StreamTokenizer` 具有广泛的标记类型集，包括支持 SimpleDB 使用的所有五种类型。

图 9.2 给出了 `TokenizerTest` 类的代码，它演示了 `StreamTokenizer` 的用法。代码对给定的一行输入进行标记化，并打印每个标记的类型和值。

`tok.ordinaryChar('.')` 调用告诉标记器将句点解释为分隔符。（尽管 SimpleDB 中不使用句点，但将其标识为分隔符很重要，以防止它们被接受为标识符的一部分。）相反，`tok.wordChars('_', '_')` 调用告诉标记器将下划线解释为标识符的一部分。`tok.lowerCaseMode(true)` 调用告诉标记器将所有字符串标记（但不包括带引号的字符串）转换为小写，这使得 SQL 对关键字和标识符不区分大小写。

`nextToken` 方法将标记器定位在流中的下一个标记处；返回值为 `TT_EOF` 表示没有更多标记。标记器的公共变量 `ttype` 保存当前标记的类型。值 `TT_NUMBER` 表示数字常量，`TT_WORD` 表示标识符或关键字，单引号的整数表示表示字符串常量。单字符分隔符标记的类型是该字符的整数表示。

**图 9.2 `TokenizerTest` 类 (The class TokenizerTest)**

```java
import java.io.*;
import java.util.*;

public class TokenizerTest {
    // 预定义的关键字集合
    private static Collection<String> keywords =
            Arrays.asList("select", "from", "where", "and", "insert",
                    "into", "values", "delete", "update", "set",
                    "create", "table", "int", "varchar", "view", "as",
                    "index", "on");

    public static void main(String[] args) throws IOException {
        String s = getStringFromUser(); // 从用户获取输入字符串
        StreamTokenizer tok = new StreamTokenizer(new StringReader(s)); // 使用 StreamTokenizer 处理字符串
        tok.ordinaryChar('.'); // 将句点视为普通字符（即分隔符，不属于单词）
        tok.wordChars('_', '_'); // 将下划线视为单词的一部分
        tok.lowerCaseMode(true); // 将标识符和关键字转换为小写

        // 循环直到文件结束
        while (tok.nextToken() != StreamTokenizer.TT_EOF) {
            printCurrentToken(tok); // 打印当前标记的信息
        }
    }

    // 从用户获取一行输入
    private static String getStringFromUser() {
        System.out.println("Enter tokens:");
        Scanner sc = new Scanner(System.in);
        String s = sc.nextLine();
        sc.close();
        return s;
    }

    // 打印当前标记的类型和值
    private static void printCurrentToken(StreamTokenizer tok) throws IOException {
        if (tok.ttype == StreamTokenizer.TT_NUMBER) {
            System.out.println("IntConstant " + (int) tok.nval); // 如果是数字，打印整数常量
        } else if (tok.ttype == StreamTokenizer.TT_WORD) {
            String word = tok.sval;
            if (keywords.contains(word)) {
                System.out.println("Keyword " + word); // 如果是预定义关键字，打印关键字
            } else {
                System.out.println("Id " + word); // 否则，打印标识符
            }
        } else if (tok.ttype == '\'') {
            System.out.println("StringConstant " + tok.sval); // 如果是单引号，打印字符串常量
        } else {
            System.out.println("Delimiter " + (char) tok.ttype); // 否则，打印分隔符
        }
    }
}
```

## 9.3 The SimpleDB Lexical Analyzer

`StreamTokenizer` 类是一个通用词法分析器，但使用起来可能很笨拙。SimpleDB 的 `Lexer` 类提供了一种更简单的方式供解析器访问标记流。解析器可以调用两种方法：查询当前标记信息的方法，以及告诉词法分析器“消费”当前标记（返回其值并移动到下一个标记）的方法。每种标记类型都有一对相应的方法。这些十个方法的 API 如 图 9.3 所示。

前五个方法返回有关当前标记的信息。`matchDelim` 方法如果当前标记是具有指定值的分隔符，则返回 `true`。类似地，`matchKeyword` 方法如果当前标记是具有指定值的关键字，则返回 `true`。其他三个 `matchXXX` 方法如果当前标记是正确类型，则返回 `true`。

后五个方法“消费”当前标记。每个方法都调用其相应的 `matchXXX` 方法。如果该方法返回 `false`，则抛出异常；否则，下一个标记变为当前标记。此外，`eatIntConstant`、`eatStringConstant` 和 `eatId` 方法返回当前标记的值。

**图 9.3 SimpleDB 词法分析器的 API (The API for the SimpleDB lexical analyzer)**

**Lexer**

- `public boolean matchDelim(char d);` // 检查是否是指定分隔符
- `public boolean matchIntConstant();` // 检查是否是整数常量
- `public boolean matchStringConstant();`// 检查是否是字符串常量
- `public boolean matchKeyword(String w);`// 检查是否是指定关键字
- `public boolean matchId();`           // 检查是否是标识符
- `public void eatDelim(char d);`       // 消费指定分隔符
- `public int eatIntConstant();`        // 消费整数常量并返回其值
- `public String eatStringConstant();`  // 消费字符串常量并返回其值
- `public void eatKeyword(String w);`   // 消费指定关键字
- `public String eatId();`              // 消费标识符并返回其值

图 9.4 中的 `LexerTest` 类演示了这些方法的用法。代码读取输入行。它期望每行都是 “A = c” 或 “c = A” 的形式，其中 A 是标识符，c 是整数常量。任何其他形式的输入行都会生成异常。

`Lexer` 的代码如 图 9.5 所示。其构造函数设置了流标记器。`eatIntConstant`、`eatStringConstant` 和 `eatId` 方法返回当前标记的值。`initKeywords` 方法构造了 SimpleDB 版本 SQL 中使用的关键字集合。

**图 9.4 `LexerTest` 类 (The class LexerTest)**

```java
import java.util.Scanner;

public class LexerTest {
    public static void main(String[] args) {
        String x = "";
        int y = 0;
        Scanner sc = new Scanner(System.in);
        while (sc.hasNext()) { // 循环读取用户输入行
            String s = sc.nextLine();
            Lexer lex = new Lexer(s); // 为每行创建一个新的 Lexer 实例

            if (lex.matchId()) { // 检查是否以标识符开头 (例如 "id = 123")
                x = lex.eatId();       // 消费并获取标识符
                lex.eatDelim('=');     // 消费等号分隔符
                y = lex.eatIntConstant(); // 消费并获取整数常量
            } else { // 否则，期望以整数常量开头 (例如 "123 = id")
                y = lex.eatIntConstant(); // 消费并获取整数常量
                lex.eatDelim('=');     // 消费等号分隔符
                x = lex.eatId();       // 消费并获取标识符
            }
            System.out.println(x + " equals " + y); // 打印结果
        }
        sc.close();
    }
}
```

**图 9.5 SimpleDB `Lexer` 类的代码 (The code for the SimpleDB class Lexer)**

```java
import java.io.*;
import java.util.*;

public class Lexer {
    private Collection<String> keywords;
    private StreamTokenizer tok;

    public Lexer(String s) {
        initKeywords(); // 初始化关键字集合
        tok = new StreamTokenizer(new StringReader(s)); // 创建 StreamTokenizer
        tok.ordinaryChar('.'); // 将句点视为普通字符 (分隔符)
        tok.wordChars('_', '_'); // 将下划线视为单词字符
        tok.lowerCaseMode(true); // 将标识符和关键字转换为小写
        nextToken(); // 初始化时读取第一个标记
    }

    // --- 检查当前标记状态的方法 ---

    // 检查当前标记是否是指定分隔符
    public boolean matchDelim(char d) {
        return d == (char) tok.ttype;
    }

    // 检查当前标记是否是整数常量
    public boolean matchIntConstant() {
        return tok.ttype == StreamTokenizer.TT_NUMBER;
    }

    // 检查当前标记是否是字符串常量 (通过检查其类型是否为单引号的ASCII值)
    public boolean matchStringConstant() {
        return '\'' == (char) tok.ttype;
    }

    // 检查当前标记是否是指定关键字
    public boolean matchKeyword(String w) {
        // 必须是单词类型且其值等于指定关键字
        return tok.ttype == StreamTokenizer.TT_WORD && tok.sval.equals(w);
    }

    // 检查当前标记是否是标识符 (是单词类型但不是关键字)
    public boolean matchId() {
        return tok.ttype == StreamTokenizer.TT_WORD && !keywords.contains(tok.sval);
    }

    // --- “消费”当前标记的方法 ---

    // 消费指定分隔符
    public void eatDelim(char d) {
        if (!matchDelim(d)) // 如果不匹配，抛出语法错误
            throw new BadSyntaxException();
        nextToken(); // 移动到下一个标记
    }

    // 消费整数常量并返回其值
    public int eatIntConstant() {
        if (!matchIntConstant())
            throw new BadSyntaxException();
        int i = (int) tok.nval; // 获取整数值
        nextToken();
        return i;
    }

    // 消费字符串常量并返回其值
    public String eatStringConstant() {
        if (!matchStringConstant())
            throw new BadSyntaxException();
        String s = tok.sval; // 获取字符串值
        nextToken();
        return s;
    }

    // 消费指定关键字
    public void eatKeyword(String w) {
        if (!matchKeyword(w))
            throw new BadSyntaxException();
        nextToken();
    }

    // 消费标识符并返回其值
    public String eatId() {
        if (!matchId())
            throw new BadSyntaxException();
        String s = tok.sval; // 获取标识符值
        nextToken();
        return s;
    }

    // 读取下一个标记
    private void nextToken() {
        try {
            tok.nextToken(); // 调用 StreamTokenizer 的 nextToken
        } catch (IOException e) {
            throw new BadSyntaxException(); // 将 IOException 转换为 BadSyntaxException
        }
    }

    // 初始化 SimpleDB SQL 的关键字集合
    private void initKeywords() {
        keywords = Arrays.asList("select", "from", "where", "and", "insert",
                "into", "values", "delete", "update", "set", "create", "table",
                "varchar", "int", "view", "as", "index", "on");
    }
}
```

`StreamTokenizer` 的 `nextToken` 方法会抛出 `IOException`。`Lexer` 的 `nextToken` 方法将此异常转换为 `BadSyntaxException`，该异常会传递回客户端（并转换为 `SQLException`，如第 11 章所述）。
