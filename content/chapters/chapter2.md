---
typora-root-url: ./..\..\public
---

# JDBC

数据库应用程序通过调用其 API 的方法与数据库引擎交互。Java 应用程序使用的 API 称为 **JDBC** (Java DataBase Connectivity)。JDBC 库由五个 Java 包组成，其中大部分实现了只有在大型商业应用程序中才使用的**高级功能**。本章关注 `java.sql` 包中的核心 JDBC 功能。此核心功能可分为两部分：**基本 JDBC**，包含基本使用所需的类和方法；**高级 JDBC**，包含提供额外便利和灵活性的可选功能。

## 2.1 基础JDBC (Basic JDBC)

JDBC 的基本功能体现在五个接口中：`Driver`、`Connection`、`Statement`、`ResultSet` 和 `ResultSetMetadata`。此外，这些接口中只有极少数方法是必不可少的。图 2.1 列出了这些方法。

```java
Driver
public Connection connect(String url, Properties prop)

Connection
public Statement createStatement() throws SQLException;
public void close() throws SQLException;

Statement
public ResultSet executeQuery(String qry) throws SQLException;
public int executeUpdate(String cmd) throws SQLException;
public void close() throws SQLException;

ResultSet
public boolean next() throws SQLException;
public int getInt() throws SQLException;
public String getString() throws SQLException;
public void close() throws SQLException;
public ResultSetMetaData getMetaData() throws SQLException;

ResultSetMetaData
public int getColumnCount() throws SQLException;
public String getColumnName(int column) throws SQLException;
public int getColumnType(int column) throws SQLException;
public int getColumnDisplaySize(int column) throws SQLException;
```

**Fig. 2.1 The APIs for basic JDBC**

```Java
import java.sql.Driver;
import java.sql.Connection;
import org.apache.derby.jdbc.ClientDriver;

public class CreateTestDB {
public static void main(String[] args) {
    String url = "jdbc:derby://localhost/testdb;create=true";
    Driver d = new ClientDriver();
 try {
     Connection conn = d.connect(url, null);
        System.out.println("Database Created");
     conn.close();
 }
 catch(SQLException e) {e.printStackTrace();
 }
  }
}

```

**Fig. 2.2 The JDBC code for the CreateTestDB client**

本节的示例程序将说明这些方法的用法。第一个示例程序是 `CreateTestDB`，它说明了程序如何连接和断开 Derby 引擎。其代码出现在图 2.2 中，其中 JDBC 相关代码以**粗体显示**。以下小节将详细检查此代码。

### 2.1.1 连接到数据库引擎 (Connecting to a Database Engine)

每个数据库引擎都有自己（可能是专有的）与客户端建立连接的机制。另一方面，客户端希望尽可能独立于服务器。也就是说，客户端不想知道连接到引擎的复杂细节；它只希望引擎提供一个供客户端调用的类。这样的类称为**驱动程序**。

JDBC 驱动程序类实现 `Driver` 接口。Derby 和 SimpleDB 各有两个驱动程序类：一个用于基于服务器的连接，一个用于嵌入式连接。

- 连接到 Derby 引擎的**基于服务器的连接**使用 `ClientDriver` 类，而**嵌入式连接**使用 `EmbeddedDriver`；这两个类都在 `org.apache.derby.jdbc` 包中。
- 连接到 SimpleDB 引擎的**基于服务器的连接**使用 `NetworkDriver` 类（在 `simpledb.jdbc.network` 包中），而**嵌入式连接**使用 `EmbeddedDriver`（在 `simpledb.jdbc.embedded` 包中）。

客户端通过调用 `Driver` 对象的 `connect` 方法连接到数据库引擎。例如，图 2.2 中的以下三行代码建立了一个到 Derby 数据库的基于服务器的连接：

```java
String url = "jdbc:derby://localhost/testdb;create=true";
Driver d = new ClientDriver();
Connection conn = d.connect(url, null);
```

