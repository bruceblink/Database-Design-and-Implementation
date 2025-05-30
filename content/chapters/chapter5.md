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

## 5.3 恢复管理 (Recovery Management)

恢复管理器是数据库引擎中读取和处理日志的部分。它有三个功能：写入日志记录、回滚事务以及在系统崩溃后恢复数据库。本节将详细探讨这些功能。

```txt
<START, 1>          // 事务 1 开始
<COMMIT, 1>         // 事务 1 提交
<START, 2>          // 事务 2 开始
<SETINT, 2, testfile, 1, 80, 1, 2>      // 事务 2 更新整数：文件 "testfile" 块 1 偏移 80，旧值 1，新值 2
<SETSTRING, 2, testfile, 1, 40, one, one!> // 事务 2 更新字符串：文件 "testfile" 块 1 偏移 40，旧值 "one"，新值 "one!"
<COMMIT, 2>         // 事务 2 提交
<START, 3>          // 事务 3 开始
<SETINT, 3, testfile, 1, 80, 2, 9999>    // 事务 3 更新整数：文件 "testfile" 块 1 偏移 80，旧值 2，新值 9999
<ROLLBACK, 3>       // 事务 3 回滚
<START, 4>          // 事务 4 开始
<COMMIT, 4>         // 事务 4 提交
```

**图 5.4 由图 5.3 生成的日志记录**

### 5.3.1 日志记录 (Log Records)

为了能够回滚事务，恢复管理器会记录有关事务活动的信息。特别是，每次发生可记录日志的活动时，它都会向日志写入一条**日志记录 (log record)**。基本有四种日志记录：**开始记录 (start records)**、**提交记录 (commit records)**、**回滚记录 (rollback records)** 和**更新记录 (update records)**。我将遵循 SimpleDB 的约定，假设有两种更新记录：一种用于整数更新，一种用于字符串更新。

日志记录由以下可记录日志的活动生成：

- 当事务开始时，写入**开始记录**。
- 当事务完成时，写入**提交**或**回滚记录**。
- 当事务修改值时，写入**更新记录**。

另一个潜在的可记录日志的活动是向文件末尾追加块。然后，如果事务回滚，可以通过 `append` 分配的新块可以从文件中解除分配。为简单起见，我将忽略这种可能性。练习 5.48 解决了这个问题。

例如，考虑图 5.3 的代码，并假设 `tx1` 的 ID 是 1，依此类推。图 5.4 显示了此代码生成的日志记录。

每条日志记录都包含对其记录类型（`START`、`SETINT`、`SETSTRING`、`COMMIT` 或 `ROLLBACK`）的描述以及其事务的 ID。更新记录包含五个额外的值：被修改文件的名称和块号、修改发生的偏移量、该偏移量处的旧值以及该偏移量处的新值。

通常，多个事务会同时写入日志，因此给定事务的日志记录会散布在日志中。

### 5.3.2 回滚 (Rollback)

日志的一个用途是帮助恢复管理器回滚指定的事务 T。恢复管理器通过撤销事务的修改来回滚事务。由于这些修改列在更新日志记录中，因此扫描日志，查找每个更新记录，并恢复每个修改值的原始内容是一个相对简单的事情。图 5.5 介绍了该算法。

1. 将当前记录设置为最新日志记录。
2. 循环直到当前记录是 T 的开始记录：
    a) 如果当前记录是 T 的更新记录，则：将保存的旧值写入指定位置。
    b) 移动到日志中的上一条记录。
3. 向日志追加一个回滚记录。

**图 5.5 回滚事务 T 的算法**

### 5.3.3 恢复 (Recovery)

日志的另一个用途是**恢复数据库 (recover the database)**。每次数据库引擎启动时都会执行恢复。其目的是将数据库恢复到**合理状态 (reasonable state)**。“合理状态”意味着两件事：

- 所有未完成的事务都应该**回滚**。
- 所有已提交的事务都应该将其修改写入磁盘。

当数据库引擎在正常关闭后启动时，它应该已经处于合理状态，因为正常关闭过程是等待现有事务完成然后刷新所有缓冲区。然而，如果崩溃导致引擎意外关闭，则可能存在其执行已丢失的未完成事务。由于引擎无法完成它们，它们的修改必须**撤销 (undone)**。还可能存在其修改尚未刷新到磁盘的已提交事务；这些修改必须**重做 (redone)**。

恢复管理器假设如果日志文件包含某个事务的提交或回滚记录，则该事务已完成。因此，如果一个事务在系统崩溃之前已提交但其提交记录没有进入日志文件，则恢复管理器会将其视为未完成。这种情况可能看起来不公平，但恢复管理器确实别无他法。它所知道的只是日志文件中的内容，因为事务的其他所有内容都在系统崩溃中被清除。

```txt
 **// 撤销阶段 (The undo stage)**

1. 对于每条日志记录（从末尾向后读取）：
   a) 如果当前记录是提交记录，则：将该事务添加到已提交事务列表。
   b) 如果当前记录是回滚记录，则：将该事务添加到已回滚事务列表。
   c) 如果当前记录是未在已提交或已回滚列表中的事务的更新记录，则：恢复指定位置的旧值。

**// 重做阶段 (The redo stage)**

2. 对于每条日志记录（从开头向前读取）：
   如果当前记录是更新记录且该事务在已提交列表中，则：恢复指定位置的新值。
```

**图 5.6 恢复数据库的撤销-重做算法**

实际上，回滚一个已提交的事务不仅不公平；它违反了 ACID 特性中的**持久性**。因此，恢复管理器必须确保这种情况不会发生。它通过在完成提交操作之前将提交日志记录**刷新到磁盘 (flushing the commit log record to disk)** 来实现这一点。回想一下，刷新日志记录也会刷新所有先前的日志记录。因此，当恢复管理器在日志中找到提交记录时，它知道该事务的所有更新记录也都在日志中。

每条更新日志记录都包含修改的**旧值 (old value)** 和**新值 (new value)**。当您想要撤销修改时使用旧值，当您想要重做修改时使用新值。图 5.6 介绍了恢复算法。

**阶段 1 (Stage 1)** 撤销未完成的事务。与回滚算法一样，必须从末尾向后读取日志以确保正确性。从末尾向后读取日志还意味着在更新记录之前总是会找到提交记录；因此，当算法遇到更新记录时，它知道该记录是否需要撤销。

阶段 1 必须读取整个日志。例如，第一个事务可能在进入无限循环之前对数据库进行了更改。除非您读取到日志的最开始，否则不会找到该更新记录。

**阶段 2 (Stage 2)** 重做已提交的事务。由于恢复管理器无法判断哪些缓冲区已刷新而哪些未刷新，因此它会重做所有已提交事务所做的所有更改。

恢复管理器通过从头开始向前读取日志来执行阶段 2。恢复管理器知道哪些更新记录需要重做，因为它在阶段 1 计算了已提交事务的列表。请注意，在重做阶段必须向前读取日志。如果几个已提交的事务碰巧修改了相同的值，则最终恢复的值应该是由最近的修改产生的。

恢复算法不关心数据库的当前状态。它将旧值或新值写入数据库，而不查看这些位置的当前值是什么，因为日志精确地告诉它数据库的内容应该是什么。此功能有两个结果：

- **恢复是幂等的 (Recovery is idempotent)**。
- **恢复可能会导致比必要更多的磁盘写入**。

**幂等**意味着多次执行恢复算法与执行一次的结果相同。特别是，即使您在刚执行了部分恢复算法后立即重新运行它，您也会得到相同的结果。此属性对于算法的正确性至关重要。例如，假设数据库系统在执行恢复算法的中途崩溃。当数据库系统重新启动时，它将从头开始再次运行恢复算法。如果算法不是幂等的，那么重新运行它会损坏数据库。

因为此算法不查看数据库的当前内容，它可能会进行不必要的更改。例如，假设已提交事务所做的修改已写入磁盘；那么在阶段 2 中重做这些更改会将修改后的值设置为它们已经具有的内容。该算法可以修改为不进行这些不必要的磁盘写入；参见练习 5.44。

### 5.3.4 仅撤销和仅重做恢复 (Undo-Only and Redo-Only Recovery)

上一节的恢复算法既执行撤销操作也执行重做操作。数据库引擎可以选择简化算法，只执行撤销操作或只执行重做操作，也就是说，它执行算法的**阶段 1 (stage 1)** 或**阶段 2 (stage 2)** 中的一个，而不是两者都执行。

#### 5.3.4.1 仅撤销恢复 (Undo-Only Recovery)

如果恢复管理器确定所有已提交的修改都已写入磁盘，那么就可以省略阶段 2。恢复管理器可以通过在将提交记录写入日志之前，强制将缓冲区刷新到磁盘来实现这一点。图 5.7 展示了这种方法的算法。恢复管理器必须严格按照给定的顺序执行此算法的步骤。

1. 将事务修改过的缓冲区刷新到磁盘。
2. 将提交记录写入日志。
3. 将包含提交记录的日志页面刷新到磁盘。

**图 5.7 使用仅撤销恢复的事务提交算法**

那么，仅撤销恢复和撤销-重做恢复哪个更好呢？**仅撤销恢复**更快，因为它只需要对日志文件进行一次扫描，而不是两次。日志也会稍微小一些，因为更新记录不再需要包含新的修改值。另一方面，**提交操作**会慢得多，因为它必须刷新修改过的缓冲区。如果您假设系统崩溃不频繁，那么撤销-重做恢复会更优。事务提交速度更快，并且由于推迟了缓冲区刷新，总体磁盘写入次数也会减少。

#### 5.3.4.2 仅重做恢复 (Redo-Only Recovery)

如果未提交的缓冲区从不写入磁盘，则可以省略阶段 1。恢复管理器可以通过让每个事务在完成之前保持其缓冲区**固定 (pinned)** 来确保这一特性。一个固定的缓冲区不会被选中进行替换，因此其内容不会被刷新。此外，已回滚的事务需要“擦除”其修改过的缓冲区。图 5.8 给出了回滚算法中必要的修改。

对于事务修改的每个缓冲区：
a) 将缓冲区标记为未分配。（在 SimpleDB 中，将其块号设置为 -1）
b) 将缓冲区标记为未修改。
c) 解除固定缓冲区。

**图 5.8 使用仅重做恢复的回滚事务算法**

**仅重做恢复**比撤销-重做恢复更快，因为可以忽略未提交的事务。然而，它要求每个事务为其修改的每个块都保持一个缓冲区固定，这增加了系统中对缓冲区的**争用 (contention)**。对于大型数据库，这种争用会严重影响所有事务的性能，这使得仅重做恢复成为一个有风险的选择。

思考是否可以将仅撤销和仅重做技术结合起来，创建一个既不需要阶段 1 也不需要阶段 2 的恢复算法是很有趣的。请参见练习 5.19。

### 5.3.5 预写式日志 (Write-Ahead Logging)

图 5.6 中恢复算法的步骤 1 需要进一步检查。回想一下，此步骤遍历日志，对每个来自未完成事务的更新记录执行撤销操作。在证明此步骤的正确性时，我做了以下假设：**未完成事务的所有更新都将在日志文件中有一个相应的日志记录。** 否则，数据库将被损坏，因为将无法撤销该更新。

由于系统可能随时崩溃，满足此假设的唯一方法是让日志管理器在每个更新日志记录写入后立即将其**刷新到磁盘 (flush to disk)**。但正如第 4.2 节所示，这种策略效率低下得令人痛苦。一定有更好的方法。

我们来分析可能出现的问题。假设一个未完成的事务修改了一个页面并创建了一个相应的更新日志记录。如果服务器崩溃，有四种可能性：

