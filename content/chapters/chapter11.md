---
typora-root-url: ./..\..\public
---

Here's the translated content for Chapter 11, "JDBC Interfaces":

## 第 11 章 JDBC 接口 (JDBC Interfaces)

本章探讨如何为数据库引擎构建 **JDBC 接口**。编写**嵌入式接口**相对简单——您只需使用引擎中相应的类来编写每个 JDBC 类。编写**基于服务器的接口**还需要开发额外的代码来实现服务器并处理 JDBC 请求。本章展示了如何利用 **Java RMI** 来简化这些额外代码。

### 11.1 SimpleDB API (The SimpleDB API)

第 2 章介绍了 **JDBC** 作为连接数据库引擎的标准接口，并包含了一些 JDBC 客户端示例。然而，随后的章节没有使用 JDBC。相反，那些章节包含了演示 SimpleDB 引擎不同功能的测试程序。尽管如此，这些测试程序也是数据库客户端；它们只是碰巧使用 SimpleDB API 而不是 JDBC API 来访问 SimpleDB 引擎。

**SimpleDB API** 由 SimpleDB 的公共类（如 `SimpleDB`、`Transaction`、`BufferMgr`、`Scan` 等）及其公共方法组成。这个 API 比 JDBC 广泛得多，可以访问引擎的低级细节。这种低级访问允许应用程序自定义引擎提供的功能。例如，第 4 章的测试代码绕过了事务管理器，直接访问日志和缓冲区管理器。

这种低级访问是有代价的。应用程序编写者必须对目标引擎的 API 有深入的了解，并且将应用程序移植到不同的引擎（或使用基于服务器的连接）将需要重写以符合不同的 API。JDBC 的目的是提供一个标准 API，除了次要的配置规范外，对于任何数据库引擎和配置模式都是相同的。

**图 11.1 访问数据库引擎的两种方式。(a) 使用 JDBC API，(b) 使用 SimpleDB API**

**(a) 使用 JDBC API (Using the JDBC API)**

```java
// 创建一个嵌入式驱动程序实例
Driver d = new EmbeddedDriver();
// 连接到 "studentdb" 数据库
Connection conn = d.connect("studentdb", null);
// 创建一个 Statement 对象
Statement stmt = conn.createStatement();
// 定义 SQL 查询字符串
String qry = "select sname, gradyear from student";
// 执行查询并获取结果集
ResultSet rs = stmt.executeQuery(qry);
// 遍历结果集并打印学生姓名和毕业年份
while (rs.next())
    System.out.println(rs.getString("sname") + " " + rs.getInt("gradyear"));
// 关闭结果集和 Statement
rs.close(); // stmt.close() 通常会在 rs.close() 之后或隐式执行
// stmt.close(); // 通常在finally块中关闭
// conn.close(); // 通常在finally块中关闭
```

**(b) 使用 SimpleDB API (Using the SimpleDB API)**

```java
import simpledb.server.SimpleDB;
import simpledb.tx.Transaction;
import simpledb.plan.Plan;
import simpledb.plan.Planner;
import simpledb.query.Scan;

// 创建一个 SimpleDB 实例
SimpleDB db = new SimpleDB("studentdb");
// 开启一个新事务
Transaction tx = db.newTx();
// 获取规划器实例
Planner planner = db.planner();
// 定义 SQL 查询字符串
String qry = "select sname, gradyear from student";
// 创建查询计划
Plan p = planner.createQueryPlan(qry, tx);
// 打开计划以获取扫描对象
Scan s = p.open();
// 遍历扫描并打印学生姓名和毕业年份
while (s.next())
    System.out.println(s.getString("sname") + " " + s.getInt("gradyear"));
// 关闭扫描和事务
s.close(); // tx.commit() 或 tx.rollback() 也会关闭相关资源
// tx.commit(); // 或 tx.rollback();
```

**图 11.2 JDBC 接口与 SimpleDB 类之间的对应关系 (The correspondence between JDBC interfaces and SimpleDB classes)**

