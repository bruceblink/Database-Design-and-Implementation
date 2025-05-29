---
typora-root-url: ./..\..\public
---

# 第 5 章 事务管理 (Transaction Management)

缓冲区管理器允许多个客户端并发访问同一个缓冲区，随意读取和写入其值。这可能导致混乱：客户端每次查看页面时，页面可能具有不同（甚至不一致）的值，使得客户端无法准确了解数据库。或者两个客户端可能会无意中覆盖彼此的值，从而损坏数据库。因此，数据库引擎具有**并发管理器 (concurrency manager)** 和**恢复管理器 (recovery manager)**，它们的工作是维护秩序并确保数据库完整性。每个客户端程序都编写为一系列**事务 (transactions)**。并发管理器调节这些事务的执行，使它们保持一致。恢复管理器读取和写入日志记录，以便在必要时可以撤消未提交事务所做的更改。本章涵盖了这些管理器的功能以及实现它们的技术。

## 5.1 事务 (Transactions)

考虑一个航班预订数据库，它有两个表，字段如下：

SEATS(FlightId, NumAvailable, Price)

CUST(CustId, BalanceDue)

图 5.1 包含用于为指定客户预订指定航班机票的 JDBC 代码。尽管此代码没有错误，但在多个客户端并发使用或服务器崩溃时，可能会出现各种问题。以下三个场景说明了这些问题。

```java
public void reserveSeat(Connection conn, int custId, int flightId) throws SQLException {
    Statement stmt = conn.createStatement();
    String s;

    // 步骤 1: 获取可用座位数和价格
    s = "select NumAvailable, Price from SEATS " + "where FlightId = " + flightId;
    ResultSet rs = stmt.executeQuery(s);
    if (!rs.next()) {
        System.out.println("航班不存在");
        return;
    }
    int numAvailable = rs.getInt("NumAvailable");
    int price = rs.getInt("Price");
    rs.close();

    if (numAvailable == 0) {
        System.out.println("航班已满");
        return;
    }

    // 步骤 2: 更新可用座位数
    int newNumAvailable = numAvailable - 1;
    s = "update SEATS set NumAvailable = " + newNumAvailable + " where FlightId = " + flightId;
    stmt.executeUpdate(s);

    // 步骤 3: 获取并更新客户余额
    s = "select BalanceDue from CUST where CustID = " + custId;
    rs = stmt.executeQuery(s);
    // 假设查询结果集一定有下一行且可以获取到 BalanceDue，这里省略了 rs.next() 检查
    // 实际应用中需要加上 rs.next() 检查以避免 SQLException
    rs.next(); // 假定这里有结果
    int newBalance = rs.getInt("BalanceDue") + price;
    rs.close();
    s = "update CUST set BalanceDue = " + newBalance + " where CustId = " + custId;
    stmt.executeUpdate(s);
}
```

**图 5.1 JDBC 代码预订航班座位**

在第一个场景中，假设客户端 A 和 B 同时运行 JDBC 代码，按以下操作序列：

- 客户端 A 执行完步骤 1，然后被中断。
- 客户端 B 执行完成。
- 客户端 A 完成其执行。 在这种情况下，两个线程都将使用 `numAvailable` 的相同值。结果是会售出两个座位，但可用座位数只减少一次。

在第二个场景中，假设在客户端运行代码时，服务器在步骤 2 执行后立即崩溃。在这种情况下，座位将被预留，但客户不会被收取费用。

在第三个场景中，假设客户端运行代码直到完成，但缓冲区管理器没有立即将修改后的页面写入磁盘。如果服务器崩溃（可能几天后），那么将无法知道哪些页面（如果有）最终被写入磁盘。如果第一次更新被写入而第二次更新没有，那么客户会收到一张免费机票；如果第二次更新被写入而第一次更新没有，那么客户会被收取不存在机票的费用。如果两个页面都没有写入，那么整个交互都将丢失。

上述场景说明了当客户端程序能够不加区分地运行时，数据是如何丢失或损坏的。数据库引擎通过强制客户端程序由**事务 (transactions)** 组成来解决这个问题。**事务**是一组表现为一个单一操作的操作。**“作为一个单一操作”\**的含义可以通过以下所谓的 \*\*ACID 特性\*\*来表征：\*\*原子性 (atomicity)\*\*、\*\*一致性 (consistency)\*\*、\*\*隔离性 (isolation)\*\* 和\**持久性 (durability)**。