(a) 页面和日志记录都已写入磁盘。

(b) 只有页面写入了磁盘。

(c) 只有日志记录写入了磁盘。

(d) 页面和日志记录都没有写入磁盘。

我们依次考虑每种可能性。如果 (a)，那么恢复算法将找到日志记录并撤销对磁盘上数据块的更改；没有问题。如果 (b)，那么恢复算法将找不到日志记录，因此它不会撤销对数据块的更改。这是一个严重的问题。如果 (c)，那么恢复算法将找到日志记录并撤销对块的不存在的更改。由于块实际上没有改变，这只是浪费时间，但不是错误。如果 (d)，那么恢复算法将找不到日志记录，但由于块没有改变，无论如何也没有什么可撤销的；没有问题。

因此，**(b)** 是唯一的问题情况。数据库引擎通过在刷新相应的修改缓冲区页面之前，将更新日志记录刷新到磁盘来避免这种情况。这种策略称为使用**预写式日志 (write-ahead log)**。请注意，日志可能描述从未实际发生的数据库修改（如上述可能性 (c)），但如果数据库确实被修改了，该修改的日志记录将始终在磁盘上。

实现预写式日志的标准方法是让每个缓冲区跟踪其最近修改的 **LSN (Log Sequence Number)**。在缓冲区替换修改过的页面之前，它会通知日志管理器将日志刷新到该 LSN。结果是，与修改对应的日志记录将始终在修改保存到磁盘之前就在磁盘上。

### 5.3.6 静止检查点 (Quiescent Checkpointing)

日志包含数据库每次修改的历史记录。随着时间的推移，日志文件的大小会变得非常大——在某些情况下，甚至比数据文件还大。在恢复期间读取整个日志并撤销/重做数据库的每次更改可能会变得不堪重负。因此，已经设计出只读取部分日志的恢复策略。基本思想是，恢复算法一旦知道两件事就可以停止搜索日志：

- 所有较早的日志记录都是由**已完成事务**写入的。
- 那些事务的缓冲区已**刷新到磁盘**。

第一点适用于恢复算法的撤销阶段。它确保没有更多未提交的事务需要回滚。第二点适用于重做阶段，并确保所有较早提交的事务都不需要重做。请注意，如果恢复管理器实现仅撤销恢复，那么第二点将始终为真。

在任何时间点，恢复管理器都可以执行**静止检查点 (quiescent checkpoint)** 操作，如 图 5.9 所示。该算法的步骤 2 确保满足第一点，步骤 3 确保满足第二点。

1. 停止接受新事务。
2. 等待现有事务完成。
3. 刷新所有修改过的缓冲区。
4. 向日志追加一个静止检查点记录并将其刷新到磁盘。
5. 开始接受新事务。

**图 5.9 执行静止检查点的算法**

静止检查点记录在日志中充当一个**标记 (marker)**。当恢复算法的阶段 1 在向后遍历日志时遇到检查点记录时，它知道所有较早的日志记录都可以被忽略；因此，它可以从日志中的该点开始阶段 2 并向前移动。换句话说，恢复算法永远不需要查看静止检查点记录之前的日志记录。在系统启动时，在恢复完成并且新事务开始之前，是写入静止检查点记录的好时机。由于恢复算法刚刚完成日志处理，检查点记录确保它将永远不需要再次检查那些日志记录。

```txt
<START, 0>                               // 事务 0 开始
<SETINT, 0, junk, 33, 8, 542, 543>       // 事务 0 更新整数
<START, 1>                               // 事务 1 开始
<START, 2>                               // 事务 2 开始
<COMMIT, 1>                              // 事务 1 提交 (在检查点之前)
<SETSTRING, 2, junk, 44, 20, hello, ciao> // 事务 2 更新字符串
// 静止检查点过程从这里开始 (Quiescent checkpoint procedure starts here)
<SETSTRING, 0, junk, 33, 12, joe, joseph> // 事务 0 更新字符串
<COMMIT, 0>                              // 事务 0 提交 (在检查点之前)
// 事务 3 想在这里开始，但必须等待 (tx 3 wants to start here, but must wait)
<SETINT, 2, junk, 66, 8, 0, 116>          // 事务 2 更新整数
<COMMIT, 2>                              // 事务 2 提交 (在检查点之前)
<CHECKPOINT>                             // 检查点记录
<START, 3>                               // 事务 3 开始 (在检查点之后)
<SETINT, 3, junk, 33, 8, 543, 120>       // 事务 3 更新整数
```

**图 5.10 使用静止检查点的日志**

例如，考虑图 5.10 所示的日志。此示例日志说明了三件事：首先，一旦检查点过程开始，就不能启动新事务；其次，一旦最后一个事务完成并且缓冲区被刷新，检查点记录就会立即写入；第三，一旦检查点记录写入，其他事务就可以立即开始。

### 5.3.7 非静止检查点 (Nonquiescent Checkpointing)

静止检查点实现简单且易于理解。然而，它要求数据库在恢复管理器等待现有事务完成时不可用。在许多数据库应用程序中，这是一个严重的缺点——公司不希望他们的数据库偶尔停止响应任意时长。因此，开发了一种不需要静止的检查点算法。该算法如 图 5.11 所示。

1. 设 T1…Tk 是当前正在运行的事务。
2. 停止接受新事务。
3. 刷新所有修改过的缓冲区。
4. 将记录 `<NQCKPT T1, . . ., Tk>` 写入日志。
5. 开始接受新事务。

**图 5.11 添加非静止检查点记录的算法**

该算法使用一种不同类型的检查点记录，称为**非静止检查点记录 (nonquiescent checkpoint record)**。非静止检查点记录包含一个当前正在运行的事务列表。

恢复算法进行了如下修订：算法的**阶段 1 (Stage 1)** 像以前一样向后读取日志，并跟踪已完成的事务。当它遇到一个非静止检查点记录 `<NQCKPT T1, ..., Tk>` 时，它会确定这些事务中哪些仍在运行。然后它可以继续向后读取日志，直到遇到其中最早事务的开始记录。该开始记录之前的所有日志记录都可以被忽略。

例如，再次考虑 图 5.10 的日志。使用非静止检查点，日志将如 图 5.12 所示。请注意，`<NQCKPT ...>` 记录出现在此日志中，它位于 图 5.10 中检查点过程开始的位置，并表示事务 0 和 2 在该点仍然在运行。此日志与 图 5.10 的不同之处在于事务 2 从未提交。

```txt
<START, 0>
<SETINT, 0, junk, 33, 8, 542, 543>
<START, 1>
<START, 2>
<COMMIT, 1>
<SETSTRING, 2, junk, 44, 20, hello, ciao>
<SETSTRING, 0, junk, 33, 12, joe, joseph>
<COMMIT, 0>
<START, 3>
<NQCKPT, 0, 2>                         // 非静止检查点：事务 0 和 2 仍在运行
<SETINT, 2, junk, 66, 8, 0, 116>
<SETINT, 3, junk, 33, 8, 543, 120>
```

**图 5.12 使用非静止检查点的日志**

如果恢复算法在系统启动时看到此日志，它将进入阶段 1 并按以下步骤进行：

- 当它遇到 `<SETINT, 3, ...>` 日志记录时，它会检查事务 3 是否在已提交事务列表中。由于该列表当前为空，算法将执行**撤销 (undo)** 操作，将整数 543 写入文件 “junk” 的块 33 的偏移量 8。
- `<SETINT, 2, ...>` 日志记录也将被类似处理，将整数 0 写入文件 “junk” 的块 66 的偏移量 8。
- `<COMMIT, 0>` 日志记录将导致 0 被添加到已提交事务列表中。
- `<SETSTRING, 0, ...>` 日志记录将被忽略，因为 0 在已提交事务列表中。
- 当它遇到 `<NQCKPT 0,2>` 日志记录时，它知道事务 0 已经提交，因此它可以忽略事务 2 的开始记录之前的所有日志记录。
- 当它遇到 `<START, 2>` 日志记录时，它进入阶段 2 并开始向前遍历日志。
- `<SETSTRING, 0, ...>` 日志记录将被**重做 (redone)**，因为 0 在已提交事务列表中。值“joseph”将被写入文件 “junk” 的块 33 的偏移量 12。

### 5.3.8 数据项粒度 (Data Item Granularity)

本节的恢复管理算法使用**值 (values)** 作为日志记录的单位。也就是说，每当一个值被修改时，就会创建一个日志记录，其中包含该值的旧版本和新版本。这种日志记录单位称为**恢复数据项 (recovery data item)**。数据项的大小称为其**粒度 (granularity)**。

恢复管理器可以选择使用**块 (blocks)** 或**文件 (files)** 作为数据项，而不是使用值。例如，假设选择块作为数据项。在这种情况下，每次修改一个块时，都会创建一个更新日志记录，并将该块的旧值和新值存储在日志记录中。

记录块的优点是，如果使用仅撤销恢复，则所需的日志记录更少。假设一个事务固定一个块，修改了几个值，然后解除固定。您可以将块的原始内容保存在单个日志记录中，而不是为每个修改的值写入一个日志记录。当然，缺点是更新日志记录现在非常大；块的整个内容都会被保存，无论其中有多少值实际发生了变化。因此，只有当事务倾向于对每个块进行大量修改时，记录块才合理。

现在考虑使用文件作为数据项意味着什么。一个事务将为它更改的每个文件生成一个更新日志记录。每个日志记录将包含该文件的整个原始内容。要回滚一个事务，您只需要用其原始版本替换现有文件。这种方法几乎肯定不如使用值或块作为数据项实用，因为每个事务都必须复制整个文件，无论更改了多少值。

尽管文件粒度数据项对于数据库系统来说不实用，但它们经常被非数据库应用程序使用。例如，假设您的计算机在您编辑文件时崩溃。系统重启后，一些字处理器能够向您显示文件的两个版本：您最近保存的版本和崩溃时存在的版本。原因是这些字处理器不直接将您的修改写入原始文件，而是写入副本；当您保存时，修改后的文件会被复制到原始文件。这种策略是基于文件的日志记录的一种粗糙版本。

### 5.3.9 SimpleDB 恢复管理器 (The SimpleDB Recovery Manager)

SimpleDB 恢复管理器通过 `simpledb.tx.recovery` 包中的 `RecoveryMgr` 类实现。`RecoveryMgr` 的 API 如 图 5.13 所示。

```java
public class RecoveryMgr {
    // 构造函数：初始化 RecoveryMgr 对象
    public RecoveryMgr(Transaction tx, int txnum, LogMgr lm, BufferMgr bm);

    // 提交事务
    public void commit();

    // 回滚事务
    public void rollback();

    // 恢复数据库
    public void recover();

    // 设置整数值并记录日志
    public int setInt(Buffer buff, int offset, int newval);

    // 设置字符串值并记录日志
    public int setString(Buffer buff, int offset, String newval);
}
```

**图 5.13 SimpleDB 恢复管理器的 API**

每个事务都有自己的 `RecoveryMgr` 对象，其方法为该事务写入相应的日志记录。例如，构造函数向日志写入一个**开始日志记录 (start log record)**；`commit` 和 `rollback` 方法写入相应的日志记录；`setInt` 和 `setString` 方法从指定的缓冲区中提取旧值并向日志写入**更新记录 (update record)**。`rollback` 和 `recover` 方法执行回滚（或恢复）算法。一个 `RecoveryMgr` 对象使用**仅撤销恢复 (undo-only recovery)** 和**值粒度数据项 (value-granularity data items)**。其代码可以分为两个关注区域：实现日志记录的代码，以及实现回滚和恢复算法的代码。

#### 5.3.9.1 日志记录 (Log Records)