| JDBC 接口 (JDBC Interface) | SimpleDB 类 (SimpleDB Class) |
| :------------------------- | :-------------------------- |
| `Driver`                   | `SimpleDB`                  |
| `Connection`               | `Transaction`               |
| `Statement`                | `Planner`, `Plan`           |
| `ResultSet`                | `Scan`                      |
| `ResultSetMetaData`        | `Schema`                    |


为了在 SimpleDB 中实现 JDBC API，只需观察两个 API 之间的对应关系。例如，考虑图 11.1。**图 (a)** 包含一个 JDBC 应用程序，它查询数据库，打印其结果集，然后关闭它。**图 (b)** 给出了使用 SimpleDB API 的相应应用程序。代码创建一个新事务，调用规划器获取 SQL 查询的计划，打开计划以获取扫描，遍历扫描，然后关闭它。

图 11.1b 中的代码使用了 SimpleDB 的五个类：`SimpleDB`、`Transaction`、`Planner`、`Plan` 和 `Scan`。JDBC 代码使用了 `Driver`、`Connection`、`Statement` 和 `ResultSet` 接口。图 11.2 显示了这些构造之间的对应关系。

图 11.2 中每行的构造都具有共同的目的。例如，`Connection` 和 `Transaction` 都管理当前事务，`Statement` 和 `Planner` 类处理 SQL 语句，而 `ResultSet` 和 `Scan` 遍历查询结果。这种对应关系是为 SimpleDB 实现 JDBC API 的关键。

### 11.2 嵌入式 JDBC (Embedded JDBC)

`simpledb.jdbc.embedded` 包为每个 JDBC 接口包含一个类。`EmbeddedDriver` 类的代码如 图 11.3 所示。

该类有一个空的构造函数。其唯一的方法 `connect` 为指定的数据库创建一个新的 `SimpleDB` 对象，将其传递给 `EmbeddedConnection` 构造函数，并返回该新对象。请注意，JDBC `Driver` 接口强制该方法声明它可以抛出 `SQLException`，即使它不会抛出。

JDBC `Driver` 接口实际上有比 `connect` 更多的方法，尽管它们与 SimpleDB 都不相关。为了确保 `EmbeddedDriver` 可以实现 `Driver`，它扩展了 `DriverAdapter` 类，该类确实实现了这些方法。`DriverAdapter` 的代码如 图 11.4 所示。

`DriverAdapter` 通过返回默认值或抛出异常来实现所有 `Driver` 方法。`EmbeddedDriver` 类重写了 SimpleDB 所关心的 `connect` 方法，并使用 `DriverAdapter` 对其他方法的实现。

图 11.5 包含了 `EmbeddedConnection` 类的代码。这个类管理事务。大部分工作由 `Transaction` 对象 `currentTx` 执行。例如，`commit` 方法调用 `currentTx.commit`，然后创建一个新事务作为 `currentTx` 的新值。`createStatement` 方法将一个 `Planner` 对象以及对自身的引用传递给 `EmbeddedStatement` 构造函数。

`EmbeddedConnection` 不直接实现 `Connection`，而是扩展 `ConnectionAdapter`。`ConnectionAdapter` 的代码提供了所有 `Connection` 方法的默认实现，此处省略。


**图 11.3 `EmbeddedDriver` 类 (The class EmbeddedDriver)**

```java
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.util.Properties;
import java.util.logging.Logger;
import java.sql.Driver; // 导入 JDBC Driver 接口
import java.sql.Connection; // 导入 JDBC Connection 接口
import simpledb.server.SimpleDB; // 导入 SimpleDB 引擎的核心类

public class EmbeddedDriver extends DriverAdapter { // 继承 DriverAdapter
    // connect 方法：连接到 SimpleDB 数据库
    @Override // 明确表示重写父类方法
    public EmbeddedConnection connect(String dbname, Properties p) throws SQLException {
        // 创建一个 SimpleDB 实例，这将初始化数据库引擎
        SimpleDB db = new SimpleDB(dbname);
        // 返回一个新的 EmbeddedConnection 实例，它封装了这个 SimpleDB 实例
        return new EmbeddedConnection(db);
    }
}
```