`connect` 方法接受两个参数。方法的第一个参数是**标识驱动程序、服务器（用于基于服务器的连接）和数据库的 URL**。此 URL 称为**连接字符串**，其语法与第 1 章中 `ij`（或 `SimpleIJ`）的基于服务器的连接字符串相同。图 2.2 中的连接字符串包含四个部分：

- 子字符串“`jdbc:derby:`”描述了客户端使用的**协议**。这里，协议表示此客户端是使用 JDBC 的 Derby 客户端。
- 子字符串“`//localhost`”描述了**服务器所在的机器**。除了 `localhost`，您可以替换任何域名或 IP 地址。
- 子字符串“`/testdb`”描述了**服务器上数据库的路径**。对于 Derby 服务器，路径从启动服务器的用户的当前目录开始。路径的末尾（这里是“`testdb`”）是此数据库的所有数据文件将存储的目录。
- 连接字符串的其余部分包含要发送给引擎的**属性值**。这里，子字符串是“`;create=true`”，它告诉引擎创建一个新数据库。通常，可以向 Derby 引擎发送多个属性值。例如，如果引擎需要用户认证，那么还会指定 `username` 和 `password` 属性的值。用户“einstein”的连接字符串可能如下所示：

```java
"jdbc:derby://localhost/testdb;create=true;user=einstein;password=emc2"
```

`connect` 的第二个参数是 `Properties` 类型的对象。此对象提供了向引擎传递属性值的另一种方式。在图 2.2 中，此参数的值为 `null`，因为所有属性都在连接字符串中指定。或者，您可以将属性规范放入第二个参数中，如下所示：

```java
String url = "jdbc:derby://localhost/testdb";
Properties prop = new Properties();
prop.put("create", "true");
prop.put("username", "einstein");
prop.put("password", "emc2");
Driver d = new ClientDriver();
Connection conn = d.connect(url, prop);
```

每个数据库引擎都有自己的连接字符串语法。SimpleDB 的基于服务器连接字符串与 Derby 不同，因为它只包含协议和机器名。（连接字符串包含数据库名称没有意义，因为数据库是在 SimpleDB 服务器启动时指定的。并且连接字符串不指定属性，因为 SimpleDB 服务器不支持任何属性。）例如，以下三行代码建立了一个到 SimpleDB 服务器的连接：

```java
String url = "jdbc:simpledb://localhost";
Driver d = new NetworkDriver();
conn = d.connect(url, null);
```

尽管驱动程序类和连接字符串语法是**供应商特定的**，但 JDBC 程序的其余部分是完全**供应商中立**的。例如，考虑图 2.2 中的变量 `d` 和 `conn`。它们对应的 JDBC 类型 `Driver` 和 `Connection` 都是接口。你可以从代码中看出变量 `d` 被赋值为一个 `ClientDriver` 对象。然而，`conn` 被赋值为 `connect` 方法返回的 `Connection` 对象，无法知道其实际类。这种情况适用于所有 JDBC 程序。除了驱动程序类的名称和其连接字符串之外，JDBC 程序只知道并关心供应商中立的 JDBC 接口。因此，一个基本的 JDBC 客户端将从两个包中导入：

- 内置的 `java.sql` 包，用于获取供应商中立的 JDBC 接口定义。
- 包含驱动程序类的供应商提供的包。

### 2.1.2 断开与数据库引擎的连接 (Disconnecting from a Database Engine)

当客户端连接到数据库引擎时，引擎可能会为客户端的使用分配资源。例如，客户端可能会向其服务器请求锁，以防止其他客户端访问数据库的部分。即使连接到引擎的能力也可以是一种资源。公司可能拥有与商业数据库系统签订的站点许可证，该许可证限制了同时连接的数量，这意味着持有连接可能会剥夺其他客户端连接的机会。由于连接持有宝贵的资源，因此期望客户端在不再需要数据库时立即断开与引擎的连接。客户端程序通过调用其 `Connection` 对象的 `close` 方法来断开与引擎的连接。在图 2.2 中可以看到对 `close` 的此调用。

