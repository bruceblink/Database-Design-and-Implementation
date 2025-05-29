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

`doQuery` 方法执行查询并获取输出表的结果集和元数据。该方法的大部分内容都与确定值的正确间距有关。对 `getColumnDisplaySize` 的调用返回每个字段的空间要求；代码使用这些数字来构建格式字符串，以便字段值能够正确对齐。这段代码的复杂性说明了“魔鬼藏在细节中”这句格言。也就是说，概念上困难的任务由于 `ResultSet` 和 `ResultSetMetaData` 方法而易于编码，而对齐数据这种看似简单的任务却占据了大部分编码工作。

`doQuery` 和 `doUpdate` 方法通过打印错误消息并返回来捕获异常。这种错误处理策略允许主循环继续接受语句，直到用户输入“`exit`”命令。

## 2.2 高级 JDBC (Advanced JDBC)

基本 JDBC 相对简单易用，但它提供的与数据库引擎交互的方式相当有限。本节将介绍 JDBC 的一些附加功能，这些功能使客户端能够更好地控制数据库的访问方式。

### 2.2.1 隐藏驱动程序 (Hiding the Driver)

在基本 JDBC 中，客户端通过获取 `Driver` 对象实例并调用其 `connect` 方法来连接到数据库引擎。这种策略的问题在于它将供应商特定的代码放入客户端程序中。JDBC 包含两个**供应商中立的类**，用于将驱动程序信息从客户端程序中剔除：`DriverManager` 和 `DataSource`。让我们依次考虑它们。

##### 使用 `DriverManager` (Using DriverManager)

`DriverManager` 类维护着一个驱动程序集合。它包含静态方法来向集合添加驱动程序，以及搜索集合以查找可以处理给定连接字符串的驱动程序。其中两个方法出现在图 2.8 中。

```java
static public void registerDriver(Driver driver) throws SQLException;
static public Connection getConnection(String url, Properties p) throws SQLException;
```

**图 2.8 DriverManager 类的两个方法**

其思想是，客户端重复调用 `registerDriver` 来注册它可能使用的每个数据库的驱动程序。当客户端想要连接到数据库时，它只需要调用 `getConnection` 方法并为其提供连接字符串。驱动程序管理器会尝试在其集合中的每个驱动程序上使用连接字符串，直到其中一个返回非空连接。

例如，考虑图 2.9 的代码。前两行将基于服务器的 Derby 和 SimpleDB 驱动程序注册到驱动程序管理器。后两行建立与 Derby 服务器的连接。客户端在调用 `getConnection` 时不需要指定驱动程序；它只指定连接字符串。驱动程序管理器确定使用其注册的哪个驱动程序。

Java

```java
DriverManager.registerDriver(new ClientDriver());
DriverManager.registerDriver(new NetworkDriver());
String url = "jdbc:derby://localhost/studentdb";
Connection c = DriverManager.getConnection(url);
```

**图 2.9 使用 DriverManager 连接到 Derby 服务器**

图 2.9 中 `DriverManager` 的使用方式并不特别令人满意，因为驱动程序信息并没有被隐藏——它就在 `registerDriver` 的调用中。JDBC 通过允许在 Java 系统属性文件中指定驱动程序来解决这个问题。例如，可以通过将以下行添加到文件中来注册 Derby 和 SimpleDB 驱动程序：

```java
jdbc.drivers=org.apache.derby.jdbc.ClientDriver:simpledb.remote.NetworkDriver
```

将驱动程序信息放入属性文件是一种从客户端代码中删除驱动程序规范的优雅方式。通过更改这一个文件，您可以修改所有 JDBC 客户端使用的驱动程序信息，而无需重新编译任何代码。

##### 使用 `DataSource` (Using DataSource)

尽管驱动程序管理器可以向 JDBC 客户端隐藏驱动程序，但它无法隐藏连接字符串。特别是，上述示例中的连接字符串包含“`jdbc:derby`”，因此很明显意图使用哪个驱动程序。JDBC 的一个最新添加是 `javax.sql` 包中的 `DataSource` 接口。这目前是管理驱动程序的首选策略。

`DataSource` 对象封装了驱动程序和连接字符串，从而使客户端能够连接到引擎而无需知道任何连接细节。要在 Derby 中创建数据源，您需要 Derby 提供的类 `ClientDataSource`（用于基于服务器的连接）和 `EmbeddedDataSource`（用于嵌入式连接），它们都实现了 `DataSource` 接口。客户端代码可能如下所示：

Java

```java
ClientDataSource ds = new ClientDataSource();
ds.setServerName("localhost");
ds.setDatabaseName("studentdb");
Connection conn = ds.getConnection();
```

每个数据库供应商都提供自己的实现 `DataSource` 的类。由于这些类是供应商特定的，它们可以封装其驱动程序的详细信息，例如驱动程序名称和连接字符串的语法。使用它们的程序只需要指定必要的数值。

使用数据源的好处是客户端不再需要知道驱动程序的名称或连接字符串的语法。然而，该类仍然是供应商特定的，因此客户端代码仍然不是完全独立于供应商。

这个问题可以通过多种方式解决。

一种解决方案是**数据库管理员将 `DataSource` 对象保存到文件中**。DBA 可以创建对象并使用 Java 序列化将其写入文件。然后客户端可以通过读取文件并反序列化回 `DataSource` 对象来获取数据源。此解决方案类似于使用属性文件。一旦 `DataSource` 对象保存到文件中，任何 JDBC 客户端都可以使用它。DBA 只需替换该文件的内容即可更改数据源。

第二种解决方案是**使用命名服务器（例如 JNDI 服务器）而不是文件**。DBA 将 `DataSource` 对象放在命名服务器上，然后客户端从服务器请求数据源。鉴于命名服务器是许多计算环境的常见部分，此解决方案通常易于实现，尽管其细节超出了本书的范围。