**图 11.4 `DriverAdapter` 类 (The class DriverAdapter)**

```java
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.Properties;
import java.util.logging.Logger;

// 抽象类 DriverAdapter 实现了 JDBC Driver 接口
public abstract class DriverAdapter implements Driver {
    // 默认实现：不接受任何 URL，抛出异常
    public boolean acceptsURL(String url) throws SQLException {
        throw new SQLException("operation not implemented");
    }

    // 默认实现：不连接任何 URL，抛出异常
    public Connection connect(String url, Properties info) throws SQLException {
        throw new SQLException("operation not implemented");
    }

    // 默认实现：返回主版本号 0
    public int getMajorVersion() {
        return 0;
    }

    // 默认实现：返回次版本号 0
    public int getMinorVersion() {
        return 0;
    }

    // 默认实现：返回 null，表示没有属性信息
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) {
        return null;
    }

    // 默认实现：返回 false，表示不完全兼容 JDBC
    public boolean jdbcCompliant() {
        return false;
    }

    // 默认实现：抛出不支持的异常
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        throw new SQLFeatureNotSupportedException("op not implemented");
    }
}
```

**图 11.5 `EmbeddedConnection` 类 (The class EmbeddedConnection)**

```java
import java.sql.SQLException;
import simpledb.server.SimpleDB; // 导入 SimpleDB 引擎核心类
import simpledb.tx.Transaction; // 导入 SimpleDB 事务类
import simpledb.plan.Planner; // 导入 SimpleDB 规划器类

// EmbeddedConnection 继承自 ConnectionAdapter，实现了 JDBC Connection 接口的功能
class EmbeddedConnection extends ConnectionAdapter { // 假设 ConnectionAdapter 提供了默认实现
    private SimpleDB db;          // SimpleDB 数据库实例
    private Transaction currentTx; // 当前事务对象
    private Planner planner;      // 规划器对象

    // 构造函数：初始化数据库实例，创建新事务和规划器
    public EmbeddedConnection(SimpleDB db) {
        this.db = db;
        currentTx = db.newTx(); // 开启一个新事务
        planner = db.planner();   // 获取数据库的规划器
    }

    // createStatement 方法：创建并返回一个 EmbeddedStatement 对象
    @Override // 明确表示重写父类方法
    public EmbeddedStatement createStatement() throws SQLException {
        // 将当前连接对象和规划器传递给 EmbeddedStatement 构造函数
        return new EmbeddedStatement(this, planner);
    }

    // close 方法：关闭连接，通常会提交当前事务
    @Override // 明确表示重写父类方法
    public void close() throws SQLException {
        commit(); // 关闭时提交当前事务
    }

    // commit 方法：提交当前事务，并开启一个新事务
    @Override // 明确表示重写父类方法
    public void commit() throws SQLException {
        currentTx.commit();       // 提交当前事务
        currentTx = db.newTx();   // 开启一个新的事务以供后续操作使用
    }

    // rollback 方法：回滚当前事务，并开启一个新事务
    @Override // 明确表示重写父类方法
    public void rollback() throws SQLException {
        currentTx.rollback();     // 回滚当前事务
        currentTx = db.newTx();   // 开启一个新的事务以供后续操作使用
    }

    // getTransaction 方法：获取当前事务对象
    Transaction getTransaction() {
        return currentTx;
    }
}
```


`EmbeddedStatement` 类的代码如 图 11.6 所示。该类负责执行 SQL 语句。`executeQuery` 方法从规划器获取一个计划，并将该计划传递给一个新的 `RemoteResultSet` 对象进行执行。`executeUpdate` 方法只是简单地调用规划器的相应方法。