### 2.1.3 SQL 异常 (SQL Exceptions)

客户端和数据库引擎之间的交互可能由于多种原因而产生异常。例如：

- 客户端要求引擎执行格式错误的 SQL 语句，或访问不存在的表，或比较两个不兼容的值的 SQL 查询。
- 引擎由于其与并发客户端之间的死锁而中止客户端。
- 引擎代码中存在错误。
- 客户端无法访问引擎（对于基于服务器的连接）。可能是主机名错误，或主机已无法访问。

不同的数据库引擎有自己处理这些异常的内部方式。例如，SimpleDB 在网络问题时抛出 `RemoteException`，在 SQL 语句问题时抛出 `BadSyntaxException`，在死锁时抛出 `BufferAbortException` 或 `LockAbortException`，在服务器问题时抛出通用的 `RuntimeException`。

为了使异常处理独立于供应商，JDBC 提供了自己的异常类，称为 `SQLException`。当数据库引擎遇到内部异常时，它将其封装在 `SQLException` 中并发送给客户端程序。与 `SQLException` 关联的消息字符串标识了导致它的内部异常。每个数据库引擎都可以自由提供自己的消息。例如，Derby 有近 900 条错误消息，而 SimpleDB 将所有可能的问题归结为六条消息：“网络问题”、“非法 SQL 语句”、“服务器错误”、“不支持的操作”以及两种形式的“事务中止”。

大多数 JDBC 方法（以及图 2.1 中的所有方法）都会抛出 `SQLException`。`SQLException` 是**受检异常**，这意味着客户端必须通过捕获它们或继续抛出它们来明确处理它们。图 2.2 中的两个 JDBC 方法在 `try` 块内执行；如果其中任何一个导致异常，代码会打印堆栈跟踪并返回。

请注意，图 2.2 的代码有一个问题，即当抛出异常时，其连接未关闭。这是一个**资源泄漏**的例子——客户端死亡后，引擎无法轻易回收连接的资源。解决问题的一种方法是在 `catch` 块内关闭连接。但是，`close` 方法需要在 `try` 块内调用，这意味着图 2.2 的 `catch` 块实际上应该如下所示：

```java
catch(SQLException e) {
    e.printStackTrace();
    try {
        conn.close();
    }
    catch (SQLException ex) {}
}
```

这开始变得难看。此外，如果 `close` 方法抛出异常，客户端应该怎么办？上面的代码忽略了它，但这似乎不太对。

更好的解决方案是让 Java 通过其 **`try-with-resources` 语法**自动关闭连接。要使用它，您可以在 `try` 关键字后面的括号内创建 `Connection` 对象。当 `try` 块结束时（正常结束或通过异常结束），Java 将隐式调用对象的 `close` 方法。图 2.2 的改进 `try` 块如下所示：

``` java
try (Connection conn = d.connect(url, null)) {
    System.out.println("Database Created");
}
catch (SQLException e) {
    e.printStackTrace();
}
```

这段代码正确处理了所有异常，同时不失图 2.2 的简洁性。

### 2.1.4 执行 SQL 语句 (Executing SQL Statements)

可以将连接视为与数据库引擎的“会话”，在此期间引擎为客户端执行 SQL 语句。JDBC 如下支持此概念：

`Connection` 对象有一个 `createStatement` 方法，该方法返回一个 `Statement` 对象。`Statement` 对象有两种执行 SQL 语句的方式：`executeQuery` 和 `executeUpdate` 方法。它还有一个 `close` 方法，用于解除分配对象持有的资源。