### 2.2.2 显式事务处理 (Explicit Transaction Handling)

每个 JDBC 客户端都作为一系列**事务**运行。从概念上讲，事务是一个“工作单元”，这意味着它的所有数据库交互都被视为一个单元。例如，如果事务中的一个更新失败，引擎将确保该事务所做的所有更新都将失败。

当其当前工作单元成功完成时，事务就**提交**。数据库引擎通过使所有修改永久化并释放分配给该事务的任何资源（例如，锁）来执行提交。一旦提交完成，引擎就会启动一个新事务。

当事务无法提交时，它就会**回滚**。数据库引擎通过撤销该事务所做的所有更改、释放锁并启动一个新事务来执行回滚。已提交或回滚的事务被称为已**完成**。

事务在基本 JDBC 中是**隐式的**。数据库引擎选择每个事务的边界，决定何时应该提交事务以及是否应该回滚。这种情况称为**自动提交**。

在自动提交期间，引擎在自己的事务中执行每个 SQL 语句。如果语句成功完成，引擎会提交事务，否则会回滚事务。更新命令在 `executeUpdate` 方法完成时立即完成，查询在查询的结果集关闭时完成。

事务会累积锁，这些锁直到事务提交或回滚后才会释放。因为这些锁可能导致其他事务等待，所以较短的事务可以实现更高的并发性。此原则意味着在自动提交模式下运行的客户端应尽快关闭其结果集。

自动提交是 JDBC 客户端的合理默认模式。每条 SQL 语句一个事务会导致短事务，通常是正确的做法。然而，在某些情况下，事务应该由多个 SQL 语句组成。

一个不希望自动提交的情况是当客户端需要同时激活两个语句时。例如，考虑图 2.10 的代码片段。这段代码首先执行一个检索所有课程的查询。然后它循环遍历结果集，询问用户是否应该删除每门课程。如果应该删除，它就执行一个 SQL 删除语句来完成。

```java
DataSource ds = ...
Connection conn = ds.getConnection();
Statement stmt1 = conn.createStatement();
Statement stmt2 = conn.createStatement();
ResultSet rs = stmt1.executeQuery("select * from COURSE");
while (rs.next()) {
    String title = rs.getString("Title");
    boolean goodCourse = getUserDecision(title);
    if (!goodCourse) {
        int id = rs.getInt("CId");
        stmt2.executeUpdate("delete from COURSE where CId =" + id);
    }
}
rs.close();
```

**图 2.10 在自动提交模式下可能行为不正确的代码**

```java
DataSource ds = ...
Connection conn = ds.getConnection();
Statement stmt = conn.createStatement();
String cmd1 = "update SECTION set Prof= 'brando' where SectId = 43";
String cmd2 = "update SECTION set Prof= 'einstein' where SectId = 53";
stmt.executeUpdate(cmd1);
// suppose that the engine crashes at this point
stmt.executeUpdate(cmd2);
```

**图 2.11 在自动提交模式下可能行为不正确的更多代码**

这段代码的问题在于，删除语句将在记录集仍然打开时执行。由于一个连接一次只支持一个事务，它必须在创建新事务以执行删除之前，抢先提交查询的事务。并且由于查询的事务已经提交，访问记录集的其余部分实际上没有意义。代码将抛出异常或具有不可预测的行为。

当数据库的多个修改需要同时发生时，自动提交也是不希望的。图 2.11 的代码片段提供了一个示例。代码的意图是交换教授教授班级 43 和 53。但是，如果在第一次调用 `executeUpdate` 之后但在第二次调用之前引擎崩溃，则数据库将变得不正确。这段代码需要两个 SQL 语句在同一个事务中发生，以便它们要么一起提交，要么一起回滚。

```java
public void setAutoCommit(boolean ac) throws SQLException;
public void commit() throws SQLException;
public void rollback() throws SQLException;
```

**图 2.12 显式事务处理的 Connection 方法**

自动提交模式也可能不方便。假设您的程序正在执行多次插入，例如从文本文件加载数据。如果程序运行时引擎崩溃，那么一些记录将被插入，一些则不会。确定程序在哪里失败并重写它以仅插入缺失的记录可能会很繁琐和耗时。更好的替代方案是将所有插入命令放在同一个事务中。这样，在系统崩溃后，它们都将被回滚，并且可以简单地重新运行客户端。

`Connection` 接口包含三个方法，允许客户端显式处理其事务。图 2.12 给出了它们的 API。客户端通过调用 `setAutoCommit(false)` 来关闭自动提交。客户端通过调用 `commit` 或 `rollback`（根据需要）来完成当前事务并启动一个新事务。

当客户端关闭自动提交时，它承担了回滚失败的 SQL 语句的责任。特别是，如果在事务期间抛出异常，则客户端必须在其异常处理代码中回滚该事务。例如，再次考虑图 2.10 中不正确的代码片段。一个更正的版本出现在图 2.13 中。代码在创建连接后立即调用 `setAutoCommit`，并在语句完成后立即调用 `commit`。`catch` 块包含对 `rollback` 的调用。此调用需要放在自己的 `try` 块内，以防它抛出异常。乍一看，回滚期间的异常似乎可能损坏数据库，如 图 2.11 所示。幸运的是，数据库回滚算法旨在处理这种可能性；第 5 章包含了 remarkable 的细节。因此，图 2.13 中的代码可以合法地忽略失败的回滚，因为它知道数据库引擎会纠正错误。