这两个方法还负责实现 JDBC 的**自动提交 (autocommit)** 语义。如果 SQL 语句正确执行，那么它必须被提交。`executeUpdate` 方法告诉连接，一旦更新语句完成，就立即提交当前事务。另一方面，`executeQuery` 方法不能立即提交，因为其结果集仍在使用中。相反，`Connection` 对象被发送到 `EmbeddedResultSet` 对象，以便其 `close` 方法可以提交事务。

如果在执行 SQL 语句期间出现问题，规划器代码将抛出运行时异常。这两个方法将捕获此异常，回滚事务，并抛出 SQL 异常。


**图 11.6 `EmbeddedStatement` 类 (The class EmbeddedStatement)**

```java
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement; // 导入 JDBC Statement 接口
import simpledb.plan.Plan;
import simpledb.plan.Planner;
import simpledb.tx.Transaction;

// EmbeddedStatement 继承自 StatementAdapter，实现了 JDBC Statement 接口的功能
class EmbeddedStatement extends StatementAdapter { // 假设 StatementAdapter 提供了默认实现
    private EmbeddedConnection conn; // 对所属连接的引用
    private Planner planner;         // SimpleDB 规划器对象

    // 构造函数：初始化连接和规划器
    public EmbeddedStatement(EmbeddedConnection conn, Planner planner) {
        this.conn = conn;
        this.planner = planner;
    }

    // executeQuery 方法：执行查询 SQL 语句
    @Override // 明确表示重写父类方法
    public EmbeddedResultSet executeQuery(String qry) throws SQLException {
        try {
            Transaction tx = conn.getTransaction(); // 获取当前事务
            Plan pln = planner.createQueryPlan(qry, tx); // 创建查询计划
            return new EmbeddedResultSet(pln, conn); // 返回新的结果集对象，并传递连接以便后续提交
        } catch (RuntimeException e) { // 捕获运行时异常
            conn.rollback(); // 回滚事务
            throw new SQLException(e); // 重新抛出 SQL 异常
        }
    }

    // executeUpdate 方法：执行更新（插入、删除、修改）SQL 语句
    @Override // 明确表示重写父类方法
    public int executeUpdate(String cmd) throws SQLException {
        try {
            Transaction tx = conn.getTransaction(); // 获取当前事务
            int result = planner.executeUpdate(cmd, tx); // 执行更新操作
            conn.commit(); // 执行更新后立即提交事务 (autocommit 语义)
            return result;
        } catch (RuntimeException e) { // 捕获运行时异常
            conn.rollback(); // 回滚事务
            throw new SQLException(e); // 重新抛出 SQL 异常
        }
    }

    // close 方法：关闭 Statement
    @Override // 明确表示重写父类方法
    public void close() throws SQLException {
        // 对于 SimpleDB，这里可能不需要做额外的事情，因为事务管理在连接层。
        // JDBC 规范要求 close() 方法可能抛出 SQLException。
    }
}
```


`EmbeddedResultSet` 类包含执行查询计划的方法；其代码如 图 11.7 所示。它的构造函数打开给定它的 `Plan` 对象并保存结果扫描。`next`、`getInt`、`getString` 和 `close` 方法只是简单地调用它们对应的扫描方法。`close` 方法还提交当前事务，这是 JDBC 自动提交语义所要求的。`EmbeddedResultSet` 类从其计划中获取一个 `Schema` 对象。`getMetaData` 方法将此 `Schema` 对象传递给 `EmbeddedMetaData` 构造函数。

`EmbeddedMetaData` 类包含传递给其构造函数的 `Schema` 对象；其代码如 图 11.8 所示。`Schema` 类包含与 `ResultSetMetaData` 接口中类似的方法；区别在于 `ResultSetMetaData` 方法按列号引用字段，而 `Schema` 方法按名称引用字段。因此，`EmbeddedMetaData` 的代码涉及将方法调用从一种方式转换为另一种方式。