如第 4.2 节所述，日志管理器将每条日志记录视为一个字节数组。每种日志记录都有自己的类，负责在字节数组中嵌入适当的值。数组中的第一个值将是一个整数，表示记录的**操作符 (operator)**；操作符可以是常量 `CHECKPOINT`、`START`、`COMMIT`、`ROLLBACK`、`SETINT` 或 `SETSTRING` 之一。其余值取决于操作符——一个静止检查点记录没有其他值，一个更新记录有五个其他值，而其他记录有一个其他值。

```java
public interface LogRecord {
    // 定义日志记录操作符常量
    static final int CHECKPOINT = 0, START = 1, COMMIT = 2,
                     ROLLBACK = 3, SETINT = 4, SETSTRING = 5;

    // 返回记录的操作符
    int op();

    // 返回写入此日志记录的事务 ID
    int txNumber();

    // 撤销此记录存储的更改
    void undo(int txnum); // 注意：原始文本中是 int txnum，但实际实现中通常是 Transaction tx

    // 静态工厂方法，根据字节数组创建相应的 LogRecord 对象
    static LogRecord createLogRecord(byte[] bytes) {
        Page p = new Page(bytes);
        switch (p.getInt(0)) {
            case CHECKPOINT:
                return new CheckpointRecord();
            case START:
                return new StartRecord(p);
            case COMMIT:
                return new CommitRecord(p);
            case ROLLBACK:
                return new RollbackRecord(p);
            case SETINT:
                return new SetIntRecord(p);
            case SETSTRING:
                return new SetStringRecord(p);
            default:
                return null;
        }
    }
}
```

**图 5.14 SimpleDB LogRecord 接口的代码**

每个日志记录类都实现了 `LogRecord` 接口，如 图 5.14 所示。该接口定义了三个方法来提取日志记录的组成部分。`op` 方法返回记录的操作符。`txNumber` 方法返回写入日志记录的事务 ID。此方法对除检查点记录之外的所有日志记录都有意义，检查点记录返回一个虚拟 ID 值。`undo` 方法恢复该记录中存储的任何更改。只有 `setint` 和 `setstring` 日志记录才会有非空的 `undo` 方法；这些记录的方法将把一个缓冲区固定到指定的块，在指定的偏移量处写入指定的值，并解除固定缓冲区。

各种日志记录类的代码都相似；检查其中一个类，例如 `SetStringRecord`，其代码如 图 5.15 所示。

```java
public class SetStringRecord implements LogRecord {
    private int txnum, offset;
    private String val;
    private BlockId blk;

    // 构造函数：从 Page 对象中提取 SetStringRecord 的值
    public SetStringRecord(Page p) {
        int tpos = Integer.BYTES; // 事务号的起始位置
        txnum = p.getInt(tpos);

        int fpos = tpos + Integer.BYTES; // 文件名的起始位置
        String filename = p.getString(fpos);

        int bpos = fpos + Page.maxLength(filename.length()); // 块号的起始位置
        int blknum = p.getInt(bpos);
        blk = new BlockId(filename, blknum);

        int opos = bpos + Integer.BYTES; // 偏移量的起始位置
        offset = p.getInt(opos);

        int vpos = opos + Integer.BYTES; // 值的起始位置
        val = p.getString(vpos);
    }

    // 返回操作符类型 (SETSTRING)
    public int op() {
        return SETSTRING;
    }

    // 返回事务 ID
    public int txNumber() {
        return txnum;
    }

    // 返回此记录的字符串表示
    public String toString() {
        return "<SETSTRING " + txnum + " " + blk + " " + offset + " " + val + ">";
    }

    // 撤销此 SETSTRING 操作：将旧值写回块
    public void undo(Transaction tx) {
        tx.pin(blk); // 固定块
        tx.setString(blk, offset, val, false); // 写回旧值，注意不记录这次撤销操作的日志！
        tx.unpin(blk); // 解除固定块
    }

    // 静态方法：将 SetStringRecord 的信息写入日志
    public static int writeToLog(LogMgr lm, int txnum, BlockId blk,
                                 int offset, String val) {
        int tpos = Integer.BYTES; // 事务号的起始位置
        int fpos = tpos + Integer.BYTES; // 文件名的起始位置
        int bpos = fpos + Page.maxLength(blk.fileName().length()); // 块号的起始位置
        int opos = bpos + Integer.BYTES; // 偏移量的起始位置
        int vpos = opos + Integer.BYTES; // 值的起始位置
        int reclen = vpos + Page.maxLength(val.length()); // 记录的总长度

        byte[] rec = new byte[reclen]; // 创建一个字节数组来存储记录
        Page p = new Page(rec);       // 将字节数组包装成 Page 对象

        p.setInt(0, SETSTRING);        // 写入操作符
        p.setInt(tpos, txnum);         // 写入事务 ID
        p.setString(fpos, blk.fileName()); // 写入文件名
        p.setInt(bpos, blk.number());  // 写入块号
        p.setInt(opos, offset);        // 写入偏移量
        p.setString(vpos, val);        // 写入值 (旧值)

        return lm.append(rec);         // 将字节数组追加到日志并返回其 LSN
    }
}
```

**图 5.15 SetStringRecord 类的代码**

该类有两个重要方法：一个静态方法 `writeToLog`，它将 `SETSTRING` 日志记录的六个值编码成一个字节数组；以及构造函数，它从该字节数组中提取这六个值。考虑 `writeToLog` 的实现。它首先计算字节数组的大小以及数组中每个值的偏移量。然后它创建该大小的字节数组，将其包装在 `Page` 对象中，并使用页面的 `setInt` 和 `setString` 方法在适当的位置写入值。构造函数是类似的。它确定页面中每个值的偏移量并提取它们。

`undo` 方法有一个参数，即执行撤销操作的事务。该方法让事务**固定 (pin)** 记录所指示的块，写入保存的值，然后**解除固定 (unpin)** 块。调用 `undo` 的方法（无论是 `rollback` 还是 `recover`）负责将缓冲区内容刷新到磁盘。

#### 5.3.9.2 回滚和恢复 (Rollback and Recover)

`RecoveryMgr` 类实现了**仅撤销恢复 (undo-only recovery)** 算法；其代码如 图 5.16 所示。`commit` 和 `rollback` 方法在写入日志记录之前刷新事务的缓冲区，而 `doRollback` 和 `doRecover` 方法则对日志进行单次向后遍历。

`doRollback` 方法遍历日志记录。每当它找到该事务的日志记录时，它都会调用记录的 `undo` 方法。当它遇到该事务的开始记录时，它会停止。

```java
public class RecoveryMgr {
    private LogMgr lm;      // 日志管理器
    private BufferMgr bm;   // 缓冲区管理器
    private Transaction tx; // 关联的事务对象
    private int txnum;      // 事务 ID


    // 构造函数：创建一个新的 RecoveryMgr 对象，并写入一个 START 日志记录
    public RecoveryMgr(Transaction tx, int txnum, LogMgr lm, BufferMgr bm) {
        this.tx = tx;
        this.txnum = txnum;
        this.lm = lm;
        this.bm = bm;
        StartRecord.writeToLog(lm, txnum); // 事务开始时写入 START 记录
    }

    // 提交事务：
    // 1. 刷新该事务修改过的所有缓冲区到磁盘。
    // 2. 写入 COMMIT 日志记录。
    // 3. 强制日志管理器将包含 COMMIT 记录的页面刷新到磁盘，确保持久性。
    public void commit() {
        bm.flushAll(txnum); // 刷新所有属于此事务的缓冲区
        int lsn = CommitRecord.writeToLog(lm, txnum); // 写入 COMMIT 记录
        lm.flush(lsn); // 刷新日志到磁盘
    }

    // 回滚事务：
    // 1. 执行实际的回滚操作 (doRollback)。
    // 2. 刷新该事务修改过的所有缓冲区到磁盘。
    // 3. 写入 ROLLBACK 日志记录。
    // 4. 强制日志管理器将包含 ROLLBACK 记录的页面刷新到磁盘。
    public void rollback() {
        doRollback(); // 执行回滚逻辑
        bm.flushAll(txnum); // 刷新所有属于此事务的缓冲区
        int lsn = RollbackRecord.writeToLog(lm, txnum); // 写入 ROLLBACK 记录
        lm.flush(lsn); // 刷新日志到磁盘
    }

    // 恢复数据库：
    // 1. 执行实际的恢复操作 (doRecover)。
    // 2. 刷新所有缓冲区到磁盘。
    // 3. 写入 CHECKPOINT 日志记录。
    // 4. 强制日志管理器将包含 CHECKPOINT 记录的页面刷新到磁盘。
    public void recover() {
        doRecover(); // 执行恢复逻辑
        bm.flushAll(txnum); // 刷新所有缓冲区
        int lsn = CheckpointRecord.writeToLog(lm); // 写入 CHECKPOINT 记录
        lm.flush(lsn); // 刷新日志到磁盘
    }

    // 记录 SETINT 操作：
    // 1. 获取缓冲区中指定偏移量的旧值。
    // 2. 将旧值、事务 ID、块信息、偏移量和新值写入 SETINT 日志记录。
    public int setInt(Buffer buff, int offset, int newval) {
        int oldval = buff.contents().getInt(offset); // 获取旧值
        BlockId blk = buff.block(); // 获取块 ID
        // 写入 SETINT 记录，包含事务ID、块ID、偏移量、旧值和新值
        return SetIntRecord.writeToLog(lm, txnum, blk, offset, oldval);
    }

    // 记录 SETSTRING 操作：
    // 1. 获取缓冲区中指定偏移量的旧值。
    // 2. 将旧值、事务 ID、块信息、偏移量和新值写入 SETSTRING 日志记录。
    public int setString(Buffer buff, int offset, String newval) {
        String oldval = buff.contents().getString(offset); // 获取旧值
        BlockId blk = buff.block(); // 获取块 ID
        // 写入 SETSTRING 记录，包含事务ID、块ID、偏移量、旧值和新值
        return SetStringRecord.writeToLog(lm, txnum, blk, offset, oldval);
    }

    // 私有方法：执行事务的回滚操作 (仅撤销)
    // 从日志末尾向后读取，找到属于当前事务的更新记录并撤销其更改，直到遇到该事务的 START 记录。
    private void doRollback() {
        Iterator<byte[]> iter = lm.iterator(); // 获取日志迭代器（从后向前）
        while (iter.hasNext()) {
            byte[] bytes = iter.next();
            LogRecord rec = LogRecord.createLogRecord(bytes); // 创建日志记录对象
            if (rec.txNumber() == txnum) { // 如果记录属于当前事务
                if (rec.op() == START) { // 如果是 START 记录，说明已回滚到事务开始，停止
                    return;
                }
                rec.undo(tx); // 调用日志记录的 undo 方法来撤销更改
            }
        }
    }

    // 私有方法：执行数据库的恢复操作 (仅撤销)
    // 从日志末尾向后读取，记录已提交/已回滚的事务，并撤销所有未完成事务的更改。
    // 遇到 CHECKPOINT 记录时停止。
    private void doRecover() {
        Collection<Integer> finishedTxs = new ArrayList<Integer>(); // 存储已完成事务的 ID
        Iterator<byte[]> iter = lm.iterator(); // 获取日志迭代器（从后向前）
        while (iter.hasNext()) {
            byte[] bytes = iter.next();
            LogRecord rec = LogRecord.createLogRecord(bytes); // 创建日志记录对象
            if (rec.op() == CHECKPOINT) { // 如果是 CHECKPOINT 记录，停止
                return;
            }
            if (rec.op() == COMMIT || rec.op() == ROLLBACK) { // 如果是 COMMIT 或 ROLLBACK 记录
                finishedTxs.add(rec.txNumber()); // 将事务 ID 添加到已完成列表
            } else if (!finishedTxs.contains(rec.txNumber())) { // 如果是更新记录且事务未完成
                rec.undo(tx); // 撤销其更改
            }
        }
    }

}
```