```java
DataSource ds = ... // 这里假设 DataSource 对象 ds 已经初始化
try (Connection conn = ds.getConnection()) {
    // 关闭自动提交，以便手动管理事务
    conn.setAutoCommit(false); 
    Statement stmt = conn.createStatement();
    ResultSet rs = stmt.executeQuery("select * from COURSE");

    while (rs.next()) {
        String title = rs.getString("Title");
        boolean goodCourse = getUserDecision(title); // 假设此方法根据用户输入决定是否删除课程
        if (!goodCourse) {
            int id = rs.getInt("CId");
            // 在同一个事务中执行删除操作
            stmt.executeUpdate("delete from COURSE where CId =" + id); 
        }
    }
    // 关闭 ResultSet 和 Statement 以释放资源
    rs.close(); 
    stmt.close();
    // 提交所有更改
    conn.commit(); 
} catch (SQLException e) {
    e.printStackTrace();
    try {
        // 如果发生异常，回滚事务
        if (conn != null) 
            conn.rollback();
    } catch (SQLException e2) {
        // 忽略回滚期间可能发生的异常，因为数据库引擎会处理这种情况
    }
}
```

**图 2.13 图 2.10 的修改版，显式处理事务**

### 2.2.3 事务隔离级别 (Transaction Isolation Levels)

数据库服务器通常同时有多个客户端处于活动状态，每个客户端都在运行自己的事务。通过**并发执行**这些事务，服务器可以提高它们的吞吐量和响应时间。因此，并发是件好事。然而，**不受控制的并发**可能会导致问题，因为一个事务可能会以意想不到的方式修改另一个事务使用的数据，从而干扰该事务。以下是三个示例，演示了可能出现的问题类型。

#### 示例 1: 读取未提交数据 (Example 1: Reading Uncommitted Data)

再次考虑图 2.11 的代码，该代码交换两个班级的教授，并假设它作为一个事务运行（即关闭自动提交）。称此事务为 T1。另外，假设大学已决定根据所授课程的数量向教授发放奖金；因此它执行事务 T2，该事务计算每个教授所授的课程数量。此外，假设这两个事务恰好并发运行——特别是，假设 T2 在 T1 的第一个更新语句之后立即开始并执行完成。结果是，布兰多教授和爱因斯坦教授将分别比他们应得的课程多获得一门和少获得一门，这将影响他们的奖金。

出了什么问题？每个事务在隔离状态下都是正确的，但它们一起导致大学发放错误的奖金。问题在于 T2 错误地假设它读取的记录是一致的，也就是说，它们彼此有意义。然而，**未提交事务写入的数据可能并非总是一致的**。在 T1 的情况下，不一致发生在仅进行两次修改中的一次修改时。当 T2 在此时读取未提交的修改记录时，不一致导致它进行了不正确的计算。

#### 示例 2: 现有记录的意外更改 (Example 2: Unexpected Changes to an Existing Record)

对于此示例，假设 `STUDENT` 表包含一个名为 `MealPlanBal` 的字段，表示学生在食堂购买食物的金额。

```java
// (a)
DataSource ds = ...
Connection conn = ds.getConnection();
conn.setAutoCommit(false);
Statement stmt = conn.createStatement();
ResultSet rs = stmt.executeQuery("select MealPlanBal from STUDENT " + "where SId = 1");
rs.next();
int balance = rs.getInt("MealPlanBal");
rs.close();
int newbalance = balance - 10;
if (newbalance < 0)
    throw new NoFoodAllowedException("You cannot afford this meal");
stmt.executeUpdate("update STUDENT " + "set MealPlanBal = " + newbalance + " where SId = 1");
conn.commit();

// (b)
DataSource ds = ...
Connection conn = ds.getConnection();
conn.setAutoCommit(false);
Statement stmt = conn.createStatement();
stmt.executeUpdate("update STUDENT " + "set MealPlanBal = MealPlanBal + 1000 " + "where SId = 1");
conn.commit();
```

**图 2.14 两个可能导致更新“丢失”的并发事务。(a) 事务 T1 减少餐费余额，(b) 事务 T2 增加餐费余额**

考虑图 2.14 的两个事务。事务 T1 在 Joe 购买 10 美元午餐时执行。事务运行查询以查找他当前的余额，验证余额是否充足，并相应地减少他的余额。事务 T2 在 Joe 的父母寄来一张 1000 美元的支票，用于增加他的餐费余额时执行。该事务只是运行一个 SQL 更新语句来增加 Joe 的余额。

现在假设这两个事务在 Joe 有 50 美元余额时并发运行。特别是，假设 T2 在 T1 调用 `rs.close` 之后立即开始并执行完成。那么首先提交的 T2 将把余额修改为 1050 美元。然而，T1 没有意识到这个变化，仍然认为余额是 50 美元。因此它将余额修改为 40 美元并提交。结果是 1000 美元的存款没有计入他的余额，也就是说，更新“丢失”了。

这里的问题是事务 T1 错误地假设餐费余额的值在 T1 读取值和 T1 修改值之间不会改变。形式上，这种假设称为**可重复读 (repeatable read)**，因为事务假设重复从数据库中读取一个项将始终返回相同的值。

#### 示例 3: 记录数量的意外更改 (Example 3: Unexpected Changes to the Number of Records)

假设大学餐饮服务去年盈利 100,000 美元。大学觉得自己向学生收取过高费用，因此决定将利润平均分配给他们。也就是说，如果现有 1000 名学生，大学将向每位学生的餐费余额增加 100 美元。代码出现在图 2.15 中。

```java
DataSource ds = ...
Connection conn = ds.getConnection();
conn.setAutoCommit(false);
Statement stmt = conn.createStatement();
String qry = "select count(SId) as HowMany from STUDENT " + "where GradYear >= extract(year, current_date)";
ResultSet rs = stmt.executeQuery(qry);
rs.next();
int count = rs.getInt("HowMany");
rs.close();
int rebate = 100000 / count;
String cmd = "update STUDENT " + "set MealPlanBalance = MealPlanBalance + " + rebate + " where GradYear >= extract(year, current_date)";
stmt.executeUpdate(cmd);
conn.commit();
```