好的，以下是您提供的 `EmbeddedResultSet` 和 `EmbeddedMetaData` 类的翻译内容，沿用之前的格式：

**图 11.7 `EmbeddedResultSet` 类**

```java
import java.sql.ResultSetMetaData; // 导入 JDBC ResultSetMetaData 接口
import java.sql.SQLException;     // 导入 JDBC SQLException 类
import simpledb.query.Scan;       // 导入 SimpleDB 内部的 Scan 接口
import simpledb.plan.Plan;         // 导入 SimpleDB 的查询计划类
import simpledb.record.Schema;    // 导入 SimpleDB 的模式定义类

public class EmbeddedResultSet extends ResultSetAdapter { // 继承自 ResultSetAdapter，提供 JDBC ResultSet 接口的默认实现
    private Scan s;                 // 底层 SimpleDB 的 Scan 对象，用于实际的数据迭代
    private Schema sch;             // 结果集的模式 (Schema)
    private EmbeddedConnection conn; // 对所属 EmbeddedConnection 对象的引用，用于事务管理

    // 构造函数：接受一个查询计划和一个连接对象
    public EmbeddedResultSet(Plan plan, EmbeddedConnection conn) throws SQLException {
        this.s = plan.open();     // 打开计划，获取实际的 Scan 对象
        this.sch = plan.schema(); // 从计划中获取结果集的模式
        this.conn = conn;         // 保存连接对象引用
    }

    // next 方法：将游标移动到结果集中的下一行
    public boolean next() throws SQLException {
        try {
            return s.next(); // 委托给底层 SimpleDB Scan 的 next() 方法
        } catch (RuntimeException e) {
            conn.rollback();     // 发生运行时异常时，回滚事务
            throw new SQLException(e); // 将运行时异常包装为 SQLException 并重新抛出
        }
    }

    // getInt 方法：获取指定字段的整数值
    public int getInt(String fldname) throws SQLException {
        try {
            fldname = fldname.toLowerCase(); // 将字段名转换为小写，以实现不区分大小写的查找
            return s.getInt(fldname);      // 委托给底层 SimpleDB Scan 的 getInt() 方法
        } catch (RuntimeException e) {
            conn.rollback();     // 发生运行时异常时，回滚事务
            throw new SQLException(e); // 将运行时异常包装为 SQLException 并重新抛出
        }
    }

    // getString 方法：获取指定字段的字符串值
    public String getString(String fldname) throws SQLException {
        try {
            fldname = fldname.toLowerCase(); // 将字段名转换为小写，以实现不区分大小写的查找
            return s.getString(fldname);     // 委托给底层 SimpleDB Scan 的 getString() 方法
        } catch (RuntimeException e) {
            conn.rollback();     // 发生运行时异常时，回滚事务
            throw new SQLException(e); // 将运行时异常包装为 SQLException 并重新抛出
        }
    }

    // getMetaData 方法：获取结果集的元数据对象
    public ResultSetMetaData getMetaData() throws SQLException {
        return new EmbeddedMetaData(sch); // 创建并返回一个新的 EmbeddedMetaData 实例，传入结果集的模式
    }

    // close 方法：释放结果集占用的数据库资源
    public void close() throws SQLException {
        s.close();        // 关闭底层的 SimpleDB Scan
        conn.commit();    // 根据 JDBC 的自动提交语义，在结果集关闭时提交当前事务
    }
}
```

 **图 11.8 `EmbeddedMetaData` 类**