图 2.3 显示了一个客户端程序，它调用 `executeUpdate` 来修改 Amy 的 STUDENT 记录的 `MajorId` 值。该方法的参数是一个表示 SQL 更新语句的字符串；该方法返回更新的记录数。

```java
public class ChangeMajor {
    public static void main(String[] args) {
        String url = "jdbc:derby://localhost/studentdb";
        String cmd = "update STUDENT set MajorId=30 where SName='amy'";
        Driver d = new ClientDriver();
        try ( Connection conn = d.connect(url, null);
             Statement stmt = conn.createStatement()) {
             int howmany = stmt.executeUpdate(cmd);                                                                      System.out.println(howmany + " records changed.");                                                      }catch(SQLException e) {
             e.printStackTrace();
         }
    }
}
```

Fig. 2.3 JDBC code for the ChangeMajor client

`Statement` 对象，就像 `Connection` 对象一样，需要关闭。最简单的解决方案是在 `try` 块中自动关闭这两个对象。

SQL 命令的规范说明了一个有趣的观点。由于命令存储为 Java 字符串，因此它用双引号括起来。另一方面，SQL 中的字符串使用单引号。这种区别使您的生活变得轻松，因为您不必担心引号字符具有两种不同的含义——SQL 字符串使用单引号，Java 字符串使用双引号。

`ChangeMajor` 代码假定存在一个名为“`studentdb`”的数据库。SimpleDB 分发版包含 `CreateStudentDB` 类，该类创建数据库并使用图 1.1 的表填充它。它应该是使用大学数据库时调用的第一个程序。其代码出现在图 2.4 中。该代码执行 SQL 语句以创建五个表并向其中插入记录。为简洁起见，仅显示 STUDENT 的代码。

### 2.1.5 结果集 (Result Sets)

`Statement` 的 `executeQuery` 方法执行 SQL 查询。此方法的参数是一个表示 SQL 查询的字符串，它返回一个 `ResultSet` 类型的对象。`ResultSet` 对象表示查询的输出记录。客户端可以搜索结果集以检查这些记录。

例如，一个说明结果集用法的程序是图 2.5 所示的 `StudentMajor` 类。它对 `executeQuery` 的调用返回一个包含每个学生的姓名和专业的**结果集**。随后的 `while` 循环打印结果集中的每条记录。

一旦客户端获得结果集，它就通过调用 `next` 方法遍历输出记录。此方法移动到下一条记录，如果移动成功则返回 `true`，如果没有更多记录则返回 `false`。通常，客户端使用循环遍历所有记录，依次处理每条记录。

一个新的 `ResultSet` 对象总是定位在第一条记录之前，因此在查看第一条记录之前，您需要调用 `next`。由于此要求，遍历记录的典型方式如下所示：

```java
public class CreateStudentDB {
    public static void main(String[] args) {
        String url = "jdbc:derby://localhost/studentdb;create=true";
        Driver d = new ClientDriver();
        try (Connection conn = d.connect(url, null);
             Statement stmt = conn.createStatement()) {
            String s = "create table STUDENT(SId int, SName varchar(10), MajorId int, GradYear int)";
            stmt.executeUpdate(s);
            System.out.println("Table STUDENT created.");

            s = "insert into STUDENT(SId, SName, MajorId, GradYear) values ";
            String[] studvals = {
                "(1, 'joe', 10, 2021)",
                "(2, 'amy', 20, 2020)",
                "(3, 'max', 10, 2022)",
                "(4, 'sue', 20, 2022)",
                "(5, 'bob', 30, 2020)",
                "(6, 'kim', 20, 2020)",
                "(7, 'art', 30, 2021)",
                "(8, 'pat', 20, 2019)",
                "(9, 'lee', 10, 2021)"
            };
            for (int i = 0; i < studvals.length; i++)
                stmt.executeUpdate(s + studvals[i]);
            System.out.println("STUDENT records inserted.");
            // ... (省略了其他表的创建和插入代码)
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }
}
```