**图 2.15 一个可能发放超出预期回扣的事务**

此事务的问题在于，它假设在计算回扣金额和更新 `STUDENT` 记录之间，现有学生数量不会改变。但是假设在记录集关闭和更新语句执行之间，有几个新的 `STUDENT` 记录被插入到数据库中。这些新记录将错误地获得预先计算的回扣，大学最终将花费超过 100,000 美元用于回扣。这些新记录被称为**幻影记录 (phantom records)**，因为它们在事务开始后神秘地出现。

这些示例说明了当两个事务交互时可能出现的问题。保证任意事务不会出现问题的唯一方法是使其与所有其他事务**完全隔离**地执行。这种隔离形式称为**可串行化 (serializability)**，并将在第 5 章中详细讨论。不幸的是，可串行化事务可能运行得非常慢，因为它们要求数据库引擎显著减少允许的并发量。因此，JDBC 定义了**四种隔离级别**，允许客户端指定事务应该具有多少隔离：

- **读未提交 (Read-Uncommitted)** 隔离意味着完全没有隔离。这样的事务可能会遇到上述三个示例中的任何问题。
- **读已提交 (Read-Committed)** 隔离禁止事务访问未提交的值。与不可重复读和幻影相关的问题仍然可能发生。
- **可重复读 (Repeatable-Read)** 隔离扩展了读已提交，使得读总是可重复的。唯一可能的问题是由于幻影。
- **可串行化 (Serializable)** 隔离保证永远不会发生任何问题。

JDBC 客户端通过调用 `Connection` 方法 `setTransactionIsolation` 来指定其所需的隔离级别。例如，以下代码片段将隔离级别设置为可串行化：

```java
DataSource ds = ...
Connection conn = ds.getConnection();
conn.setAutoCommit(false);
conn.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
```

这四种隔离级别在执行速度和潜在问题之间存在**权衡**。也就是说，您希望事务运行得越快，您必须接受事务可能运行不正确的风险就越大。通过仔细分析客户端，可以缓解这种风险。

例如，您可能会说服自己，幻影和不可重复读不会是问题。例如，如果您的事务只执行插入操作，或者只删除特定的现有记录（如“`delete from STUDENT where SId = 1`”），则会出现这种情况。在这种情况下，读已提交的隔离级别将是快速且正确的。

再举一个例子，您可能会说服自己任何潜在问题都无关紧要。假设您的事务计算每年获得的平均成绩。您认为即使在事务执行期间可能发生成绩更改，这些更改也不太可能显著影响最终统计数据。在这种情况下，您可以合理地选择读已提交甚至读未提交的隔离级别。

许多数据库服务器（包括 Derby、Oracle 和 Sybase）的默认隔离级别是**读已提交**。此级别适用于在自动提交模式下由不熟悉的用户提出的简单查询。但是，如果您的客户端程序执行关键任务，那么仔细确定最合适的隔离级别同样关键。关闭自动提交模式的程序员必须非常小心地选择每个事务的正确隔离级别。

### 2.2.4 预处理语句 (Prepared Statements)

许多 JDBC 客户端程序是**参数化**的，它们接受用户输入的参数值并根据该参数执行 SQL 语句。`FindMajors` 演示客户端就是这样一个例子，其代码如 图 2.16 所示。