```java
import java.sql.ResultSetMetaData; // 导入 JDBC ResultSetMetaData 接口
import java.sql.SQLException;     // 导入 JDBC SQLException 类
import simpledb.record.Schema;    // 导入 SimpleDB 的模式定义类
import static java.sql.Types.INTEGER; // 导入 JDBC 的 INTEGER 类型常量

public class EmbeddedMetaData extends ResultSetMetaDataAdapter { // 继承自 ResultSetMetaDataAdapter，提供 JDBC ResultSetMetaData 接口的默认实现
    private Schema sch; // SimpleDB 的 Schema 对象，包含结果集的元数据信息

    // 构造函数：接受一个 SimpleDB 的 Schema 对象
    public EmbeddedMetaData(Schema sch) {
        this.sch = sch;
    }

    // getColumnCount 方法：返回结果集中的列数
    public int getColumnCount() throws SQLException {
        return sch.fields().size(); // 返回模式中字段的数量
    }

    // getColumnName 方法：返回指定列索引的列名
    public String getColumnName(int column) throws SQLException {
        // JDBC 的列索引是 1-based (从 1 开始)，而 List 索引是 0-based (从 0 开始)，所以需要减 1
        return sch.fields().get(column - 1);
    }

    // getColumnType 方法：返回指定列的 JDBC 类型
    public int getColumnType(int column) throws SQLException {
        String fldname = getColumnName(column); // 获取列名
        return sch.type(fldname);             // 返回该字段在 Schema 中定义的类型 (映射到 JDBC 类型)
    }

    // getColumnDisplaySize 方法：返回指定列的正常最大显示宽度（字符数）
    public int getColumnDisplaySize(int column) throws SQLException {
        String fldname = getColumnName(column);
        int fldtype = sch.type(fldname);
        // 如果字段类型是 INTEGER，则默认显示大小为 6 (例如，足以显示 -2147483648)
        // 否则，使用 Schema 中存储的字段长度
        int fldlength = (fldtype == INTEGER) ? 6 : sch.length(fldname);
        // 返回字段名长度与字段值长度的较大者加 1（可能为了额外的空间或分隔符）
        return Math.max(fldname.length(), fldlength) + 1;
    }
}
```

This section covers how SimpleDB implements a server-based JDBC interface using Java's Remote Method Invocation (RMI).

### 11.3 远程方法调用 (Remote Method Invocation)

本章的其余部分讨论如何实现**基于服务器的 JDBC 接口**。实现基于服务器的 JDBC 最困难的部分是编写服务器端代码。幸运的是，Java 库中包含的类可以完成大部分工作；这些类被称为**远程方法调用 (Remote Method Invocation，简称 RMI)**。本节将介绍 RMI。下一节将展示如何使用 RMI 来编写基于服务器的 JDBC 接口。


### 11.3.1 远程接口 (Remote Interfaces)

**RMI** 使得一台机器（**客户端**）上的 Java 程序能够与另一台机器（**服务器**）上的对象进行交互。要使用 RMI，您必须定义一个或多个扩展 Java `Remote` 接口的接口；这些接口被称为其**远程接口 (remote interfaces)**。您还需要为每个接口编写一个实现类；这些类将驻留在服务器上，被称为**远程实现类 (remote implementation classes)**。RMI 将自动创建相应的实现类，这些类驻留在客户端；这些类被称为**存根类 (stub classes)**。当客户端从存根对象调用方法时，方法调用会通过网络发送到服务器，并由相应的远程实现对象在服务器上执行；然后结果会返回到客户端的存根对象。简而言之，远程方法由客户端（使用存根对象）调用，但在服务器上（使用远程实现对象）执行。

SimpleDB 在其 `simpledb.jdbc.network` 包中实现了五个远程接口：`RemoteDriver`、`RemoteConnection`、`RemoteStatement`、`RemoteResultSet` 和 `RemoteMetaData`；它们的代码如 图 11.9 所示。这些远程接口与它们对应的 JDBC 接口相似，但有**两个区别**：


**图 11.9 SimpleDB 远程接口 (The SimpleDB remote interfaces)**