**图 2.4 CreateStudentDB 客户端的 JDBC 代码**

```java
String qry = "select ...";
ResultSet rs = stmt.executeQuery(qry);
while (rs.next()) {
    // ... 处理记录
}
```

图 2.5 中显示了这样一个循环的示例。在此循环的第 n 次遍历中，变量 `rs` 将定位在结果集的第 n 条记录处。当没有更多记录需要处理时，循环将结束。

处理记录时，客户端使用 `getInt` 和 `getString` 方法检索其字段的值。每个方法都接受一个字段名作为参数并返回该字段的值。在图 2.5 中，代码检索并打印每条记录的 `SName` 和 `DName` 字段的值。

```java
public class StudentMajor {
    public static void main(String[] args) {
        String url = "jdbc:derby://localhost/studentdb";
        String qry = "select SName, DName from DEPT, STUDENT " + "where MajorId = DId";
        Driver d = new ClientDriver();
        try (Connection conn = d.connect(url, null);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(qry)) {
            System.out.println("Name\tMajor");
            while (rs.next()) {
                String sname = rs.getString("SName");
                String dname = rs.getString("DName");
                System.out.println(sname + "\t" + dname);
            }
        } catch (SQLException e) {
            e.printStackTrace();
        }
    }
}
```

**图 2.5 StudentMajor 客户端的 JDBC 代码**

结果集会占用引擎上的宝贵资源。`close` 方法会释放这些资源并将其提供给其他客户端。因此，客户端应努力成为“好公民”，并尽快关闭结果集。一种选择是显式调用 `close`，通常在上述 `while` 循环的末尾。另一种选择，如 图 2.5 所示，是使用 Java 的**自动关闭机制**。

### 2.1.6 使用查询元数据 (Using Query Metadata)

结果集的**模式**定义为每个字段的名称、类型和显示大小。此信息通过 `ResultSetMetaData` 接口提供。

当客户端执行查询时，它通常知道输出表的模式。例如，`StudentMajor` 客户端中硬编码的知识是其结果集包含两个字符串字段 `SName` 和 `DName`。

然而，假设一个客户端程序允许用户提交查询作为输入。程序可以对查询的结果集调用 `getMetaData` 方法，该方法返回一个 `ResultSetMetaData` 类型的对象。然后它可以调用此对象的方法来确定输出表的模式。例如，图 2.6 中的代码使用 `ResultSetMetaData` 打印参数结果集的模式。

```java
void printSchema(ResultSet rs) throws SQLException {
    ResultSetMetaData md = rs.getMetaData();
    for (int i = 1; i <= md.getColumnCount(); i++) {
        String name = md.getColumnName(i);
        int size = md.getColumnDisplaySize(i);
        int typecode = md.getColumnType(i);
        String type;
        if (typecode == Types.INTEGER)
            type = "int";
        else if (typecode == Types.VARCHAR)
            type = "string";
        else
            type = "other";
        System.out.println(name + "\t" + type + "\t" + size);
    }
}
```

**图 2.6 使用 ResultSetMetaData 打印结果集的模式**

此代码说明了 `ResultSetMetaData` 对象的典型用法。它首先调用 `getColumnCount` 方法返回结果集中的字段数；然后它调用 `getColumnName`、`getColumnType` 和 `getColumnDisplaySize` 方法来确定每个列中字段的名称、类型和大小。请注意，列号从 1 开始，而不是您可能期望的 0。

`getColumnType` 方法返回一个编码字段类型的整数。这些代码在 JDBC 类 `Types` 中定义为常量。这个类包含 30 种不同类型的代码，这应该让您了解 SQL 语言的广泛程度。这些类型的实际值并不重要，因为 JDBC 程序应该始终按名称而不是值来引用代码。

一个需要元数据知识的客户端很好的例子是命令解释器。第 1 章中的 `SimpleIJ` 程序就是这样一个程序；它的代码出现在图 2.7 中。由于这是您遇到的第一个非平凡的 JDBC 客户端示例，您应该仔细检查其代码。