- **原子性 (Atomicity)** 意味着事务是**“全有或全无 (all or nothing)”**。也就是说，要么其所有操作都成功（事务**提交 (commits)**），要么它们都失败（事务**回滚 (does a rollback)**）。
- **一致性 (Consistency)** 意味着每个事务都使数据库处于**一致状态 (consistent state)**。这意味着每个事务是一个完整的工作单元，可以独立于其他事务执行。
- **隔离性 (Isolation)** 意味着事务表现得好像它是唯一使用引擎的线程。如果多个事务同时运行，那么它们的结果应该与它们以某种顺序串行执行的结果相同。
- **持久性 (Durability)** 意味着已提交事务所做的更改保证是**永久的 (permanent)**。

上述每个场景都源于对 ACID 特性的某种违反。第一个场景违反了**隔离性**，因为两个客户端读取了 `numAvailable` 的相同值，而在任何串行执行中，第二个客户端都会读取第一个客户端写入的值。第二个场景违反了**原子性**，第三个场景违反了**持久性**。

原子性和持久性特性描述了**提交 (commit)** 和**回滚 (rollback)** 操作的正确行为。已提交的事务必须是持久的，而未提交的事务（无论是由于显式回滚还是系统崩溃）必须将其更改完全撤消。这些功能是恢复管理器的职责，是第 5.3 节的主题。

一致性和隔离性特性描述了并发客户端的正确行为。数据库引擎必须阻止客户端之间发生冲突。一个典型的策略是检测何时即将发生冲突，并使其中一个客户端等待，直到该冲突不再可能发生。这些功能是并发管理器的职责，是第 5.4 节的主题。

## 5.2 在 SimpleDB 中使用事务 (Using Transactions in SimpleDB)

在深入了解恢复管理器和并发管理器如何工作之前，先了解客户端如何使用事务会有所帮助。在 SimpleDB 中，每个 JDBC 事务都有自己的 **Transaction 对象**；其 API 如 图 5.2 所示。

```java
public class Transaction {
    // 构造函数：初始化事务，需要文件管理器、日志管理器和缓冲区管理器
    public Transaction(FileMgr fm, LogMgr lm, BufferMgr bm);

    // 提交事务：使所有更改永久化
    public void commit();

    // 回滚事务：撤销所有未提交的更改
    public void rollback();

    // 恢复数据库：在系统崩溃后恢复到一致状态
    public void recover();

    // 固定（pin）一个块到缓冲区
    public void pin(BlockId blk);

    // 解除固定（unpin）一个块
    public void unpin(BlockId blk);

    // 从指定块的指定偏移量读取一个整数
    public int getInt(BlockId blk, int offset);

    // 从指定块的指定偏移量读取一个字符串
    public String getString(BlockId blk, int offset);

    // 在指定块的指定偏移量写入一个整数，okToLog 参数指示是否需要写入日志
    public void setInt(BlockId blk, int offset, int val, boolean okToLog);

    // 在指定块的指定偏移量写入一个字符串，okToLog 参数指示是否需要写入日志
    public void setString(BlockId blk, int offset, String val, boolean okToLog);

    // 获取当前可用缓冲区的数量
    public int availableBuffs();

    // 获取指定文件的长度（块数）
    public int size(String filename); // Original text uses 'size', but typically 'length' for file size in blocks.
                                    // Based on context and previous FileMgr, assume this means 'length'.

    // 追加一个新块到指定文件的末尾
    public BlockId append(String filename); // Changed return type to BlockId based on FileMgr append method.

    // 获取块大小
    public int blockSize();
}
```

**图 5.2 SimpleDB 事务的 API**

`Transaction` 类的方法分为三类。

第一类是与事务**生命周期**相关的方法。**构造函数**启动一个新事务，**`commit`** 和 **`rollback`** 方法终止它，而 **`recover`** 方法回滚所有未提交的事务。`commit` 和 `rollback` 方法会自动解除固定事务锁定的缓冲区页面。

第二类是**访问缓冲区**的方法。事务向其客户端隐藏缓冲区的存在。当客户端对一个块调用 `pin` 时，事务在内部保存缓冲区，而不将其返回给客户端。当客户端调用 `getInt` 等方法时，它传入一个 `BlockId` 引用。事务找到相应的缓冲区，调用缓冲区页面的 `getInt` 方法，并将结果返回给客户端。

事务向客户端隐藏缓冲区，以便它可以向并发管理器和恢复管理器发出必要的调用。例如，`setInt` 的代码在修改缓冲区之前，会先获取适当的**锁**（用于并发控制）并将当前缓冲区中的值写入**日志**（用于恢复）。`setInt` 和 `setString` 的第四个参数是一个布尔值，指示更新是否应该被记录到日志。这个值通常为 `true`，但在某些情况下（例如格式化新块或撤销事务）不适合记录日志，此时该值应为 `false`。

第三类是与**文件管理器**相关的三个方法。`size` 方法读取文件末尾标记，而 `append` 方法修改它；这些方法必须调用并发管理器以避免潜在冲突。`blockSize` 方法的存在是为了方便可能需要它的客户端。