```java
import java.rmi.Remote;         // 导入 RMI 的 Remote 接口
import java.rmi.RemoteException; // 导入 RMI 的 RemoteException

// RemoteDriver 接口：远程数据库驱动，继承自 Remote
public interface RemoteDriver extends Remote {
    // connect 方法：返回一个远程数据库连接对象
    public RemoteConnection connect() throws RemoteException;
}

// RemoteConnection 接口：远程数据库连接，继承自 Remote
public interface RemoteConnection extends Remote {
    // createStatement 方法：创建并返回一个远程 SQL 语句对象
    public RemoteStatement createStatement() throws RemoteException;
    // close 方法：关闭远程连接
    public void close() throws RemoteException;
}

// RemoteStatement 接口：远程 SQL 语句，继承自 Remote
public interface RemoteStatement extends Remote {
    // executeQuery 方法：执行查询并返回远程结果集
    public RemoteResultSet executeQuery(String qry) throws RemoteException;
    // executeUpdate 方法：执行更新（插入、删除、修改）并返回受影响的行数
    public int executeUpdate(String cmd) throws RemoteException;
}

// RemoteResultSet 接口：远程结果集，继承自 Remote
public interface RemoteResultSet extends Remote {
    // next 方法：将游标移动到结果集中的下一行
    public boolean next() throws RemoteException;
    // getInt 方法：获取指定字段的整数值
    public int getInt(String fldname) throws RemoteException;
    // getString 方法：获取指定字段的字符串值
    public String getString(String fldname) throws RemoteException;
    // getMetaData 方法：获取结果集的远程元数据对象
    public RemoteMetaData getMetaData() throws RemoteException;
    // close 方法：关闭远程结果集
    public void close() throws RemoteException;
}

// RemoteMetaData 接口：远程结果集元数据，继承自 Remote
public interface RemoteMetaData extends Remote {
    // getColumnCount 方法：获取结果集中的列数
    public int getColumnCount() throws RemoteException;
    // getColumnName 方法：获取指定列索引的列名
    public String getColumnName(int column) throws RemoteException;
    // getColumnType 方法：获取指定列的 JDBC 类型
    public int getColumnType(int column) throws RemoteException;
    // getColumnDisplaySize 方法：获取指定列的建议最大显示宽度
    public int getColumnDisplaySize(int column) throws RemoteException;
}
```

**图 11.10 从客户端访问远程接口 (Accessing remote interfaces from the client)**

```java
// 假设 rdvr 变量通过某种方式（例如 RMI 注册表）获取了一个 RemoteDriver 的存根对象
RemoteDriver rdvr = ...;
// 通过存根对象调用 connect 方法，实际在服务器上执行，并返回 RemoteConnection 的存根
RemoteConnection rconn = rdvr.connect();
// 通过存根对象调用 createStatement 方法，实际在服务器上执行，并返回 RemoteStatement 的存根
RemoteStatement rstmt = rconn.createStatement();
```

* 它们仅实现了 图 2.1 中所示的**基本 JDBC 方法**。
* 它们抛出 **`RemoteException`**（RMI 所要求）而不是 `SQLException`（JDBC 所要求）。

为了感受 RMI 的工作原理，请考虑 图 11.10 的客户端代码片段。代码片段中的每个变量都表示一个远程接口。然而，因为代码片段位于客户端，所以您知道这些变量实际持有的对象是**存根类**的实例。该片段没有显示变量 `rdvr` 如何获取其存根；它通过 **RMI 注册表**来获取，这将在 11.3.2 节中讨论。

考虑对 `rdvr.connect` 的调用。存根通过网络向服务器上其对应的 `RemoteDriver` 实现对象发送请求来执行其 `connect` 方法。这个远程实现对象在服务器上执行其 `connect` 方法，这将导致在服务器上创建一个新的 `RemoteConnection` 实现对象。这个新远程对象的存根被发送回客户端，客户端将其存储为变量 `rconn` 的值。

现在考虑对 `rconn.createStatement` 的调用。存根对象向服务器上其对应的 `RemoteConnection` 实现对象发送请求。这个远程对象执行其 `createStatement` 方法。一个 `RemoteStatement` 实现对象在服务器上被创建，其存根被返回给客户端。