**图 5.16 SimpleDB `RecoveryMgr` 类的代码**

`doRecover` 方法的实现类似。它读取日志直到遇到**静止检查点记录 (quiescent checkpoint record)** 或到达日志末尾，同时维护一个已提交事务编号列表。它撤销未提交的更新记录的方式与回滚相同，不同之处在于它处理所有未提交的事务，而不仅仅是特定的一个。此方法与图 5.6 的恢复算法略有不同，因为它会撤销已回滚的事务。尽管这种差异不会导致代码不正确，但它会降低效率。练习 5.50 要求您改进它。

## 5.4 并发管理 (Concurrency Management)

并发管理器是数据库引擎中负责**并发事务 (concurrent transactions)** 正确执行的组件。本节将探讨“正确”执行的含义，并研究一些确保正确性的算法。

### 5.4.1 可串行化调度 (Serializable Schedules)

一个事务的**历史 (history)** 是它对数据库文件进行访问的方法调用序列——特别是 `get/set` 方法。[¹ 例如，图 5.3 中每个事务的历史可以相当繁琐地写成 图 5.17a 所示。表达事务历史的另一种方式是根据受影响的块来表示，如 图 5.17b 所示。例如，`tx2` 的历史表明它两次从块 `blk` 读取，然后两次写入 `blk`。

```txt
tx1: setInt(blk, 80, 1, false);     // 事务 1: 设置整数
     setString(blk, 40, "one", false);  // 事务 1: 设置字符串

tx2: getInt(blk, 80);               // 事务 2: 获取整数
     getString(blk, 40);            // 事务 2: 获取字符串
     setInt(blk, 80, newival, true);    // 事务 2: 设置整数
     setString(blk, 40, newsval, true); // 事务 2: 设置字符串

tx3: getInt(blk, 80));              // 事务 3: 获取整数
     getString(blk, 40));           // 事务 3: 获取字符串
     setInt(blk, 80, 9999, true);   // 事务 3: 设置整数
     getInt(blk, 80));              // 事务 3: 获取整数

tx4: getInt(blk, 80));              // 事务 4: 获取整数

(a) 数据访问历史

tx1: W(blk); W(blk)             // 事务 1: 写 blk; 写 blk
tx2: R(blk); R(blk); W(blk); W(blk) // 事务 2: 读 blk; 读 blk; 写 blk; 写 blk
tx3: R(blk); R(blk); W(blk); R(blk) // 事务 3: 读 blk; 读 blk; 写 blk; 读 blk
tx4: R(blk)                     // 事务 4: 读 blk

(b) 块访问历史
```

**图 5.17 图 5.3 中的事务历史。(a) 数据访问历史，(b) 块访问历史**

形式上，事务的历史是该事务所做的**数据库动作 (database actions)** 序列。“数据库动作”这个术语故意模糊。图 5.17 的 (a) 部分将数据库动作视为对值的修改，而 (b) 部分将其视为对磁盘块的读/写。还有其他可能的粒度，将在第 5.4.8 节中讨论。在此之前，我将假定数据库动作是对磁盘块的读取或写入。

当多个事务并发运行时，数据库引擎将**交错 (interleave)** 它们的线程执行，定期中断一个线程并恢复另一个线程。（在 SimpleDB 中，Java 运行时环境会自动执行此操作。）因此，并发管理器执行的实际操作序列将是其事务历史的不可预测的交错。这种交错称为**调度 (schedule)**。

并发控制的目的是确保只执行**正确 (correct)** 的调度。但“正确”意味着什么？嗯，考虑最简单的调度——所有事务都**串行运行 (serially)** 的调度（例如 图 5.17）。此调度中的操作不会交错，也就是说，调度将简单地是每个事务的历史背靠背。这种调度称为**串行调度 (serial schedule)**。并发控制的前提是串行调度必须是正确的，因为没有并发。

以串行调度来定义正确性的有趣之处在于，同一事务的不同串行调度可以给出不同的结果。例如，考虑两个事务 T1 和 T2，它们具有以下相同的历史：

```txt
T1: W(b1); W(b2)
T2: W(b1); W(b2)
```

尽管这些事务具有相同的历史（即，它们都先写入块 b1，然后写入块 b2），但它们作为事务不一定相同——例如，T1 可能在每个块的开头写入一个“X”，而 T2 可能写入一个“Y”。如果 T1 在 T2 之前执行，则块将包含 T2 写入的值，但如果它们以相反的顺序执行，则块将包含 T1 写入的值。

在这个例子中，T1 和 T2 对块 b1 和 b2 应该包含什么有不同的看法。由于在数据库引擎看来所有事务都是平等的，所以无法说一个结果比另一个更正确。因此，您被迫承认任何一个串行调度的结果都是正确的。也就是说，可以有几个正确的结果。

如果一个非串行调度 (non-serial schedule) 产生与某个串行调度相同的结果，则称其为可串行化 (serializable)。² 由于串行调度是正确的，因此可串行化调度也必须是正确的。例如，考虑上述事务的以下非串行调度：

`W1(b1); W2(b1); W1(b2); W2(b2)`

这里，W1(b1) 意味着事务 T1 写入块 b1，依此类推。此调度是 T1 的前半部分运行，接着是 T2 的前半部分，T1 的后半部分，以及 T2 的后半部分。此调度是可串行化的，因为它等价于先执行 T1 然后执行 T2。另一方面，考虑以下调度：

`W1(b1); W2(b1); W2(b2); W1(b2)`

此事务执行 T1 的前半部分，T2 的全部，然后是 T1 的后半部分。此调度的结果是块 b1 包含 T2 写入的值，但块 b2 包含 T1 写入的值。这个结果不能由任何串行调度产生，因此该调度被称为**不可串行化 (non-serializable)**。

回想一下**隔离性 (isolation)** 的 ACID 特性，它指出每个事务的执行应该像它是系统中唯一的事务一样。一个不可串行化调度不具备此特性。因此，您被迫承认不可串行化调度是不正确的。换句话说，一个调度**当且仅当**它是可串行化时才是正确的。

------

¹ 译者注：在原文中，get/set 方法是对数据库文件进行访问，但在本节中，作者明确指出“数据库动作是对磁盘块的读取或写入”。这可能指的是对 Page 对象中的数据进行 getInt/setString 操作，而 Page 对象本身是缓冲区管理器从磁盘读取的块。因此，这些操作最终对应于对底层磁盘块的读写。

² 译者注：这个定义是数据库并发控制的核心概念之一。它确保了并发执行的正确性。

------

### 5.4.2 锁表 (The Lock Table)

数据库引擎负责确保所有调度都是可串行化的。一种常见技术是使用**锁定 (locking)** 来推迟事务的执行。第 5.4.3 节将探讨如何使用锁定来确保可串行化。本节仅检查基本锁定机制的工作原理。

每个块有两种类型的锁——**共享锁 (shared lock)**（或 `slock`）和**排他锁 (exclusive lock)**（或 `xlock`）。如果一个事务在一个块上持有排他锁，则不允许其他任何事务在该块上持有任何类型的锁；如果事务在一个块上持有共享锁，则其他事务只允许在该块上持有共享锁。请注意，这些限制仅适用于**其他**事务。单个事务可以在一个块上同时持有共享锁和排他锁。

**锁表 (lock table)** 是数据库引擎中负责向事务授予锁的组件。SimpleDB 类 `LockTable` 实现了锁表。其 API 如 图 5.18 所示。

```java
public class LockTable {
    public void sLock(Block blk);  // 请求指定块的共享锁
    public void xLock(Block blk);  // 请求指定块的排他锁
    public void unlock(Block blk); // 释放指定块的锁
}
```

**图 5.18 SimpleDB 类 LockTable 的 API**

`sLock` 方法请求指定块的共享锁。如果该块上已存在排他锁，则该方法会等待直到排他锁被释放。`xLock` 方法请求块的排他锁。该方法会等待直到没有其他事务在该块上持有任何类型的锁。`unlock` 方法释放块上的锁。

图 5.19 介绍了 `ConcurrencyTest` 类，它演示了一些锁请求之间的交互。

```java
public class ConcurrencyTest {
    private static FileMgr fm;
    private static LogMgr lm;
    private static BufferMgr bm;

    public static void main(String[] args) {
        // 初始化数据库引擎
        SimpleDB db = new SimpleDB("concurrencytest", 400, 8);
        fm = db.fileMgr();
        lm = db.logMgr();
        bm = db.bufferMgr();

        // 创建并启动三个并发线程
        A a = new A(); new Thread(a).start();
        B b = new B(); new Thread(b).start();
        C c = new C(); new Thread(c).start();
    }

    // 线程 A 类
    static class A implements Runnable {
        public void run() {
            try {
                Transaction txA = new Transaction(fm, lm, bm);
                BlockId blk1 = new BlockId("testfile", 1);
                BlockId blk2 = new BlockId("testfile", 2);

                txA.pin(blk1); // 事务 A 固定块 1
                txA.pin(blk2); // 事务 A 固定块 2

                System.out.println("Tx A: request slock 1");
                txA.getInt(blk1, 0); // 请求块 1 的共享锁 (getInt 会内部调用 slock)
                System.out.println("Tx A: receive slock 1");
                Thread.sleep(1000); // 暂停 1 秒

                System.out.println("Tx A: request slock 2");
                txA.getInt(blk2, 0); // 请求块 2 的共享锁
                System.out.println("Tx A: receive slock 2");
                txA.commit(); // 提交事务，释放所有锁
            }
            catch(InterruptedException e) {};
        }
    }

    // 线程 B 类
    static class B implements Runnable {
        public void run() {
            try {
                Transaction txB = new Transaction(fm, lm, bm);
                BlockId blk1 = new BlockId("testfile", 1);
                BlockId blk2 = new BlockId("testfile", 2);

                txB.pin(blk1); // 事务 B 固定块 1
                txB.pin(blk2); // 事务 B 固定块 2

                System.out.println("Tx B: request xlock 2");
                txB.setInt(blk2, 0, 0, false); // 请求块 2 的排他锁 (setInt 会内部调用 xlock)
                System.out.println("Tx B: receive xlock 2");
                Thread.sleep(1000); // 暂停 1 秒

                System.out.println("Tx B: request slock 1");
                txB.getInt(blk1, 0); // 请求块 1 的共享锁
                System.out.println("Tx B: receive slock 1");
                txB.commit(); // 提交事务，释放所有锁
            }
            catch(InterruptedException e) {};
        }
    }

    // 线程 C 类
    static class C implements Runnable {
        public void run() {
            try {
                Transaction txC = new Transaction(fm, lm, bm);
                BlockId blk1 = new BlockId("testfile", 1);
                BlockId blk2 = new BlockId("testfile", 2);

                txC.pin(blk1); // 事务 C 固定块 1
                txC.pin(blk2); // 事务 C 固定块 2

                System.out.println("Tx C: request xlock 1");
                txC.setInt(blk1, 0, 0, false); // 请求块 1 的排他锁
                System.out.println("Tx C: receive xlock 1");
                Thread.sleep(1000); // 暂停 1 秒

                System.out.println("Tx C: request slock 2");
                txC.getInt(blk2, 0); // 请求块 2 的共享锁
                System.out.println("Tx C: receive slock 2");
                txC.commit(); // 提交事务，释放所有锁
            }
            catch(InterruptedException e) {};
        }
    }
}
```

**图 5.19 测试锁请求之间的交互**

`main` 方法执行三个并发线程，分别对应 `A`、`B` 和 `C` 类的一个对象。这些事务不显式地锁定和解锁块。相反，`Transaction` 的 `getInt` 方法获取一个 `slock`，其 `setInt` 方法获取一个 `xlock`，而其 `commit` 方法解锁其所有锁。因此，每个事务的锁和解锁序列如下所示：

- `txA`: `sLock(blk1)`; `sLock(blk2)`; `unlock(blk1)`; `unlock(blk2)`
- `txB`: `xLock(blk2)`; `sLock(blk1)`; `unlock(blk1)`; `unlock(blk2)`
- `txC`: `xLock(blk1)`; `sLock(blk2)`; `unlock(blk1)`; `unlock(blk2)`

这些线程中包含 `sleep` 语句，以强制事务交替其锁请求。以下事件序列会发生：

1. 线程 A 获取 `blk1` 上的 **共享锁 (slock)**。
2. 线程 B 获取 `blk2` 上的 **排他锁 (xlock)**。
3. 线程 C 无法获取 `blk1` 上的 `xlock`，因为其他事务已持有该块的锁。因此，线程 C 等待。
4. 线程 A 无法获取 `blk2` 上的 `slock`，因为其他事务已持有该块的 `xlock`。因此，线程 A 也等待。
5. 线程 B 可以继续。它获取 `blk1` 上的 `slock`，因为当前没有其他事务持有该块的 `xlock`。（线程 C 正在等待该块的 `xlock` 并不重要。）
6. 线程 B 解锁块 `blk1`，但这并没有帮助任何等待中的线程。
7. 线程 B 解锁块 `blk2`。
8. 线程 A 现在可以继续并获取 `blk2` 上的 `slock`。
9. 线程 A 解锁块 `blk1`。
10. 线程 C 最终能够获取 `blk1` 上的 `xlock`。
11. 线程 A 和 C 可以以任意顺序继续，直到它们完成。

### 5.4.3 锁定协议 (The Lock Protocol)

现在是时候解决如何使用锁定来确保所有调度都可串行化的问题了。考虑以下历史的两个事务：

T1: R(b1); W(b2)

T2: W(b1); W(b2)

是什么导致它们的串行调度产生不同的结果？事务 T1 和 T2 都写入同一个块 b2，这意味着这些操作的顺序会产生影响——哪个事务最后写入，哪个就是“赢家”。操作 {W1(b2),W2(b2)} 被称为**冲突 (conflict)**。通常，如果两个操作的执行顺序会导致不同的结果，则它们冲突。如果两个事务有冲突操作，那么它们的串行调度可能会有不同（但同样正确）的结果。

这种冲突是**写-写冲突 (write-write conflict)** 的一个例子。第二种冲突是**读-写冲突 (read-write conflict)**。例如，操作 {R1(b1),W2(b1)} 冲突——如果 R1(b1) 先执行，那么 T1 读取的是块 b1 的一个版本，而如果 W2(b1) 先执行，那么 T1 读取的是块 b1 的另一个不同版本。请注意，两个读操作永远不会冲突，涉及不同块的操作也不会冲突。

关注冲突的原因是它们影响调度的**可串行化 (serializability)**。非串行调度中冲突操作的执行顺序决定了等价的串行调度必须是什么。在上述例子中，如果 W2(b1) 在 R1(b1) 之前执行，那么任何等价的串行调度都必须是 T2 在 T1 之前运行。通常，如果您考虑 T1 中与 T2 冲突的所有操作，那么它们要么必须全部在任何冲突的 T2 操作之前执行，要么必须全部在它们之后执行。非冲突操作可以以任意顺序发生。³

  ```txt
   1. 在读取块之前，获取其**共享锁 (shared lock)**。
   2. 在修改块之前，获取其**排他锁 (exclusive lock)**。
   3. 在提交或回滚后，释放所有锁。
  ```

 **图 5.20 锁定协议**

锁定可用于避免写-写冲突和读-写冲突。特别是，假设所有事务都根据 图 5.20 的协议使用锁。

从这个协议中，您可以推断出两个重要事实。首先，如果一个事务在一个块上获得共享锁，那么其他活跃事务将不会写入该块（否则，某个事务仍将持有该块的排他锁）。其次，如果一个事务在一个块上获得排他锁，那么其他活跃事务将不会以任何方式访问该块（否则，某个事务仍将持有该块的锁）。这些事实意味着一个事务执行的操作永远不会与另一个活跃事务的先前操作冲突。换句话说，如果所有事务都遵守锁定协议，那么：

- 结果调度将始终是**可串行化**的（因此是正确的）
- 等价的串行调度由事务提交的顺序决定

通过强制事务持有其锁直到完成，锁定协议极大地限制了系统中的并发性。如果事务能在不再需要锁时释放它们会很好，这样其他事务就不必等待那么长时间。然而，如果事务在完成之前释放其锁，可能会出现两个严重问题：它可能不再可串行化，以及其他事务可以读取其未提交的更改。接下来讨论这两个问题。

#### 5.4.3.1 可串行化问题 (Serializability Problems)

一旦事务解锁了一个块，它就不能再锁定另一个块而不影响可串行化。要理解原因，请考虑事务 T1 在锁定块 y 之前解锁块 x：
T1: ... R(x); UL(x); SL(y); R(y); ...

> ³ 实际上，您可以构造一些晦涩的例子，其中某些写-写冲突也可以以任意顺序发生；参见练习 5.26。然而，这些例子不够实用，不值得考虑。
>

假设 T1 在解锁 x 和获取 y 的共享锁之间的时间间隔内被中断。此时，T1 极其脆弱，因为 x 和 y 都未被锁定。假设另一个事务 T2 介入，锁定 x 和 y，写入它们，提交，并释放其锁。以下情况已经发生：T1 必须在串行顺序中排在 T2 之前，因为 T1 读取了 T2 写入之前的块 x 版本。另一方面，T1 也必须在串行顺序中排在 T2 之后，因为 T1 将读取 T2 写入的块 y 版本。因此，结果调度是不可串行化的。

可以证明，反之亦然——如果一个事务在解锁任何锁之前获取其所有锁，那么结果调度保证是可串行化的（参见练习 5.27）。这种锁定协议的变体称为**两阶段锁定 (two-phase locking)**。这个名字来源于这样一个事实：在该协议下，一个事务有两个阶段——**积累锁的阶段 (phase where it accumulates the locks)** 和**释放锁的阶段 (phase where it releases the locks)**。

尽管两阶段锁定在理论上是一个更通用的协议，但数据库引擎不容易利用它。通常，当一个事务完成访问其最后一个块（即最终可以释放锁的时候）时，它无论如何都准备好提交了。因此，完全通用的两阶段锁定协议在实践中很少有效。

#### 5.4.3.2 读取未提交数据 (Reading Uncommitted Data)

过早释放锁的另一个问题（即使是两阶段锁定）是事务将能够读取**未提交数据 (uncommitted data)**。考虑以下部分调度：
... W1(b); UL1(b); SL2(b); R2(b); ...

在此调度中，T1 写入块 b 并解锁它；事务 T2 然后锁定并读取 b。如果 T1 最终提交，则没有问题。但假设 T1 执行回滚。那么 T2 也必须回滚，因为它的执行是基于不再存在的更改。如果 T2 回滚，这可能会导致其他事务也回滚。这种现象称为**级联回滚 (cascading rollback)**。

当数据库引擎允许事务读取未提交数据时，它会增加并发性，但它承担了写入数据的事务不会提交的风险。当然，回滚通常不频繁，级联回滚应该更少见。问题是数据库引擎是否愿意承担任何可能不必要地回滚事务的风险。大多数商业数据库系统不愿意承担这种风险，因此总是等待事务完成才释放其排他锁。

### 5.4.4 死锁 (Deadlock)

尽管锁定协议保证了调度是可串行化的，但它不保证所有事务都会提交。特别是，事务可能会**死锁 (deadlocked)**。

第 4.5.1 节给出了一个死锁的例子，其中两个客户端线程都在等待对方释放缓冲区。锁也存在类似的可能性。死锁 (deadlock) 发生在存在一个事务循环时，其中第一个事务正在等待第二个事务持有的锁，第二个事务正在等待第三个事务持有的锁，依此类推，直到最后一个事务正在等待第一个事务持有的锁。在这种情况下，所有等待的事务都无法继续，并且可能会永远等待。例如，考虑以下两个简单历史，其中事务写入相同的块但顺序不同：

T1: W(b1); W(b2)

T2: W(b2); W(b1)

假设 T1 首先获得了块 b1 上的锁。现在对块 b2 上的锁存在竞争。如果 T1 先得到它，那么 T2 将等待，T1 最终会提交并释放其锁，T2 就可以继续。没有问题。但如果 T2 先获得了块 b2 上的锁，那么就会发生死锁——T1 正在等待 T2 解锁块 b2，而 T2 正在等待 T1 解锁块 b1。两个事务都无法继续。

并发管理器可以通过维护一个**“等待-图 (waits-for)”** 来检测死锁。该图为每个事务设置一个节点，如果 T1 正在等待 T2 持有的锁，则从 T1 到 T2 有一条边；每条边都用事务正在等待的块进行标记。每次请求或释放锁时，都会更新该图。例如，对应上述死锁场景的等待-图如 图 5.21 所示。

```txt
[T1] --(b2)--> [T2]
 ^             |
 |             |
 +-----(b1)----+
```

**图 5.21 一个等待-图**

容易证明，存在死锁当且仅当等待-图包含一个环；参见练习 5.28。当事务管理器检测到死锁的发生时，它可以通过**summarily rolling back (立即回滚)** 循环中的任何一个事务来打破它。一个合理的策略是回滚其锁请求“导致”循环的事务，尽管其他策略也是可能的；参见练习 5.29。

如果考虑等待缓冲区的线程以及等待锁的线程，那么死锁检测会变得相当复杂。例如，假设缓冲区池只包含两个缓冲区，并考虑以下场景：

T1: xlock(b1); pin(b4)

T2: pin(b2); pin(b3); xlock(b1)

假设事务 T1 在获得块 b1 上的锁后被中断，然后 T2 固定块 b2 和 b3。T2 将最终在 `xlock(b1)` 的等待列表中，而 T1 将最终在缓冲区的等待列表中。尽管等待-图是**无环的 (acyclic)**，但仍然存在死锁。

为了在这种情况下检测死锁，锁管理器不仅要维护等待-图，还需要知道哪些事务正在等待哪些缓冲区。将这一额外考虑纳入死锁检测算法被证明是相当困难的。鼓励有冒险精神的读者尝试练习 5.37。

使用等待-图检测死锁的问题在于，该图维护起来有些困难，并且在图中检测循环耗时。因此，已经开发出更简单的策略来**近似死锁检测 (approximate deadlock detection)**。这些策略是**保守的 (conservative)**，因为它们总是会检测到死锁，但它们也可能将非死锁情况视为死锁。本节考虑了两种可能的策略；练习 5.33 考虑了另一种。

第一个近似策略称为**等待-死亡 (wait-die)**，它定义如 图 5.22 所示。

```txt
假设 T1 请求的锁与 T2 持有的锁冲突。
如果 T1 比 T2 老，则：
T1 等待锁。
否则：
T1 被回滚（即它“死亡”）。
```

**图 5.22 等待-死亡死锁检测策略**

该策略确保不会发生死锁，因为等待-图将只包含从**旧事务 (older transactions)** 到**新事务 (newer transactions)** 的边。但该策略也将每个潜在的死锁视为回滚的原因。例如，假设事务 T1 比 T2 老，并且 T2 请求 T1 当前持有的锁。尽管此请求可能不会立即导致死锁，但存在潜在的可能性，因为在稍后的某个点，T1 可能会请求 T2 持有的锁。因此，等待-死亡策略将**抢先回滚 (preemptively roll back)** T2。

第二个近似策略是使用**时间限制 (time limit)** 来检测可能的死锁。如果一个事务已经等待了预设的时间量，那么事务管理器将假定它已死锁并将其回滚。参见 图 5.23。

```txt
假设 T1 请求的锁与 T2 持有的锁冲突。
1. T1 等待锁。
2. 如果 T1 在等待列表中停留时间过长，则：
   T1 被回滚。
```

**图 5.23 时间限制死锁检测策略**

无论死锁检测策略如何，并发管理器都必须通过回滚一个活跃事务来打破死锁。希望通过释放该事务的锁，其余事务将能够完成。一旦事务回滚，并发管理器会抛出一个异常；在 SimpleDB 中，此异常称为 `LockAbortException`。与第 4 章的 `BufferAbortException` 一样，此异常由被中止事务的 JDBC 客户端捕获，然后由客户端决定如何处理它。例如，客户端可以选择直接退出，或者它可以尝试再次运行该事务。

### 5.4.5 文件级冲突和幻影 (File-Level Conflicts and Phantoms)

本章到目前为止考虑了因块的读写而产生的冲突。另一种冲突涉及 `size` 和 `append` 方法，它们读写**文件末尾标记 (end-of-file marker)**。这两个方法显然相互冲突：假设事务 T1 在事务 T2 调用 `size` 之前调用 `append`；那么 T1 必须在任何串行顺序中排在 T2 之前。

这种冲突的后果之一被称为**幻影问题 (phantom problem)**。假设 T2 重复读取文件的全部内容，并在每次迭代之前调用 `size` 以确定要读取多少块。此外，假设在 T2 第一次读取文件之后，事务 T1 向文件中追加了一些额外的块，用值填充它们，并提交。下次遍历文件时，T2 将看到这些额外的值，这违反了 ACID 特性中的**隔离性 (isolation)**。这些额外的值被称为**幻影 (phantoms)**，因为对于 T2 来说，它们神秘地出现了。

并发管理器如何避免这种冲突？锁定协议要求 T2 对其读取的每个块获取一个 `slock`，以便 T1 无法向这些块写入新值。然而，这种方法在这里不起作用，因为它将要求 T2 在 T1 创建新块之前就对其进行 `slock`！

解决方案是允许事务锁定**文件末尾标记 (end-of-file marker)**。特别是，一个事务需要对标记进行 `xlock` 才能调用 `append` 方法，并且需要对标记进行 `slock` 才能调用 `size` 方法。在上述场景中，如果 T1 首先调用 `append`，那么 T2 将无法确定文件大小，直到 T1 完成；反之，如果 T2 已经确定了文件大小，那么 T1 将被阻止追加，直到 T2 提交。无论哪种情况，都不会出现幻影。

### 5.4.6 多版本锁定 (Multiversion Locking)

许多数据库应用程序中的事务都是**只读事务 (read-only)**。只读事务在数据库引擎中能够很好地共存，因为它们共享锁，从不相互等待。然而，它们与更新事务相处得并不好。假设一个更新事务正在写入一个块。那么所有想要读取该块的只读事务都必须等待，不仅要等到块写入完成，还要等到更新事务完成。反之，如果一个更新事务想要写入一个块，它需要等待所有读取该块的只读事务完成。

换句话说，当只读事务和更新事务发生冲突时，无论哪个事务先获得锁，都会发生大量的等待。鉴于这种情况很常见，研究人员开发了减少这种等待的策略。其中一种策略称为**多版本锁定 (multiversion locking)**。

#### 5.4.6.1 多版本锁定的原理 (The Principle of Multiversion Locking)

顾名思义，多版本锁定通过存储每个块的**多个版本 (multiple versions)** 来工作。基本思想如下：

- 每个块的版本都带有一个**时间戳 (timestamp)**，表示写入该块的事务的**提交时间 (commit time)**。
- 当一个只读事务从一个块请求一个值时，并发管理器使用该事务开始时**最近提交 (most recently committed)** 的块版本。

换句话说，只读事务看到的是**提交数据的快照 (snapshot of the committed data)**，就像事务开始时那样。请注意“提交数据”这个术语。事务看到的是在其开始之前提交的事务写入的数据，而看不到之后事务写入的数据。

考虑以下多版本锁定的示例。假设四个事务具有以下历史：

T1: W(b1); W(b2)

T2: W(b1); W(b2)

T3: R(b1); R(b2)

T4: W(b2)

并且它们按照以下调度执行：

```txt
W1(b1); W1(b2); C1; W2(b1); R3(b1); W4(b2); C4; R3(b2); C3; W2(b1); C2
```

**图 5.24 多版本并发**

此调度假设事务在其第一个操作时开始，并在需要之前立即获取其锁。操作 `Ci` 表示事务 Ti 何时提交。更新事务 T1、T2 和 T4 遵循锁定协议，您可以从调度中验证。事务 T3 是一个只读事务，不遵循协议。

并发管理器为每个写入块的更新事务存储一个块的版本。因此，b1 将有两个版本，b2 将有三个版本，如 图 5.24 所示。

每个版本上的时间戳是其事务**提交时 (commit time)** 的时间，而不是写入发生的时间。假设每个操作需要一个时间单位，因此 T1 在时间 3 提交，T4 在时间 7 提交，T3 在时间 9 提交，T2 在时间 11 提交。

现在考虑只读事务 T3。它在时间 5 开始，这意味着它应该看到该点已提交的值，即 T1 所做的更改，而不是 T2 或 T4 的更改。因此，它将看到时间戳为 3 的 b1 和 b2 版本。请注意，T3 不会看到时间戳为 7 的 b2 版本，即使该版本在读取发生时已经提交。

多版本锁定的优点在于只读事务不需要获取锁，因此永远不必等待。并发管理器根据事务的开始时间选择所请求块的适当版本。一个更新事务可以同时对同一块进行更改，但只读事务不会在意，因为它看到的是该块的不同版本。

多版本锁定仅适用于只读事务。更新事务需要遵循锁定协议，根据需要获取共享锁和排他锁。原因是每个更新事务都读写数据的**当前版本 (current version)**（而不是以前的版本），因此可能会发生冲突。但请记住，这些冲突仅发生在更新事务之间，而不与只读事务发生冲突。因此，假设冲突的更新事务相对较少，等待的频率将大大降低。

#### 5.4.6.2 实现多版本锁定 (Implementing Multiversion Locking)

既然您已经了解了多版本锁定应该如何工作，那么让我们检查一下并发管理器是如何实现其所需功能的。基本问题是如何维护每个块的版本。一种直接但有些困难的方法是明确地将每个版本保存在一个专用的“版本文件”中。另一种方法是使用日志来**重建 (reconstruct)** 块的任何所需版本。其实现工作方式如下。

每个只读事务在开始时都被赋予一个**时间戳 (timestamp)**。每个更新事务在提交时被赋予一个时间戳。更新事务的提交方法被修改为包含以下操作：

- 恢复管理器将事务的时间戳作为其提交日志记录的一部分写入。
- 对于事务持有的每个排他锁，并发管理器会**固定 (pin)** 该块，将时间戳写入块的开头，并**解除固定 (unpin)** 缓冲区。

假设一个时间戳为 `t` 的只读事务请求一个块 `b`。并发管理器采取以下步骤来重建适当的版本：

- 它将块 `b` 的当前版本复制到一个新页面。
- 它向后读取日志三次 (reads the log backwards three times)，如下所示：
  - 它构建了一个在时间 `t` 之后提交的事务列表。由于事务按时间戳顺序提交，当并发管理器找到一个时间戳小于 `t` 的提交记录时，它可以停止读取日志。
  - 它通过查找由没有提交或回滚记录的事务写入的日志记录来构建一个**未完成事务列表 (list of uncompleted transactions)**。当它遇到一个**静止检查点记录 (quiescent checkpoint record)** 或非静止检查点记录中最早事务的开始记录时，它可以停止读取日志。
  - 它使用更新记录来撤销 `b` 副本中的值。当它遇到一个由上述列表中任何事务写入的 `b` 的更新记录时，它会执行**撤销 (undo)** 操作。当它遇到列表中最早事务的开始记录时，它可以停止读取日志。
- 修改后的 `b` 副本被返回给事务。

换句话说，并发管理器通过**撤销 (undo)** 那些在时间 `t` 之前未提交的事务所做的修改来**重建 (reconstruct)** 块在时间 `t` 的版本。该算法为了简单起见，对日志进行了三次遍历。练习 5.38 要求您重写该算法以实现对日志的单次遍历。

最后，事务需要指定它是否为只读，因为并发管理器对这两种类型的事务处理方式不同。在 JDBC 中，此规范通过 `Connection` 接口中的 `setReadOnly` 方法执行。例如：

```java
Connection conn = ... // 获取连接
conn.setReadOnly(true); // 将连接设置为只读模式
```

`setReadOnly` 的调用被认为是给数据库系统的**“提示 (hint)”**。如果系统不支持多版本锁定，它可以选择忽略此调用。

### 5.4.7 事务隔离级别 (Transaction Isolation Levels)

强制执行**可串行化 (serializability)** 会导致大量的等待，因为锁定协议要求事务在完成之前一直持有其锁。因此，如果事务 T1 恰好只需要一个与 T2 持有的锁冲突的锁，那么 T1 在 T2 完成之前什么也做不了。

**多版本锁定 (multiversion locking)** 非常有吸引力，因为它允许只读事务在没有锁的情况下执行，从而避免了不得不等待的不便。然而，多版本锁定的实现有些复杂，并且需要额外的磁盘访问来重新创建版本。此外，多版本锁定不适用于更新数据库的事务。

| **隔离级别 (ISOLATION LEVEL)** | **问题 (PROBLEMS)**                                          | **锁使用 (LOCK USAGE)**                           | **备注 (COMMENTS)**                            |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| **SERIALIZABLE**               | 无 (none)                                                    | **slock** 保持到完成，对 **eof 标记**有 **slock** | 唯一保证正确性的级别                           |
| **REPEATABLE READ**            | 幻影 (phantoms)                                              | **slock** 保持到完成，对 **eof 标记**无 **slock** | 对基于修改的事务有用                           |
| **READ COMMITTED**             | 幻影，值可能更改 (phantoms, values may change)               | **slock** 早期释放，对 **eof 标记**无 **slock**   | 对概念上可分离的事务有用，其更新是“全有或全无” |
| **READ UNCOMMITTED**           | 幻影，值可能更改，脏读 (phantoms, values may change, dirty reads) | 完全无 **slock**                                  | 对允许不准确结果的只读事务有用                 |

**图 5.25 事务隔离级别**

事务还有另一种方式来减少等待锁的时间——它可以指定它不需要完全的可串行化。第 2 章研究了 JDBC 的四种**事务隔离级别 (transaction isolation levels)**。图 5.25 总结了这些级别及其属性。

第 2 章将这些隔离级别与可能发生的不同问题联系起来。图 5.25 的新颖之处在于它还将这些级别与 **共享锁 (slocks)** 的使用方式联系起来。**可串行化隔离 (Serializable isolation)** 要求非常严格的共享锁定，而**读未提交隔离 (read-uncommitted isolation)** 甚至不使用共享锁。显然，锁定限制越少，发生的等待就越少。但锁定限制越少，查询结果中的不准确性就越多：事务可能会看到**幻影 (phantoms)**，或者它可能会在不同时间在同一位置看到两个不同的值，或者它可能会看到未提交事务写入的值。

我想强调的是，这些隔离级别仅适用于**数据读取 (data reading)**。所有事务，无论其隔离级别如何，在写入数据方面都应表现正确。它们必须获取适当的**排他锁 (xlocks)**（包括文件末尾标记上的排他锁），并持有它们直到完成。原因是个别事务在运行查询时可以选择容忍不准确性，但**不准确的更新 (inaccurate update)** 会毒害整个数据库，是不可容忍的。

读未提交隔离与多版本锁定如何比较？两者都适用于只读事务，并且都无需锁定即可操作。然而，使用读未提交隔离的事务会看到它读取的每个块的**当前值 (current value)**，无论哪个事务何时写入它。它甚至远非可串行化。另一方面，使用多版本锁定的事务会看到块在单个时间点的**已提交内容 (committed contents)**，并且是可串行化的。

### 5.4.8 数据项粒度 (Data Item Granularity)

本章假设并发管理器锁定块。但是，也可以有其他锁定**粒度 (granularities)**：并发管理器可以锁定值、文件，甚至整个数据库。锁定的单位称为**并发数据项 (concurrency data item)**。并发控制的原则不受所使用的数据项粒度的影响。本章中的所有定义、协议和算法都适用于任何数据项。因此，粒度的选择是一个实际问题，需要在**效率 (efficiency)** 和**灵活性 (flexibility)** 之间取得平衡。本节将探讨一些这些权衡。

并发管理器为每个数据项维护一个锁。较小的粒度大小很有用，因为它允许更多的并发性。例如，假设两个事务希望并发修改同一块的不同部分。这些并发修改在**值粒度锁定 (value-granularity locking)** 下是可能的，但在**块粒度锁定 (block-granularity locking)** 下则不行。

然而，较小的粒度需要更多的锁。值倾向于形成不切实际的小数据项，因为它们需要大量的锁。另一方面，使用文件作为数据项将需要很少的锁，但也会显著影响并发性——客户端需要对整个文件进行排他锁才能更新其任何部分。使用**块 (blocks)** 作为数据项是一个合理的折衷方案。

顺便提一下，请注意某些操作系统（例如 macOS 和 Windows）使用文件粒度锁定来实现一种原始形式的并发控制。特别是，应用程序无法在没有文件排他锁的情况下写入文件，并且如果该文件当前正在被另一个应用程序使用，它就无法获取排他锁。

一些并发管理器支持**多粒度 (multiple granularities)** 的数据项，例如块和文件。计划只访问文件几个块的事务可以单独锁定它们；但如果事务计划访问文件的全部（或大部分），它将获取一个**文件粒度锁 (file-granularity lock)**。这种方法将小粒度项的灵活性与高级别项的便利性结合起来。

```java
public class ConcurrencyMgr {
    public ConcurrencyMgr(int txnum); // 构造函数，传入事务 ID
    public void sLock(Block blk);     // 请求指定块的共享锁
    public void xLock(Block blk);     // 请求指定块的排他锁
    public void release();            // 释放所有锁
}
```

**图 5.26 SimpleDB 并发管理器的 API**

另一种可能的粒度是使用**数据记录 (data records)** 作为并发数据项。数据记录由记录管理器处理，这是下一章的主题。SimpleDB 的结构使得并发管理器不理解记录，因此无法锁定它们。然而，一些商业系统（例如 Oracle）的构建使得并发管理器了解记录管理器并可以调用其方法。在这种情况下，数据记录将是一个合理的并发数据项。

尽管数据记录粒度看起来很有吸引力，但它带来了额外的**幻影 (phantoms)** 问题。由于新数据记录可以插入到现有块中，一个从块中读取所有记录的事务需要一种方法来阻止其他事务向该块插入记录。解决方案是让并发管理器也支持**更粗粒度 (coarser-granularity)** 的数据项，例如块或文件。事实上，一些商业系统通过简单地强制事务在执行任何插入操作之前获取文件的排他锁来避免幻影。

### 5.4.9 SimpleDB 并发管理器 (The SimpleDB Concurrency Manager)

SimpleDB 并发管理器通过 `simpledb.tx.concurrency` 包中的 **ConcurrencyMgr** 类实现。并发管理器使用**块级粒度 (block-level granularity)** 实现锁定协议。其 API 如 图 5.26 所示。

```java
public class ConcurrencyMgr {
    public ConcurrencyMgr(int txnum); // 构造函数，传入事务 ID
    public void sLock(Block blk);     // 请求指定块的共享锁
    public void xLock(Block blk);     // 请求指定块的排他锁
    public void release();            // 释放所有锁
}
```

**图 5.26 SimpleDB 并发管理器的 API**

每个事务都有自己的并发管理器。并发管理器的方法与锁表的方法类似，但它们是事务特定的。每个 `ConcurrencyMgr` 对象都会跟踪其事务持有的锁。`sLock` 和 `xLock` 方法仅在事务尚未持有锁时才向锁表请求锁。`release` 方法在事务结束时调用，以解锁其所有锁。

`ConcurrencyMgr` 类使用了实现 SimpleDB 锁表的 `LockTable` 类。本节的其余部分将探讨这两个类的实现。

#### 5.4.9.1 `LockTable` 类 (The Class LockTable)

`LockTable` 类的代码如 图 5.27 所示。`LockTable` 对象持有一个名为 `locks` 的 `Map` 变量。这个 map 包含当前已分配锁的每个块的条目。条目的值将是一个 `Integer` 对象；值为 -1 表示分配了**排他锁 (exclusive lock)**，而正值表示当前分配的**共享锁 (shared lock)** 的数量。

`sLock` 和 `xLock` 方法的工作方式与 `BufferMgr` 的 `pin` 方法非常相似。每个方法都在循环内调用 Java 的 `wait` 方法，这意味着只要循环条件成立，客户端线程就会被持续地放置在等待列表中。`sLock` 的循环条件调用 `hasXlock` 方法，如果块在 `locks` 中有一个值为 -1 的条目，则该方法返回 true。`xLock` 的循环条件调用 `hasOtherSLocks` 方法，如果块在 `locks` 中有一个大于 1 的条目，则该方法返回 true。其原理是并发管理器在请求排他锁之前总是会先获取块的共享锁，因此大于 1 的值表示其他事务也持有该块的锁。

```java
class LockTable {
    private static final long MAX_TIME = 10000; // 10 秒
    private Map<Block, Integer> locks = new HashMap<Block, Integer>(); // 存储块及其锁状态

    // 请求共享锁
    public synchronized void sLock(Block blk) {
        try {
            long timestamp = System.currentTimeMillis();
            // 如果块有排他锁且当前线程等待时间未超过最大时间，则等待
            while (hasXlock(blk) && !waitingTooLong(timestamp))
                wait(MAX_TIME); // 等待 MAX_TIME 毫秒或直到被通知
            // 如果等待超时后仍然有排他锁，则抛出异常
            if (hasXlock(blk))
                throw new LockAbortException();
            int val = getLockVal(blk); // 获取当前锁值（不会是负数，因为有排他锁时已等待）
            locks.put(blk, val + 1); // 增加共享锁计数
        } catch (InterruptedException e) {
            throw new LockAbortException(); // 捕获中断异常并抛出锁中止异常
        }
    }

    // 请求排他锁
    public synchronized void xLock(Block blk) {
        try {
            long timestamp = System.currentTimeMillis();
            // 如果块有其他共享锁（不止一个）且当前线程等待时间未超过最大时间，则等待
            while (hasOtherSLocks(blk) && !waitingTooLong(timestamp))
                wait(MAX_TIME); // 等待 MAX_TIME 毫秒或直到被通知
            // 如果等待超时后仍然有其他共享锁，则抛出异常
            if (hasOtherSLocks(blk))
                throw new LockAbortException();
            locks.put(blk, -1); // 设置为排他锁（-1）
        } catch (InterruptedException e) {
            throw new LockAbortException(); // 捕获中断异常并抛出锁中止异常
        }
    }

    // 释放锁
    public synchronized void unlock(Block blk) {
        int val = getLockVal(blk);
        if (val > 1) { // 如果是多个共享锁中的一个，则减少计数
            locks.put(blk, val - 1);
        } else { // 如果是排他锁或唯一的共享锁，则移除锁
            locks.remove(blk);
            notifyAll(); // 通知所有等待此对象（LockTable）的线程
        }
    }

    // 检查块是否持有排他锁
    private boolean hasXlock(Block blk) {
        return getLockVal(blk) < 0; // 负值表示排他锁
    }

    // 检查块是否持有除了当前事务以外的其他共享锁（即共享锁计数大于 1）
    private boolean hasOtherSLocks(Block blk) {
        return getLockVal(blk) > 1; // 大于 1 表示有其他共享锁
    }

    // 检查等待时间是否过长
    private boolean waitingTooLong(long starttime) {
        return System.currentTimeMillis() - starttime > MAX_TIME;
    }

    // 获取块的当前锁值，如果没有锁则返回 0
    private int getLockVal(Block blk) {
        Integer ival = locks.get(blk);
        return (ival == null) ? 0 : ival.intValue();
    }
}
```

**图 5.27 SimpleDB 类 LockTable 的代码**

`unlock` 方法要么从 `locks` 集合中移除指定的锁（如果它是排他锁或只有一个事务持有的共享锁），要么减少仍在共享该锁的事务数量。如果锁从集合中移除，该方法会调用 Java 的 `notifyAll` 方法，这将把所有等待的线程移动到可调度列表。Java 内部的线程调度器以某种未指定顺序恢复每个线程。可能有很多线程正在等待同一个被释放的锁。当线程恢复时，它可能会发现它想要的锁仍然不可用，并将自己再次放置在等待列表中。

这段代码在线程通知管理方面效率不高。`notifyAll` 方法移动所有等待的线程，包括等待其他锁的线程。这些线程在被调度时，会（当然）发现它们的锁仍然不可用，并会将自己放回等待列表。一方面，如果并发运行的冲突数据库线程相对较少，这种策略的开销不会太大。另一方面，一个数据库引擎应该比这更复杂。练习 5.53–5.54 要求您改进等待/通知机制。

#### 5.4.9.2 `ConcurrencyMgr` 类 (The Class ConcurrencyMgr)

`ConcurrencyMgr` 类的代码如 图 5.28 所示。尽管每个事务都有一个并发管理器，但它们都需要使用同一个锁表。

```java
public class ConcurrencyMgr {
    // 静态变量，所有 ConcurrencyMgr 对象共享同一个 LockTable 实例
    private static LockTable locktbl = new LockTable();
    // 当前事务持有的锁的本地记录，键是块，值是锁类型 ("S" 或 "X")
    private Map<Block, String> locks = new HashMap<Block, String>();

    // 请求块的共享锁
    public void sLock(Block blk) {
        // 如果当前事务尚未持有该块的锁
        if (locks.get(blk) == null) {
            locktbl.sLock(blk); // 向全局 LockTable 请求共享锁
            locks.put(blk, "S"); // 记录当前事务持有的共享锁
        }
    }

    // 请求块的排他锁
    public void xLock(Block blk) {
        // 如果当前事务尚未持有该块的排他锁
        if (!hasXLock(blk)) {
            sLock(blk); // 首先获取共享锁（如果尚未持有）
            locktbl.xLock(blk); // 向全局 LockTable 请求排他锁
            locks.put(blk, "X"); // 记录当前事务持有的排他锁
        }
    }

    // 释放当前事务持有的所有锁
    public void release() {
        // 遍历当前事务持有的所有块
        for (Block blk : locks.keySet()) {
            locktbl.unlock(blk); // 调用全局 LockTable 的 unlock 方法释放锁
        }
        locks.clear(); // 清空本地锁记录
    }

    // 检查当前事务是否持有指定块的排他锁
    private boolean hasXLock(Block blk) {
        String locktype = locks.get(blk);
        return locktype != null && locktype.equals("X");
    }
}
```

**图 5.28 SimpleDB 类 ConcurrencyMgr 的代码**

这个要求通过让每个 `ConcurrencyMgr` 对象共享一个**静态 (static)** `LockTable` 变量来实现。事务持有的锁的描述保存在局部变量 `locks` 中。这个变量保存了一个 map，其中包含每个被锁定块的条目。与条目关联的值是 “S” 或 “X”，取决于该块上是共享锁还是排他锁。

`sLock` 方法首先检查事务是否已经持有该块的锁；如果是，则无需访问锁表。否则，它调用锁表的 `sLock` 方法并等待锁的授予。如果事务已经持有该块的排他锁，`xLock` 方法则不需要做任何事情。如果不是，该方法首先获取该块的共享锁，然后获取排他锁。（回想一下，锁表的 `xLock` 方法假定事务已经持有共享锁。）请注意，排他锁比共享锁“更强”，从某种意义上说，一个事务如果在一个块上持有排他锁，则它也隐式地持有该块的共享锁。

### 5.5 实现 SimpleDB 事务 (Implementing SimpleDB Transactions)

第 5.2 节介绍了 `Transaction` 类的 API。现在可以讨论它的实现了。`Transaction` 类使用 `BufferList` 类来管理它已经**固定 (pinned)** 的缓冲区。这两个类将依次讨论。

#### `Transaction` 类 (The Class Transaction)

`Transaction` 类的代码如 图 5.29 所示。每个 `Transaction` 对象都会创建自己的**恢复管理器 (recovery manager)** 和**并发管理器 (concurrency manager)**。它还会创建 `myBuffers` 对象来管理当前固定的缓冲区。

`commit` 和 `rollback` 方法执行以下活动：

- 它们**解除固定 (unpin)** 任何剩余的缓冲区。
- 它们调用恢复管理器来**提交 (commit)**（或**回滚 (roll back)**）事务。
- 它们调用并发管理器来**释放 (release)** 其锁。

`getInt` 和 `getString` 方法首先从并发管理器获取指定块的**共享锁 (slock)**，然后从缓冲区返回请求的值。`setInt` 和 `setString` 方法首先从并发管理器获取**排他锁 (xlock)**，然后调用恢复管理器中相应的方法来创建适当的日志记录并返回其 **LSN (Log Sequence Number)**。这个 LSN 随后可以传递给缓冲区的 `setModified` 方法。

```java
public class Transaction {
    private static int nextTxNum = 0; // 静态变量，用于生成下一个事务ID
    private static final int END_OF_FILE = -1; // 文件末尾的虚拟块号

    private RecoveryMgr recoveryMgr; // 负责事务的恢复（提交、回滚、崩溃恢复）
    private ConcurrencyMgr concurMgr; // 负责事务的并发控制（锁管理）
    private BufferMgr bm;             // 缓冲区管理器
    private FileMgr fm;               // 文件管理器
    private int txnum;                // 当前事务的ID
    private BufferList mybuffers;     // 管理当前事务固定的缓冲区列表
    
    // 构造函数：初始化事务及其关联的管理器
    public Transaction(FileMgr fm, LogMgr lm, BufferMgr bm) {
        this.fm = fm;
        this.bm = bm;
        txnum = nextTxNumber(); // 获取并设置当前事务的唯一ID
        recoveryMgr = new RecoveryMgr(this, txnum, lm, bm); // 创建恢复管理器
        concurMgr = new ConcurrencyMgr(); // 创建并发管理器
        mybuffers = new BufferList(bm); // 创建缓冲区列表管理器
    }
    
    // 提交事务：执行提交操作的顺序（恢复 -> 并发 -> 缓冲区）
    public void commit() {
        recoveryMgr.commit();      // 调用恢复管理器提交事务
        concurMgr.release();       // 释放所有事务持有的锁
        mybuffers.unpinAll();      // 解除固定所有事务固定的缓冲区
        System.out.println("transaction " + txnum + " committed"); // 打印提交信息
    }
    
    // 回滚事务：执行回滚操作的顺序（恢复 -> 并发 -> 缓冲区）
    public void rollback() {
        recoveryMgr.rollback();    // 调用恢复管理器回滚事务
        concurMgr.release();       // 释放所有事务持有的锁
        mybuffers.unpinAll();      // 解除固定所有事务固定的缓冲区
        System.out.println("transaction " + txnum + " rolled back"); // 打印回滚信息
    }
    
    // 数据库恢复（通常由系统启动时调用，不直接由应用事务调用）
    public void recover() {
        bm.flushAll(txnum);      // 刷新所有属于此事务的缓冲区到磁盘
        recoveryMgr.recover();   // 调用恢复管理器执行崩溃恢复
    }
    
    // 固定一个块到缓冲区
    public void pin(BlockId blk) {
        mybuffers.pin(blk);
    }
    
    // 解除固定一个块
    public void unpin(BlockId blk) {
        mybuffers.unpin(blk);
    }
    
    // 获取块中指定偏移量的整数值
    public int getInt(BlockId blk, int offset) {
        concurMgr.sLock(blk); // 获取块的共享锁
        Buffer buff = mybuffers.getBuffer(blk); // 获取缓冲区
        return buff.contents().getInt(offset); // 从页面内容获取整数值
    }
    
    // 获取块中指定偏移量的字符串值
    public String getString(BlockId blk, int offset) {
        concurMgr.sLock(blk); // 获取块的共享锁
        Buffer buff = mybuffers.getBuffer(blk); // 获取缓冲区
        return buff.contents().getString(offset); // 从页面内容获取字符串值
    }
    
    // 设置块中指定偏移量的整数值
    public void setInt(BlockId blk, int offset, int val, boolean okToLog) {
        concurMgr.xLock(blk); // 获取块的排他锁
        Buffer buff = mybuffers.getBuffer(blk); // 获取缓冲区
        int lsn = -1;
        if (okToLog)
            lsn = recoveryMgr.setInt(buff, offset, val); // 如果需要日志，则记录SetInt操作并获取LSN
        Page p = buff.contents(); // 获取页面内容
        p.setInt(offset, val); // 在页面上设置整数值
        buff.setModified(txnum, lsn); // 标记缓冲区为已修改，并关联事务ID和LSN
    }
    
    // 设置块中指定偏移量的字符串值
    public void setString(BlockId blk, int offset, String val, boolean okToLog) {
        concurMgr.xLock(blk); // 获取块的排他锁
        Buffer buff = mybuffers.getBuffer(blk); // 获取缓冲区
        int lsn = -1;
        if (okToLog)
            lsn = recoveryMgr.setString(buff, offset, val); // 如果需要日志，则记录SetString操作并获取LSN
        Page p = buff.contents(); // 获取页面内容
        p.setString(offset, val); // 在页面上设置字符串值
        buff.setModified(txnum, lsn); // 标记缓冲区为已修改，并关联事务ID和LSN
    }
    
    // 获取文件大小
    public int size(String filename) {
        // 将文件末尾标记视为一个虚拟块，并获取其共享锁以防止幻影读
        BlockId dummyblk = new BlockId(filename, END_OF_FILE);
        concurMgr.sLock(dummyblk);
        return fm.length(filename); // 通过文件管理器获取文件长度
    }
    
    // 向文件追加新块
    public BlockId append(String filename) {
        // 将文件末尾标记视为一个虚拟块，并获取其排他锁以防止幻影写
        BlockId dummyblk = new BlockId(filename, END_OF_FILE);
        concurMgr.xLock(dummyblk);
        return fm.append(filename); // 通过文件管理器追加块
    }
    
    // 获取文件系统中的块大小
    public int blockSize() {
        return fm.blockSize();
    }
    
    // 获取缓冲区管理器中可用的缓冲区数量
    public int availableBuffs() {
        return bm.available();
    }
    
    // 静态同步方法，用于生成下一个唯一的事务ID
    private static synchronized int nextTxNumber() {
        nextTxNum++; // 递增事务计数器
        System.out.println("new transaction: " + nextTxNum); // 打印新事务ID
        return nextTxNum;
    }
}
```

**图 5.29 `Transaction` 类的代码**

`size` 和 `append` 方法将**文件末尾标记 (end-of-file marker)** 视为一个块号为 -1 的“虚拟”块。`size` 方法获取该块的 `slock`，而 `append` 获取该块的 `xlock`。

#### `BufferList` 类 (The Class BufferList)

`BufferList` 类管理事务当前固定的缓冲区列表；参见 图 5.30。`BufferList` 对象需要知道两件事：哪个缓冲区被分配给指定的块，以及每个块被固定了多少次。代码使用 `Map` 来确定缓冲区，并使用 `List` 来确定固定计数。列表包含与块被固定的次数相同数量的 `BlockId` 对象；每次块被解除固定时，就会从列表中删除一个实例。

`unpinAll` 方法执行事务提交或回滚时所需的与缓冲区相关的活动——它让缓冲区管理器刷新事务修改过的所有缓冲区，并解除固定任何仍在固定的缓冲区。

```java
class BufferList {
    private Map<BlockId, Buffer> buffers = new HashMap<>(); // 映射：BlockId -> Buffer，存储已固定的缓冲区
    private List<BlockId> pins = new ArrayList<>();        // 列表：BlockId，记录每个块被固定的次数

    private BufferMgr bm; // 缓冲区管理器实例
    
    // 构造函数：初始化 BufferList 并传入 BufferMgr
    public BufferList(BufferMgr bm) {
        this.bm = bm;
    }
    
    // 获取指定块对应的缓冲区
    Buffer getBuffer(BlockId blk) {
        return buffers.get(blk);
    }
    
    // 固定一个块：通过 BufferMgr 固定，并记录在本地映射和列表中
    void pin(BlockId blk) {
        Buffer buff = bm.pin(blk); // 调用 BufferMgr 固定块
        buffers.put(blk, buff);    // 存储块与缓冲区的映射
        pins.add(blk);             // 将块添加到固定列表，表示其被固定了一次
    }
    
    // 解除固定一个块：从本地列表移除一次固定计数，如果不再被固定则解除 BufferMgr 中的固定
    void unpin(BlockId blk) {
        Buffer buff = buffers.get(blk); // 获取对应的缓冲区
        bm.unpin(buff);                 // 调用 BufferMgr 解除固定
        pins.remove(blk);               // 从固定列表中移除一个实例
        // 如果该块在 pins 列表中不再存在，说明此事务已完全解除对它的固定，可以从 buffers 映射中移除
        if (!pins.contains(blk))
            buffers.remove(blk);
    }
    
    // 解除固定所有缓冲区：遍历所有固定的缓冲区并解除固定，然后清空本地记录
    void unpinAll() {
        // 注意：这里的原始实现存在一个逻辑缺陷，对于重复pin的块，bm.unpin会被多次调用，
        // 而bm.unpin通常期望只被调用一次对应一次pin。
        // 一个更健善的实现应该先统计每个块的unpin次数，或者只对 distinct 的 blk 调用 bm.unpin 一次。
        // 然而，为了忠实于原文，我们保持其原有逻辑。
        for (BlockId blk : pins) { // 遍历所有固定记录（包含重复）
            Buffer buff = buffers.get(blk); // 获取对应缓冲区
            bm.unpin(buff); // 调用 BufferMgr 解除固定
        }
        buffers.clear(); // 清空块-缓冲区映射
        pins.clear();    // 清空固定列表
    }
}
```

**图 5.30 `BufferList` 类的代码**