`main` 方法首先从用户那里读取连接字符串，并用它来确定要使用的正确驱动程序。代码在连接字符串中查找字符“`//`”。如果这些字符出现，则字符串必须指定基于服务器的连接，否则为嵌入式连接。然后该方法通过将连接字符串传递给相应驱动程序的 `connect` 方法来建立连接。

主方法在 `while` 循环的每次迭代中处理一行文本。如果文本是 SQL 语句，则会酌情调用 `doQuery` 或 `doUpdate` 方法。用户可以通过输入“`exit`”退出循环，此时程序退出。

```java
public class SimpleIJ {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        System.out.println("Connect> ");
        String s = sc.nextLine();
        Driver d = (s.contains("//")) ? new NetworkDriver() : new EmbeddedDriver();
        try (Connection conn = d.connect(s, null);
             Statement stmt = conn.createStatement()) {
            System.out.print("\nSQL> ");
            while (sc.hasNextLine()) {
                // process one line of input
                String cmd = sc.nextLine().trim();
                if (cmd.startsWith("exit"))
                    break;
                else if (cmd.startsWith("select"))
                    doQuery(stmt, cmd);
                else
                    doUpdate(stmt, cmd);
                System.out.print("\nSQL> ");
            }
        } catch (SQLException e) {
            e.printStackTrace();
        }
        sc.close();
    }

    private static void doQuery(Statement stmt, String cmd) {
        try (ResultSet rs = stmt.executeQuery(cmd)) {
            ResultSetMetaData md = rs.getMetaData();
            int numcols = md.getColumnCount();
            int totalwidth = 0;
            // print header
            for (int i = 1; i <= numcols; i++) {
                String fldname = md.getColumnName(i);
                int width = md.getColumnDisplaySize(i);
                totalwidth += width;
                String fmt = "%" + width + "s";
                System.out.format(fmt, fldname);
            }
            System.out.println();
            for (int i = 0; i < totalwidth; i++)
                System.out.print("-");
            System.out.println();

            // print records
            while (rs.next()) {
                for (int i = 1; i <= numcols; i++) {
                    String fldname = md.getColumnName(i);
                    int fldtype = md.getColumnType(i);
                    String fmt = "%" + md.getColumnDisplaySize(i);
                    if (fldtype == Types.INTEGER) {
                        int ival = rs.getInt(fldname);
                        System.out.format(fmt + "d", ival);
                    } else {
                        String sval = rs.getString(fldname);
                        System.out.format(fmt + "s", sval);
                    }
                }
                System.out.println();
            }
        } catch (SQLException e) {
            System.out.println("SQL Exception: " + e.getMessage());
        }
    }

    private static void doUpdate(Statement stmt, String cmd) {
        try {
            int howmany = stmt.executeUpdate(cmd);
            System.out.println(howmany + " records processed");
        } catch (SQLException e) {
            System.out.println("SQL Exception: " + e.getMessage());
        }
    }
}
```

图 2.7 SimpleIJ 客户端的 JDBC 代码

------

`doQuery` 方法执行查询并获取输出表的结果集和元数据。该方法的大部分内容都与确定值的正确间距有关。对 `getColumnDisplaySize` 的调用返回每个字段的空间要求；代码使用这些数字来构建格式字符串，以便字段值能够正确对齐。这段代码的复杂性说明了“魔鬼藏在细节中”这句格言。也就是说，概念上困难的任务由于 `ResultSet` 和 `ResultSetMetaData` 方法而易于编码，而对齐数据这种看似简单的任务却占据了大部分编码工作。

`doQuery` 和 `doUpdate` 方法通过打印错误消息并返回来捕获异常。这种错误处理策略允许主循环继续接受语句，直到用户输入“`exit`”命令。