### 11.3.2 RMI 注册表 (The RMI Registry)

每个客户端存根对象都包含对其相应的服务器端远程实现对象的引用。客户端一旦拥有一个存根对象，就能够通过该对象与服务器进行交互，并且该交互可能会为客户端创建其他供其使用的存根对象。但问题仍然存在——客户端如何获取它的**第一个存根**？RMI 通过一个名为 **rmi 注册表 (rmi registry)** 的程序解决了这个问题。服务器在 RMI 注册表中发布存根对象，客户端从中检索存根对象。

SimpleDB 服务器只发布一个 `RemoteDriver` 类型的对象。发布操作由 `simpledb.server.StartServer` 程序中的以下三行代码执行：

```java
// 在本地机器上创建并启动 RMI 注册表，监听端口 1099（RMI 惯用端口）
Registry reg = LocateRegistry.createRegistry(1099);
// 创建 RemoteDriver 接口的服务器端实现对象
RemoteDriver d = new RemoteDriverImpl();
// 将远程实现对象 d 的存根绑定到 RMI 注册表中，并命名为 "simpledb"，使其可供客户端查找
reg.rebind("simpledb", d);
```

`createRegistry` 方法在本地机器上启动 RMI 注册表，使用指定的端口。（约定是使用端口 1099。）方法调用 `reg.rebind` 为远程实现对象 `d` 创建一个存根，将其保存在 rmi 注册表中，并以名称“simpledb”使其可供客户端访问。

客户端可以通过调用注册表上的 `lookup` 方法从注册表中请求一个存根。在 SimpleDB 中，这个请求通过 `NetworkDriver` 类中的以下几行代码完成：

```java
// 从 JDBC URL 中解析出服务器主机名
String host = url.replace("jdbc:simpledb://", "");
// 获取指定主机和端口上的 RMI 注册表引用
Registry reg = LocateRegistry.getRegistry(host, 1099);
// 从注册表中查找名为 "simpledb" 的存根对象，并将其强制转换为 RemoteDriver 类型
RemoteDriver rdvr = (RemoteDriver) reg.lookup("simpledb");
```

`getRegistry` 方法返回指定主机和端口上 RMI 注册表的引用。对 `reg.lookup` 的调用会访问 RMI 注册表，从中检索名为“simpledb”的存根，并将其返回给调用者。


### 11.3.3 线程问题 (Thread Issues)

在构建大型 Java 程序时，始终清楚在任何时候存在哪些线程是一个很好的实践。在 SimpleDB 的基于服务器的执行中，将存在两组线程：**客户端机器上的线程**和**服务器机器上的线程**。

每个客户端在自己的机器上都有自己的线程。这个线程贯穿客户端的整个执行过程；客户端的所有存根对象都从这个线程调用。另一方面，服务器上的每个远程对象都在其自己的独立线程中执行。服务器端远程对象可以被视为一个“迷你服务器”，它等待其存根连接到它。当建立连接时，远程对象执行请求的工作，将返回值发送回客户端，然后耐心等待另一个连接。由 `simpledb.server.Startup` 创建的 `RemoteDriver` 对象运行在一个可以被认为是“数据库服务器”线程的线程中。

每当客户端进行远程方法调用时，**客户端线程会等待**，同时相应的**服务器线程运行**，并在服务器线程返回一个值时恢复执行。类似地，服务器端线程将处于休眠状态，直到其方法之一被调用，并在方法完成后恢复休眠。因此，在任何给定时间，这些客户端和服务器线程中**只有一个**会在做任何事情。非正式地，看起来客户端的线程实际上在远程调用时在客户端和服务器之间来回移动。尽管这种形象可以帮助您可视化客户端-服务器应用程序中的控制流，但理解实际发生的情况也很重要。

区分客户端和服务器端线程的一种方法是打印一些东西。从客户端线程调用 `System.out.println` 时，它会显示在客户端机器上；从服务器线程调用时，它会显示在服务器机器上。