```java
public class TxTest {
    public static void main(String[] args) throws Exception {
        // 第一部分：初始化 SimpleDB 对象
        SimpleDB db = new SimpleDB("txtest", 400, 8); // 数据库名为 "txtest"，块大小 400，缓冲区 8
        FileMgr fm = db.fileMgr();   // 获取文件管理器
        LogMgr lm = db.logMgr();     // 获取日志管理器
        BufferMgr bm = db.bufferMgr(); // 获取缓冲区管理器

        // 事务 1: 初始化块值 (不记录日志)
        Transaction tx1 = new Transaction(fm, lm, bm);
        BlockId blk = new BlockId("testfile", 1); // 目标块：文件 "testfile" 的块 1
        tx1.pin(blk); // 固定块 1
        tx1.setInt(blk, 80, 1, false);     // 在偏移量 80 写入整数 1，不记录日志
        tx1.setString(blk, 40, "one", false); // 在偏移量 40 写入字符串 "one"，不记录日志
        tx1.commit(); // 提交事务 1

        // 事务 2: 读取并修改块值 (记录日志)
        Transaction tx2 = new Transaction(fm, lm, bm);
        tx2.pin(blk); // 固定块 1
        int ival = tx2.getInt(blk, 80);    // 读取偏移量 80 的整数
        String sval = tx2.getString(blk, 40); // 读取偏移量 40 的字符串
        System.out.println("位置 80 处的初始值 = " + ival);
        System.out.println("位置 40 处的初始值 = " + sval);

        int newival = ival + 1;       // 整数值加 1
        String newsval = sval + "!";  // 字符串后追加 "!"
        tx2.setInt(blk, 80, newival, true);     // 写入新整数值，记录日志
        tx2.setString(blk, 40, newsval, true); // 写入新字符串值，记录日志
        tx2.commit(); // 提交事务 2

        // 事务 3: 读取值，修改，然后回滚
        Transaction tx3 = new Transaction(fm, lm, bm);
        tx3.pin(blk); // 固定块 1
        System.out.println("位置 80 处的新值 = " + tx3.getInt(blk, 80));
        System.out.println("位置 40 处的新值 = " + tx3.getString(blk, 40));
        tx3.setInt(blk, 80, 9999, true); // 修改整数值，记录日志
        System.out.println("回滚前位置 80 处的值 = " + tx3.getInt(blk, 80));
        tx3.rollback(); // 回滚事务 3，撤销对 9999 的写入

        // 事务 4: 验证回滚结果
        Transaction tx4 = new Transaction(fm, lm, bm);
        tx4.pin(blk); // 固定块 1
        System.out.println("回滚后位置 80 处的值 = " + tx4.getInt(blk, 80)); // 应该回到 tx2 提交后的值
        tx4.commit(); // 提交事务 4
    }
}
```

**图 5.3 测试 SimpleDB Transaction 类**

图 5.3 展示了 `Transaction` 方法的简单用法。代码包含四个事务，它们执行与 图 4.11 的 `BufferTest` 类相似的任务。所有四个事务都访问文件“testfile”的块 1。**事务 `tx1`** 初始化偏移量 80 和 40 处的值；这些更新**不记录日志**。**事务 `tx2`** 读取这些值，打印它们，并递增它们。**事务 `tx3`** 读取并打印递增后的值。然后它将整数设置为 9999 并回滚。**事务 `tx4`** 读取整数以验证回滚是否确实发生。

将此代码与第 4 章的代码进行比较，并观察 `Transaction` 类为您做了什么：它管理您的缓冲区；它为每次更新生成日志记录并将它们写入日志文件；并且它能够根据需要回滚您的事务。但同样重要的是，这个类如何在幕后工作以确保代码满足 ACID 特性。例如，假设您在程序执行时随机中止程序。当您随后重新启动数据库引擎时，所有已提交事务的修改都将在磁盘上（**持久性**），并且碰巧正在运行的事务的修改将被回滚（**原子性**）。

此外，`Transaction` 类还保证此程序将满足 ACID **隔离性**。考虑事务 `tx2` 的代码。变量 `newival` 和 `newsval`（参见加粗代码）初始化如下：

```java
int newival = ival + 1;
String newsval = sval + "!";
```

此代码假设块中位置 80 和 40 的值没有改变。然而，如果没有并发控制，这个假设可能不成立。这个问题是第 2.2.3 节的**“不可重复读 (non-repeatable read)”**场景。假设 `tx2` 在初始化 `ival` 和 `sval` 后立即被中断，并且另一个程序修改了偏移量 80 和 40 处的值。那么 `ival` 和 `sval` 的值现在已过期，`tx2` 必须再次调用 `getInt` 和 `getString` 以获取它们的正确值。`Transaction` 类负责确保这种可能性不会发生，从而保证此代码是正确的。