```java
public class FindMajors {
    public static void main(String[] args) {
        System.out.print("Enter a department name: ");
        Scanner sc = new Scanner(System.in);
        String major = sc.next();
        sc.close(); // 关闭 Scanner
        String qry = "select sname, gradyear from student, dept " + "where did = majorid and dname = '" + major + "'";
        ClientDataSource ds = new ClientDataSource();
        ds.setServerName("localhost");
        ds.setDatabaseName("studentdb");
        try (Connection conn = ds.getConnection();
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(qry)) {
            System.out.println("Here are the " + major + " majors");
            System.out.println("Name\tGradYear");
            while (rs.next()) {
                String sname = rs.getString("sname");
                int gradyear = rs.getInt("gradyear");
                System.out.println(sname + "\t" + gradyear);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

**图 2.16 FindMajors 的 JDBC 代码**

这个客户端首先要求用户输入一个系名。然后它将这个系名合并到它执行的 SQL 查询中。例如，假设用户输入了“math”。那么生成的 SQL 查询将是：

```sql
select SName, GradYear from STUDENT, DEPT where DId = MajorId and DName = 'math'
```

请注意，在生成查询时，代码是如何在系名周围显式添加单引号的。客户端可以使用**参数化 SQL 语句**来替代这种动态生成 SQL 语句的方式。参数化语句是一种 SQL 语句，其中“`?`”字符表示缺失的参数值。一个语句可以有多个参数，都用“`?`”表示。每个参数都有一个索引值，对应于它在字符串中的位置。例如，以下参数化语句删除所有毕业年份和专业尚未指定的学生。`GradYear` 的值被分配索引 1，`MajorId` 的值被分配索引 2。

```sql
delete from STUDENT where GradYear = ? and MajorId = ?
```

JDBC 类 `PreparedStatement` 处理参数化语句。客户端通过三个步骤处理预处理语句：

- 它为指定的参数化 SQL 语句创建一个 `PreparedStatement` 对象。
- 它为参数赋值。
- 它执行预处理语句。

例如，图 2.17 修改了 `FindMajors` 客户端以使用预处理语句。更改以粗体显示。最后三个粗体语句对应于上述三个要点。首先，客户端通过调用 `prepareStatement` 方法并传递参数化 SQL 语句作为参数来创建 `PreparedStatement` 对象。其次，客户端调用 `setString` 方法为第一个（也是唯一的）参数赋值。第三，该方法调用 `executeQuery` 来执行语句。

```java
public class PreparedFindMajors {
    public static void main(String[] args) {
        System.out.print("Enter a department name: ");
        Scanner sc = new Scanner(System.in);
        String major = sc.next();
        sc.close();
        String qry = "select sname, gradyear from student, dept " + "where did = majorid and dname = ?";
        ClientDataSource ds = new ClientDataSource();
        ds.setServerName("localhost");
        ds.setDatabaseName("studentdb");
        try (Connection conn = ds.getConnection();
             PreparedStatement pstmt = conn.prepareStatement(qry)) {
            // 设置第一个参数的值
            pstmt.setString(1, major); 
            // 执行预处理查询
            ResultSet rs = pstmt.executeQuery(); 
            System.out.println("Here are the " + major + " majors");
            System.out.println("Name\tGradYear");
            while (rs.next()) {
                String sname = rs.getString("sname");
                int gradyear = rs.getInt("gradyear");
                System.out.println(sname + "\t" + gradyear);
            }
            rs.close();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

**图 2.17 修改 FindMajors 客户端以使用预处理语句**

```java
public ResultSet executeQuery() throws SQLException;
public int executeUpdate() throws SQLException;
public void setInt(int index, int val) throws SQLException;
public void setString(int index, String val) throws SQLException;
```

**图 2.18 PreparedStatement 部分 API**

图 2.18 给出了最常见的 `PreparedStatement` 方法的 API。`executeQuery` 和 `executeUpdate` 方法类似于 `Statement` 中的相应方法；不同之处在于它们不需要任何参数。`setInt` 和 `setString` 方法为参数赋值。在图 2.17 中，对 `setString` 的调用将一个系名分配给第一个索引参数。请注意，`setString` 方法会自动在其值周围插入单引号，因此客户端无需这样做。

```java
// 准备查询
String qry = "select SName, GradYear from STUDENT, DEPT " + "where DId = MajorId and DName = ?";
PreparedStatement pstmt = conn.prepareStatement(qry);

// 重复获取参数并执行查询
String major = getUserInput(); // 假设此方法获取用户输入
while (major != null) {
    pstmt.setString(1, major);
    ResultSet rs = pstmt.executeQuery();
    displayResultSet(rs); // 假设此方法显示结果集
    major = getUserInput();
}
```

**图 2.19 在循环中使用预处理语句**
大多数人发现使用**预处理语句**比显式创建 SQL 语句更方便。当在循环中生成语句时，预处理语句也是更高效的选择，如 图 2.19 所示。原因在于数据库引擎能够在不知道参数值的情况下编译预处理语句。它**编译一次**语句，然后在循环中**重复执行**，而无需进一步重新编译。

### 2.2.5 可滚动和可更新结果集 (Scrollable and Updatable Result Sets)

基本 JDBC 中的结果集是**只进的 (forward-only)** 且**不可更新的 (non-updatable)**。完整的 JDBC 也允许结果集是**可滚动 (scrollable)** 和**可更新 (updatable)** 的。客户端可以将此类结果集定位到任意记录，更新当前记录，并插入新记录。图 2.20 列出了这些附加方法的 API。

```java
// 可滚动结果集使用的方法 (Methods used by scrollable result sets)
public void beforeFirst() throws SQLException;
public void afterLast() throws SQLException;
public boolean previous() throws SQLException;
public boolean boolean next() throws SQLException; // 注意：这里原文有误，应为 boolean next()
public boolean absolute(int pos) throws SQLException;
public boolean relative(int offset) throws SQLException;

// 可更新结果集使用的方法 (Methods used by updatable result sets)
public void updateInt(String fldname, int val) throws SQLException;
public void updateString(String fldname, String val) throws SQLException;
public void updateRow() throws SQLException;
public void deleteRow() throws SQLException;
public void moveToInsertRow() throws SQLException;
public void moveToCurrentRow() throws SQLException;
```

**图 2.20 ResultSet 的部分 API**

`beforeFirst` 方法将结果集定位到第一条记录之前，`afterLast` 方法将结果集定位到最后一条记录之后。`absolute` 方法将结果集精确地定位到指定记录，如果不存在该记录则返回 `false`。`relative` 方法将结果集定位到相对行数。特别是，`relative(1)` 等同于 `next`，`relative(-1)` 等同于 `previous`。

`updateInt` 和 `updateString` 方法修改客户端上当前记录的指定字段。然而，修改不会发送到数据库，直到调用 `updateRow`。需要调用 `updateRow` 有些不便，但它允许 JDBC 将对记录的多个字段的更新批量处理到对引擎的一次调用中。

插入操作通过**插入行 (insert row)** 的概念进行处理。此行不存在于表中（例如，您无法滚动到它）。其目的是充当新记录的暂存区。客户端调用 `moveToInsertRow` 将结果集定位到插入行，然后使用 `updateXXX` 方法设置其字段的值，然后调用 `updateRow` 将记录插入到数据库中，最后调用 `moveToCurrentRow` 将记录集重新定位到插入之前的位置。

默认情况下，记录集是**只进**和**不可更新**的。如果客户端想要一个更强大的记录集，它可以在 `Connection` 的 `createStatement` 方法中指定。除了基本 JDBC 的无参数 `createStatement` 方法外，还有一个双参数方法，客户端可以在其中指定**可滚动性**和**可更新性**。例如，考虑以下语句：

```sql
Statement stmt = conn.createStatement(ResultSet.TYPE_SCROLL_INSENSITIVE, ResultSet.CONCUR_UPDATABLE);
```

由此语句生成的所有结果集都将是可滚动和可更新的。常量 `TYPE_FORWARD_ONLY` 指定不可滚动结果集，`CONCUR_READ_ONLY` 指定不可更新结果集。这些常量可以混合搭配以获得所需的可滚动性和可更新性。

例如，回顾图 2.10 的代码，它允许用户迭代 `COURSE` 表，删除所需的记录。图 2.21 修改了该代码以使用可更新的结果集。请注意，已删除的行在调用 `next` 之前仍然是当前行。

```java
DataSource ds = ... // 假设 ds 已初始化
try (Connection conn = ds.getConnection()) {
    conn.setAutoCommit(false); // 关闭自动提交，手动管理事务
    // 创建可更新的 Statement 对象
    Statement stmt = conn.createStatement(ResultSet.TYPE_FORWARD_ONLY, ResultSet.CONCUR_UPDATABLE);
    ResultSet rs = stmt.executeQuery("select * from COURSE");

    while (rs.next()) {
        String title = rs.getString("Title");
        boolean goodCourse = getUserDecision(title); // 假设此方法决定是否删除课程
        if (!goodCourse)
            rs.deleteRow(); // 删除当前行
    }
    rs.close();
    stmt.close();
    conn.commit(); // 提交更改
} catch (SQLException e) {
    e.printStackTrace();
    try {
        if (conn != null)
            conn.rollback(); // 发生异常时回滚
    } catch (SQLException e2) {
        // 忽略回滚期间可能发生的异常
    }
}
```

**图 2.21 图 2.10 代码的修订版**

可滚动结果集的使用有限，因为大多数时候客户端知道它想对输出记录做什么，不需要检查它们两次。客户端通常只有在允许用户与查询结果交互时才需要可滚动结果集。例如，考虑一个想要将查询输出显示为 Swing `JTable` 对象的客户端。当输出记录过多以致无法在屏幕上显示时，`JTable` 将显示一个滚动条，并允许用户通过点击滚动条在记录之间来回移动。这种情况要求客户端向 `JTable` 对象提供一个可滚动结果集，以便在用户滚动回来时可以检索以前的记录。

### 2.2.6 附加数据类型 (Additional Data Types)

除了整数和字符串值，JDBC 还包含操作许多其他类型的方法。例如，考虑 `ResultSet` 接口。除了 `getInt` 和 `getString` 方法，还有 `getFloat`、`getDouble`、`getShort`、`getTime`、`getDate` 和其他几种方法。这些方法中的每一个都将从当前记录的指定字段中读取值，并将其（如果可能）转换为指示的 Java 类型。当然，一般来说，在数字 SQL 字段上使用数字 JDBC 方法（如 `getInt`、`getFloat` 等）最有意义。但 JDBC 将尝试将任何 SQL 值转换为方法指示的 Java 类型。特别是，始终可以将任何 SQL 值转换为 Java 字符串。

## 2.3 Java 与 SQL 中的计算 (Computing in Java vs. SQL)

每当程序员编写 JDBC 客户端时，都必须做出一个重要决定：**计算的哪一部分应该由数据库引擎执行，哪一部分应该由 Java 客户端执行？** 本节将探讨这些问题。

再次考虑图 2.5 的 `StudentMajor` 演示客户端。在该程序中，引擎通过执行 SQL 查询来计算 `STUDENT` 表和 `DEPT` 表的连接，从而执行所有计算。客户端的唯一职责是检索查询输出并打印它。

相比之下，您也可以编写客户端，使其执行所有计算，如 图 2.22 所示。在该代码中，引擎的唯一职责是为 `STUDENT` 和 `DEPT` 表创建结果集。客户端完成所有其余工作，计算连接并打印结果。

```java
public class BadStudentMajor {
    public static void main(String[] args) {
        ClientDataSource ds = new ClientDataSource();
        ds.setServerName("localhost");
        ds.setDatabaseName("studentdb");
        Connection conn = null; // 在 try-with-resources 外部声明 conn
        try {
            conn = ds.getConnection();
            conn.setAutoCommit(false); // 关闭自动提交
            try (Statement stmt1 = conn.createStatement();
                 // stmt2 使用可滚动结果集，以便在内循环中重置位置
                 Statement stmt2 = conn.createStatement(
                     ResultSet.TYPE_SCROLL_INSENSITIVE, ResultSet.CONCUR_READ_ONLY);
                 ResultSet rs1 = stmt1.executeQuery("select * from STUDENT");
                 ResultSet rs2 = stmt2.executeQuery("select * from DEPT")) {

                System.out.println("Name\tMajor");
                while (rs1.next()) {
                    // 获取下一个学生
                    String sname = rs1.getString("SName");
                    String dname = null;
                    rs2.beforeFirst(); // 将 rs2 定位到第一条记录之前，以便重新开始搜索
                    while (rs2.next())
                        // 搜索该学生的专业
                        if (rs2.getInt("DId") == rs1.getInt("MajorId")) {
                            dname = rs2.getString("DName");
                            break;
                        }
                    System.out.println(sname + "\t" + dname);
                }
            }
            conn.commit(); // 提交事务
            conn.close(); // 关闭连接
        } catch (SQLException e) {
            e.printStackTrace();
            try {
                if (conn != null) {
                    conn.rollback(); // 发生异常时回滚
                    conn.close(); // 关闭连接
                }
            } catch (SQLException e2) {
                // 忽略回滚期间可能发生的异常
            }
        }
    }
}
```

**图 2.22 编码 StudentMajor 客户端的另一种（但糟糕的）方式**

这两个版本哪个更好？显然，原始版本更优雅。它不仅代码量更少，而且代码更容易阅读。但是效率呢？根据经验法则，**在客户端中做尽可能少的工作总是更高效的**。主要有两个原因：

- 通常**需要从引擎传输到客户端的数据更少**，如果它们在不同的机器上，这一点尤其重要。
- 引擎包含关于每个表如何实现以及计算复杂查询（如连接）的可能方式的**详细专业知识**。客户端以与引擎相同的效率计算查询的可能性极低。

例如，图 2.22 的代码使用两个嵌套循环来计算连接。外层循环遍历 `STUDENT` 记录。对于每个学生，内层循环搜索匹配该学生专业的 `DEPT` 记录。尽管这是一种合理的连接算法，但它效率不高。第 13 章和第 14 章讨论了几种可以实现更高效率执行的技术。

图 2.5 和图 2.22 举例说明了真正好和真正坏的 JDBC 代码的极端情况，因此比较它们相当容易。但有时，比较更困难。例如，再次考虑图 2.17 的 `PreparedFindMajors` 演示客户端，它返回具有指定专业的学生。该代码要求引擎执行连接 `STUDENT` 和 `MAJOR` 的 SQL 查询。假设您知道执行连接可能很耗时。经过认真思考，您意识到无需使用连接即可获得所需的数据。其思想是使用两个单表查询。第一个查询扫描 `DEPT` 表以查找具有指定专业名称的记录并返回其 `DId` 值。第二个查询然后使用该值搜索 `STUDENT` 记录的 `MajorID` 值。此算法的代码出现在图 2.23 中。

```java
public class CleverFindMajors {
    public static void main(String[] args) {
        String major = args[0]; // 从命令行参数获取专业名称
        String qry1 = "select DId from DEPT where DName = ?";
        String qry2 = "select * from STUDENT where MajorId = ?";
        ClientDataSource ds = new ClientDataSource();
        ds.setServerName("localhost");
        ds.setDatabaseName("studentdb");
        try (Connection conn = ds.getConnection()) {
            // 第一个预处理语句：查询部门 ID
            PreparedStatement stmt1 = conn.prepareStatement(qry1);
            stmt1.setString(1, major);
            ResultSet rs1 = stmt1.executeQuery();
            rs1.next(); // 移动到第一条记录
            int deptid = rs1.getInt("DId"); // 获取部门 ID
            rs1.close();
            stmt1.close();

            // 第二个预处理语句：查询学生
            PreparedStatement stmt2 = conn.prepareStatement(qry2);
            stmt2.setInt(1, deptid);
            ResultSet rs2 = stmt2.executeQuery();

            System.out.println("Here are the " + major + " majors");
            System.out.println("Name\tGradYear");
            while (rs2.next()) {
                String sname = rs2.getString("sname");
                int gradyear = rs2.getInt("gradyear");
                System.out.println(sname + "\t" + gradyear);
            }
            rs2.close();
            stmt2.close();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

**图 2.23 实现 FindMajors 客户端的一种巧妙方式**

这个算法简单、优雅且高效。它只需要顺序扫描两个表中的每一个，并且应该比连接快得多。您可以为您的努力感到自豪。

不幸的是，您的努力白费了。新算法并不是真正的新算法，而只是连接的一种巧妙实现——特别是，它是第 14 章中带有实体化内部表的**多缓冲区积 (multibuffer product)**。一个编写良好的数据库引擎会知道这种算法（以及其他几种算法），如果它证明是最有效的，就会用它来计算连接。因此，您的所有巧妙之处都被数据库引擎抢占了。教训与 `StudentMajor` 客户端相同：**让引擎完成工作往往是最有效的策略（也是最容易编码的策略）**。

初学者 JDBC 程序员常犯的一个错误是，他们试图在客户端中做太多事情。程序员可能认为他或她知道一种在 Java 中实现查询的非常巧妙的方法。或者程序员可能不确定如何在 SQL 中表达查询，并且更乐意在 Java 中编码查询。在这些情况中的每一种情况下，在 Java 中编码查询的决定几乎总是错误的。

**程序员必须相信数据库引擎会做好它的工作。**

## 2.4 章节总结 (Chapter Summary)

- **JDBC** 方法用于管理 Java 客户端与数据库引擎之间的数据传输。
- **基本 JDBC** 由五个接口组成：`Driver`、`Connection`、`Statement`、`ResultSet` 和 `ResultSetMetaData`。
- `Driver` 对象封装了连接引擎的底层细节。如果客户端想连接到引擎，它必须获取相应驱动程序类的副本。**驱动程序类及其连接字符串是 JDBC 程序中唯一与供应商相关的代码。** 其他所有内容都引用了与供应商无关的 JDBC 接口。
- **结果集**和**连接**会占用其他客户端可能需要的资源。JDBC 客户端应始终尽快关闭它们。
- 每个 JDBC 方法都可能抛出 `SQLException`。客户端有义务检查这些异常。
- `ResultSetMetaData` 的方法提供了关于输出表**模式**的信息，即每个字段的名称、类型和显示大小。当客户端直接从用户接收查询时（例如在 SQL 解释器中），此信息非常有用。
- 基本 JDBC 客户端直接调用驱动程序类。**完整 JDBC** 提供了 `DriverManager` 类和 `DataSource` 接口，以简化连接过程并使其更具供应商中立性。
- `DriverManager` 类维护着一个驱动程序集合。客户端通过显式方式或（最好是）通过系统属性文件向驱动程序管理器注册其驱动程序。当客户端想连接到数据库时，它会向驱动程序管理器提供连接字符串，驱动程序管理器会为客户端建立连接。
- `DataSource` 对象更具供应商中立性，因为它封装了驱动程序和连接字符串。因此，客户端无需了解任何连接细节即可连接到数据库引擎。数据库管理员可以创建各种 `DataSource` 对象并将其放置在服务器上供客户端使用。
- 基本 JDBC 客户端忽略事务的存在。数据库引擎以**自动提交模式**执行这些客户端，这意味着每个 SQL 语句都是一个独立的事务。

- 事务中的所有数据库交互都作为一个单元处理。当当前工作单元成功完成时，事务**提交**。当事务无法提交时，它会**回滚**。数据库引擎通过撤销该事务所做的所有更改来实现回滚。

- 对于简单、不重要的 JDBC 客户端，**自动提交**是一个合理的默认模式。如果客户端执行关键任务，其程序员应仔细分析其事务需求。客户端通过调用 `setAutoCommit(false)` 来关闭自动提交。此调用会导致引擎启动一个新事务。然后，客户端在需要完成当前事务并开始一个新事务时，调用 `commit()` 或 `rollback()`。当客户端关闭自动提交时，它必须通过回滚相关事务来处理失败的 SQL 语句。

- 客户端还可以使用

  ```java
  setTransactionIsolation
  ```

   方法来指定其隔离级别

  。JDBC 定义了四种隔离级别：

  - **读未提交 (Read-Uncommitted)** 隔离意味着完全没有隔离。事务可能因读取未提交数据、不可重复读或幻影记录而导致问题。
  - **读已提交 (Read-Committed)** 隔离禁止事务访问未提交的值。与不可重复读和幻影相关的问题仍然可能发生。
  - **可重复读 (Repeatable-Read)** 隔离扩展了读已提交，使读总是可重复的。唯一可能的问题是由于幻影。
  - **可串行化 (Serializable)** 隔离保证永远不会发生任何问题。
  
- **可串行化**隔离显然是首选，但其实现往往导致事务运行缓慢。程序员必须分析客户端可能出现的并发错误的风险，并且只有在风险似乎可以容忍时才选择限制较少的隔离级别。

- **预处理语句**具有关联的 SQL 语句，其中可以包含参数的占位符。客户端可以在以后为参数赋值，然后执行该语句。预处理语句是处理动态生成的 SQL 语句的便捷方式。此外，预处理语句可以在为其赋值参数之前进行编译，这意味着多次执行预处理语句（例如在循环中）将非常高效。

- **完整 JDBC** 允许结果集是**可滚动**和**可更新**的。默认情况下，记录集是只进且不可更新的。如果客户端需要更强大的记录集，它可以在 `Connection` 的 `createStatement` 方法中指定。

- 编写 JDBC 客户端时，经验法则是**尽可能让引擎完成更多工作**。数据库引擎非常复杂，通常知道获取所需数据的最有效方式。客户端确定一个精确获取所需数据的 SQL 语句并将其提交给引擎几乎总是最佳实践。简而言之，**程序员必须相信引擎会做好它的工作**。

## 2.5 建议阅读 (Suggested Reading)

关于 JDBC 的一本全面且编写精良的书是 Fisher 等人 (2003) 的著作，其中一部分内容可在 [docs.oracle.com/javase/tutorial/jdbc](https://docs.oracle.com/javase/tutorial/jdbc) 在线教程中找到。此外，每个数据库供应商都提供解释其驱动程序使用以及其他供应商特定问题的文档。如果您打算为特定引擎编写客户端，那么熟悉这些文档至关重要。

Fisher, M., Ellis, J., & Bruce, J. (2003). *JDBC API tutorial and reference* (3rd ed.). Addison Wesley.

## 2.6 练习 (Exercises)

### 概念练习 (Conceptual Exercises)

2.1. Derby 文档建议在执行一系列插入操作时关闭自动提交。解释你认为它做出此建议的原因。

### 编程练习 (Programming Exercises)

2.2. 为大学数据库编写一些 SQL 查询。对于每个查询，编写一个使用 Derby 执行该查询并打印其输出表的程序。

2.3. `SimpleIJ` 程序要求每个 SQL 语句都是单行文本。修改它，使其语句可以包含多行并以分号终止，类似于 Derby 的 `ij` 程序。

2.4. 为 SimpleDB 编写一个 `NetworkDataSource` 类，使其功能类似于 Derby 的 `ClientDataSource` 类。将此`类`添加到 `simpledb.jdbc.network` 包中。你的代码无需实现 `javax.sql.DataSource` 接口（及其超类）的所有方法；事实上，它只需要实现其中无参数的 `getConnection()` 方法。`NetworkDataSource` 应该有哪些供应商特定的方法？

2.5. 能够创建包含 SQL 命令的文本文件通常很有用。然后，这些命令可以通过 JDBC 程序批量执行。编写一个 JDBC 程序，从指定的文本文件读取命令并执行它们。假设文件的每一行都是一个单独的命令。

2.6. 研究如何使用结果集填充 Java `JTable` 对象。（提示：你需要扩展 `AbstractTableModel` 类。）然后修改 `FindMajors` 演示客户端，使其具有一个 GUI 界面，并在 `JTable` 中显示其输出。

2.7. 为以下任务编写 JDBC 代码：

(a) 将数据从文本文件导入到现有表中。文本文件应每行包含一条记录，每个字段用制表符分隔。文件的第一行应该是字段的名称。客户端应将文件名和表名作为输入，并将记录插入到表中。

(b) 将数据导出到文本文件。客户端应将文件名和表名作为输入，并将每条记录的内容写入文件中。文件的第一行应该是字段的名称。

2.8. 本章忽略了结果集中可能存在空值的情况。要检查空值，可以使用 `ResultSet` 中的 `wasNull` 方法。假设您调用 `getInt` 或 `getString` 来检索字段值。如果您立即调用 `wasNull`，如果检索到的值为 null，它将返回 `true`。例如，以下循环打印毕业年份，假设其中一些可能为 null：

```java
while(rs.next()) {
    int gradyr = rs.getInt("gradyear");
    if (rs.wasNull())
        System.out.println("null");
    else
        System.out.println(gradyr);
}
```

(a) 假设学生姓名可能为空，重写 `StudentMajor` 演示客户端的代码。
(b) 修改 `SimpleIJ` 演示客户端，使其连接到 Derby（而不是 SimpleDB）。然后假设任何字段值可能为空，重写代码。
