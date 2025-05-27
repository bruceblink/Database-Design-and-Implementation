---
typora-root-url: ./..\..\public
---

# 第 4 章 内存管理 (Chapter 4 Memory Management)

本章将研究数据库引擎的两个组件：**日志管理器 (log manager)** 和**缓冲区管理器 (buffer manager)**。每个组件都负责特定的文件：日志管理器负责日志文件，缓冲区管理器负责数据文件。

这两个组件都面临着如何高效管理磁盘块与主内存之间读写的问题。数据库内容通常远大于主内存，因此这些组件可能需要将块在内存中**移入移出 (shuttle blocks in and out of memory)**。本章将检查它们的内存需求以及它们使用的内存管理算法。日志管理器仅支持对日志文件的**顺序访问 (sequential access)**，并采用一个简单、最优的内存管理算法。另一方面，缓冲区管理器必须支持对用户文件的**任意访问 (arbitrary access)**，这是一个更困难的挑战。

## 4.1 数据库内存管理的两个原则 (Two Principles of Database Memory Management)

回想一下，数据库引擎读取磁盘值的唯一方法是将其所在的块读入内存中的一个页面，而写入磁盘值的唯一方法是将修改后的页面写回其块。数据库引擎在磁盘和内存之间移动数据时遵循两个重要原则：**最小化磁盘访问**，以及**不依赖虚拟内存**。

### 原则 1: 最小化磁盘访问 (Principle 1: Minimize Disk Accesses)

考虑一个应用程序，它从磁盘读取数据，搜索数据，执行各种计算，进行一些更改，然后将数据写回。您如何估计这需要多长时间？回想一下，RAM 操作比闪存快 1000 多倍，比磁盘快 100,000 倍。这意味着在大多数实际情况中，从磁盘读/写块所需的时间**至少**与在 RAM 中处理块所需的时间一样长。因此，数据库引擎可以做的最重要的事情就是**最小化块访问**。

最小化块访问的一种方法是**避免多次访问同一个磁盘块**。这种问题在计算的许多领域都会出现，并且有一个标准解决方案，称为**缓存 (caching)**。例如，CPU 有一个本地硬件缓存，用于存储以前执行的指令；如果下一条指令在缓存中，CPU 就无需从 RAM 加载它。另一个例子是，浏览器会保留以前访问过的网页的缓存；如果用户请求一个恰好在缓存中的页面（例如，通过点击浏览器的“后退”按钮），浏览器就可以避免从网络检索它。

数据库引擎使用**内存页**来缓存磁盘块。通过跟踪哪些页面包含哪些块的内容，引擎可能能够通过使用现有页面来满足客户端请求，从而避免磁盘读取。同样，引擎只在必要时将页面写入磁盘，希望通过一次磁盘写入完成对页面的多次更改。

最小化磁盘访问的需求非常重要，它渗透到数据库引擎的整个实现中。例如，引擎使用的检索算法之所以被选择，正是因为它们节俭地访问磁盘。当一个 SQL 查询有几种可能的检索策略时，查询规划器会选择它认为需要最少磁盘访问次数的策略。

### 原则 2: 不依赖虚拟内存 (Principle 2: Don’t Rely on Virtual Memory)

现代操作系统支持**虚拟内存 (virtual memory)**。操作系统给每个进程一个错觉，认为它拥有大量内存来存储其代码和数据。进程可以在其虚拟内存空间中任意分配对象；操作系统将每个虚拟页面映射到物理内存中的一个实际页面。操作系统支持的虚拟内存空间通常远大于计算机的物理内存。由于并非所有虚拟页面都能放入物理内存，因此操作系统必须将其中一些存储在磁盘上。当进程访问不在内存中的虚拟页面时，就会发生**页面交换 (page swap)**。操作系统选择一个物理页面，将该页面的内容写入磁盘（如果它已被修改），然后将虚拟页面的保存内容从磁盘读取到该页面。

数据库引擎管理磁盘块最直接的方法是为每个块分配自己的虚拟页面。例如，它可以为每个文件保留一个页面数组，每个文件的每个块都有一个槽位。这些数组会很大，但它们会适应虚拟内存。当数据库系统访问这些页面时，虚拟内存机制会根据需要将它们在磁盘和物理内存之间交换。这是一种简单、易于实现的策略。不幸的是，它有一个严重的问题，那就是**操作系统而非数据库引擎控制页面何时写入磁盘**。由此产生了两个问题。

第一个问题是，操作系统的页面交换策略会**损害数据库引擎在系统崩溃后恢复的能力**。原因（正如您将在第 5 章中看到的那样）是修改过的页面会有一些相关的日志记录，这些日志记录必须在页面之前写入磁盘。（否则，日志记录将无法用于帮助数据库在系统崩溃后恢复。）由于操作系统不知道日志，它可能会在不写入其日志记录的情况下交换出修改过的页面，从而破坏恢复机制。

第二个问题是，操作系统**不知道哪些页面当前正在使用，哪些页面数据库引擎不再关心**。操作系统可以做出有根据的猜测，例如选择交换最近最少访问的页面。但是，如果操作系统猜测不正确，它将交换出再次需要的页面，导致两次不必要的磁盘访问。另一方面，数据库引擎对需要哪些页面有更好的了解，可以做出更明智的猜测。

因此，数据库引擎必须**管理自己的页面**。它通过分配相对少量的、它知道能够放入物理内存的页面来做到这一点；这些页面被称为数据库的**缓冲区池 (buffer pool)**。引擎会跟踪哪些页面可用于交换。当一个块需要读入一个页面时，数据库引擎（而不是操作系统）从缓冲区池中选择一个可用页面，如果需要，将其内容（及其日志记录）写入磁盘，然后才读入指定的块。

## 4.2 日志信息管理 (Managing Log Information)

每当用户更改数据库时，数据库引擎都必须**跟踪该更改**，以备需要撤销。描述更改的值保存在**日志记录 (log record)** 中，日志记录存储在**日志文件 (log file)** 中。新的日志记录会**追加到日志的末尾**。

**日志管理器 (log manager)** 是数据库引擎中负责将日志记录写入日志文件的组件。日志管理器不理解日志记录的内容——这项职责属于第 5 章的恢复管理器。相反，日志管理器将日志视为一个不断增长的日志记录序列。

本节将研究日志管理器在将日志记录写入日志文件时如何管理内存。考虑图 4.1 所示的算法，这是将记录追加到日志的最直接方法。

```txt
1. 分配一个内存页面。
2. 将日志文件的最后一个块读入该页面。
3a. 如果有空间，将日志记录放在页面上其他记录之后，并将页面写回磁盘。
3b. 如果没有空间，则分配一个新的空页面，将日志记录放入该页面，
    并将该页面追加到日志文件末尾的新块中。
```

**图 4.1 将新记录追加到日志的简单（但低效）算法**

此算法要求每个追加的日志记录进行一次磁盘读取和一次磁盘写入。它简单但效率非常低。图 4.2 说明了日志管理器在算法的第 3a 步进行到一半时的操作。日志文件包含三个块，这些块包含八条记录，标记为 r1 到 r8。日志记录的大小可能不同，这就是为什么块 0 中可以容纳四条记录，而块 1 中只能容纳三条记录的原因。块 2 尚未满，只包含一条记录。内存页面包含块 2 的内容。除了记录 r8，一条新的日志记录（记录 r9）刚刚被放入页面中。

现在假设日志管理器通过将页面写回文件的块 2 来完成算法。当日志管理器最终被要求向文件添加另一条日志记录时，它将执行算法的第 1 步和第 2 步，并将块 2 读入一个页面。但请注意，此磁盘读取是完全不必要的，因为现有的日志页面已经包含块 2 的内容！因此，算法的第 1 步和第 2 步是不必要的。**日志管理器只需要永久分配一个页面来包含最后一个日志块的内容。** 结果是，所有的磁盘读取都被消除了。

![fig4-2](/images/chapter4/fig4-2.png)

减少磁盘写入也是可能的。在上述算法中，日志管理器每次向页面添加新记录时，都会将其页面写入磁盘。查看图 4.2，您可以看到无需立即将记录 r9 写入磁盘。只要页面有空间，每个新日志记录都可以简单地添加到页面中。当页面变满时，日志管理器可以将页面写入磁盘，清除其内容，然后重新开始。这种新算法将导致每个日志块恰好一次磁盘写入，这显然是最佳的。

此算法有一个小问题：由于日志管理器无法控制的情况，日志页面可能需要在其变满之前写入磁盘。问题在于，**缓冲区管理器不能将修改过的数据页面写入磁盘，除非该页面关联的日志记录也已写入磁盘。** 如果这些日志记录中的任何一个恰好在日志页面中但尚未在磁盘上，则日志管理器必须将其页面写入磁盘，无论页面是否已满。这个问题将在第 5 章中解决。

图 4.3 给出了最终的日志管理算法。此算法在两个地方将内存页面写入磁盘：当需要强制将日志记录写入磁盘时，以及当页面已满时。因此，一个内存页面可能会被写入同一个日志块多次。但由于这些磁盘写入是绝对必要的且无法避免的，您可以得出结论，该算法是最佳的。

```txt
1. 永久分配一个内存页面来保存日志文件的最后一个块的内容。称此页面为 P。
2. 当提交新的日志记录时：
   a) 如果 P 中没有空间，则：
      将 P 写入磁盘并清除其内容。
   b) 将新日志记录追加到 P 中。
3. 当数据库系统请求将特定日志记录写入磁盘时：
   a) 确定该日志记录是否在 P 中。
   b) 如果是，则将 P 写入磁盘。
```

**图 4.3 最佳日志管理算法**

## 4.3 SimpleDB 日志管理器 (The SimpleDB Log Manager)

本节将探讨 SimpleDB 数据库系统的日志管理器。第 4.3.1 节将演示日志管理器的使用。第 4.3.2 节将分析其实现。

### 4.3.1 日志管理器的 API (The API for the Log Manager)

SimpleDB 日志管理器的实现位于 `simpledb.log` 包中。此包公开了 `LogMgr` 类，其 API 如 图 4.4 所示。

```java
public class LogMgr {
    // 构造函数：初始化 LogMgr 对象
    public LogMgr(FileMgr fm, String logfile);

    // 将记录追加到日志并返回其 LSN
    public int append(byte[] rec);

    // 确保指定的 LSN 及之前的记录已写入磁盘
    public void flush(int lsn);

    // 返回一个迭代器，用于反向读取日志记录
    public Iterator<byte[]> iterator();
}
```

**图 4.4 SimpleDB 日志管理器的 API**

数据库引擎有一个 `LogMgr` 对象，它在系统启动时创建。构造函数的参数是对文件管理器的引用和日志文件的名称。

`append` 方法将记录添加到日志并返回一个整数。就日志管理器而言，日志记录是一个任意大小的字节数组；它将数组保存在日志文件中，但不知道其内容表示什么。唯一的限制是数组必须适合一个页面。`append` 的返回值标识新的日志记录；此标识符称为其**日志序列号 (log sequence number，或 LSN)**。

将记录追加到日志并不保证记录会写入磁盘；相反，日志管理器会选择何时将日志记录写入磁盘，如 图 4.3 的算法所示。客户端可以通过调用 `flush` 方法将特定日志记录强制写入磁盘。`flush` 的参数是日志记录的 LSN；该方法确保此日志记录（以及所有先前的日志记录）已写入磁盘。

客户端调用 `iterator` 方法来读取日志中的记录；此方法返回日志记录的 Java 迭代器。每次调用迭代器的 `next` 方法都将返回一个表示日志中下一条记录的字节数组。迭代器方法返回的记录是**逆序**的，从最新的记录开始，然后向后遍历日志文件。记录以这种顺序返回是因为恢复管理器希望以这种方式查看它们。

图 4.5 中的 `LogTest` 类提供了一个如何使用日志管理器 API 的示例。该代码创建了 70 条日志记录，每条记录包含一个字符串和一个整数。整数是记录号 N，字符串是值“recordN”。代码在创建前 35 条记录后打印一次记录，然后在创建所有 70 条记录后再打印一次。

```java
public class LogTest {
    private static LogMgr lm;

    public static void main(String[] args) {
        SimpleDB db = new SimpleDB("logtest", 400, 8); // 初始化 SimpleDB 实例
        lm = db.logMgr(); // 获取日志管理器实例

        createRecords(1, 35); // 创建 1 到 35 号记录
        printLogRecords("日志文件现在有这些记录:"); // 打印当前日志记录

        createRecords(36, 70); // 创建 36 到 70 号记录
        lm.flush(65); // 强制 LSN 为 65 的记录及其之前的记录写入磁盘
        printLogRecords("日志文件现在有这些记录:"); // 再次打印日志记录
    }

    private static void printLogRecords(String msg) {
        System.out.println(msg);
        Iterator<byte[]> iter = lm.iterator(); // 获取日志迭代器
        while (iter.hasNext()) {
            byte[] rec = iter.next(); // 获取下一条日志记录（字节数组）
            Page p = new Page(rec); // 将字节数组包装成 Page 对象
            String s = p.getString(0); // 从 Page 中读取字符串
            int npos = Page.maxLength(s.length()); // 计算整数的位置
            int val = p.getInt(npos); // 从 Page 中读取整数
            System.out.println("[" + s + ", " + val + "]"); // 打印记录内容
        }
        System.out.println();
    }

    private static void createRecords(int start, int end) {
        System.out.print("正在创建记录: ");
        for (int i = start; i <= end; i++) {
            byte[] rec = createLogRecord("record" + i, i + 100); // 创建日志记录的字节数组
            int lsn = lm.append(rec); // 将记录追加到日志
            System.out.print(lsn + " "); // 打印返回的 LSN
        }
        System.out.println();
    }

    // 辅助方法：根据字符串和整数创建日志记录的字节数组
    private static byte[] createLogRecord(String s, int n) {
        int npos = Page.maxLength(s.length()); // 计算整数存储位置
        byte[] b = new byte[npos + Integer.BYTES]; // 创建足够大的字节数组
        Page p = new Page(b); // 包装成 Page
        p.setString(0, s); // 写入字符串
        p.setInt(npos, n); // 写入整数
        return b;
    }
}
```

**图 4.5 测试日志管理器**

如果您运行代码，您会发现第一次调用 `printLogRecords` 后只打印了 20 条记录。原因是这些记录填满了第一个日志块，并在创建第 21 条日志记录时被刷新到磁盘。其他 15 条日志记录保留在内存中的日志页面中，没有被刷新。第二次调用 `createRecords` 创建了记录 36 到 70。调用 `flush` 会告诉日志管理器确保记录 65 在磁盘上。但由于记录 66-70 与记录 65 位于同一页面中，它们也写入了磁盘。因此，第二次调用 `printLogRecords` 将逆序打印所有 70 条记录。

请注意 `createLogRecord` 方法如何分配一个字节数组作为日志记录。它创建了一个 `Page` 对象来包装该数组，以便它可以使用页面的 `setInt` 和 `setString` 方法将字符串和整数放置在日志记录中适当的偏移量处。然后代码返回字节数组。类似地，`printLogRecords` 方法创建一个 `Page` 对象来包装日志记录，以便它可以从记录中提取字符串和整数。

### 4.3.2 实现日志管理器 (Implementing the Log Manager)

`LogMgr` 的代码如 图 4.6 所示。其构造函数使用提供的字符串作为日志文件的名称。如果日志文件为空，构造函数会向其追加一个新的空块。构造函数还会分配一个单独的页面（称为 `logpage`），并将其初始化为包含文件中最后一个日志块的内容。

Java

```java
public class LogMgr {
    private FileMgr fm; // 文件管理器实例
    private String logfile; // 日志文件名称
    private Page logpage; // 内存中的日志页面
    private BlockId currentblk; // 当前日志块的 ID
    private int latestLSN = 0; // 最新分配的 LSN
    private int lastSavedLSN = 0; // 最后保存到磁盘的 LSN

    public LogMgr(FileMgr fm, String logfile) {
        this.fm = fm;
        this.logfile = logfile;
        byte[] b = new byte[fm.blockSize()]; // 创建一个字节数组，大小为文件管理器定义的块大小
        logpage = new Page(b); // 将字节数组包装成 Page 对象
        int logsize = fm.length(logfile); // 获取日志文件大小
        if (logsize == 0) // 如果日志文件为空
            currentblk = appendNewBlock(); // 追加一个新的空块
        else {
            currentblk = new BlockId(logfile, logsize - 1); // 设置当前块为日志文件最后一个块
            fm.read(currentblk, logpage); // 将最后一个日志块的内容读入 logpage
        }
    }

    // 刷新日志到指定 LSN
    public void flush(int lsn) {
        if (lsn >= lastSavedLSN) // 如果请求的 LSN 大于或等于最后保存的 LSN
            flush(); // 执行实际的刷新操作
    }

    // 获取日志记录迭代器
    public Iterator<byte[]> iterator() {
        flush(); // 在创建迭代器前确保所有日志记录已写入磁盘
        return new LogIterator(fm, currentblk); // 返回新的 LogIterator
    }

    // 将日志记录追加到日志
    public synchronized int append(byte[] logrec) {
        int boundary = logpage.getInt(0); // 获取当前页面的边界（已写入记录的起始偏移量）
        int recsize = logrec.length; // 新记录的大小
        int bytesneeded = recsize + Integer.BYTES; // 新记录所需的字节数（包括长度前缀）

        if (boundary - bytesneeded < Integer.BYTES) { // 如果新记录不适合当前页面
            flush(); // 将当前页面内容写入磁盘
            currentblk = appendNewBlock(); // 追加一个新块，并将其内容读入 logpage
            boundary = logpage.getInt(0); // 更新边界
        }

        int recpos = boundary - bytesneeded; // 计算新记录的起始位置
        logpage.setBytes(recpos, logrec); // 将新记录写入页面
        logpage.setInt(0, recpos); // 更新页面头部的边界
        latestLSN += 1; // 增加最新 LSN
        return latestLSN; // 返回新记录的 LSN
    }

    // 追加一个新块到日志文件
    private BlockId appendNewBlock() {
        BlockId blk = fm.append(logfile); // 在日志文件末尾追加一个新块
        logpage.setInt(0, fm.blockSize()); // 将页面边界设置为块大小（表示整个页面为空）
        fm.write(blk, logpage); // 将（空的）页面写入新块
        return blk;
    }

    // 执行实际的刷新操作，将 logpage 内容写入磁盘
    private void flush() {
        fm.write(currentblk, logpage); // 将 logpage 内容写入当前块
        lastSavedLSN = latestLSN; // 更新最后保存到磁盘的 LSN
    }
}
```

**图 4.6 SimpleDB 类 LogMgr 的代码**

回想一下，**日志序列号 (LSN)** 标识一个日志记录。`append` 方法使用变量 `latestLSN` 从 1 开始顺序分配 LSN。日志管理器跟踪下一个可用的 LSN 和最近写入磁盘的日志记录的 LSN。`flush` 方法将最新 LSN 与指定 LSN 进行比较。如果指定 LSN 较小，则所需的日志记录肯定已经写入磁盘；否则，`logpage` 被写入磁盘，并且 `latestLSN` 成为最近写入的 LSN。

`append` 方法计算日志记录的大小以确定它是否适合当前页面。如果不适合，它将当前页面写入磁盘并调用 `appendNewBlock` 以清除页面并将现在空的页面追加到日志文件。此策略与图 4.3 的算法略有不同；即，日志管理器通过向其追加一个空页面来扩展日志文件，而不是通过追加一个已满的页面来扩展文件。此策略实现起来更简单，因为它允许 `flush` 假定该块已经存在于磁盘上。

请注意，`append` 方法将日志记录从右到左放置在页面中。变量 `boundary` 包含最近添加的记录的偏移量。此策略使日志迭代器能够通过从左到右读取来逆序读取记录。`boundary` 值写入页面的前四个字节，以便迭代器知道记录从何处开始。

`iterator` 方法刷新日志（以确保整个日志都在磁盘上），然后返回一个 `LogIterator` 对象。`LogIterator` 类是一个包私有类，它实现了迭代器；其代码如 图 4.7 所示。`LogIterator` 对象分配一个页面来保存日志块的内容。构造函数将迭代器定位到日志中最后一个块的第一条记录（请记住，这是最后一条日志记录写入的位置）。`next` 方法移动到页面中的下一条记录；当没有更多记录时，它会读取前一个块

Java

```java
class LogIterator implements Iterator<byte[]> {
    private FileMgr fm; // 文件管理器实例
    private BlockId blk; // 当前日志块的 ID
    private Page p; // 内存中的页面，用于读取日志块
    private int currentpos; // 当前在页面中读取的位置
    private int boundary; // 当前页面中已写入记录的起始偏移量

    public LogIterator(FileMgr fm, BlockId blk) {
        this.fm = fm;
        this.blk = blk;
        byte[] b = new byte[fm.blockSize()]; // 创建一个字节数组，大小为文件管理器定义的块大小
        p = new Page(b); // 将字节数组包装成 Page 对象
        moveToBlock(blk); // 移动到指定的日志块并读取其内容
    }

    // 检查是否还有更多日志记录可供读取
    public boolean hasNext() {
        // 如果当前位置小于块大小（页面中还有未读取的数据）或者当前块号大于 0（前面还有块）
        return currentpos < fm.blockSize() || blk.number() > 0;
    }

    // 获取下一条日志记录
    public byte[] next() {
        if (currentpos == fm.blockSize()) { // 如果当前页面已读完
            blk = new BlockId(blk.fileName(), blk.number() - 1); // 移动到前一个块
            moveToBlock(blk); // 读取前一个块的内容
        }
        byte[] rec = p.getBytes(currentpos); // 从当前位置读取字节数组（日志记录）
        currentpos += Integer.BYTES + rec.length; // 更新当前位置，跳过已读记录的长度和其自身内容
        return rec; // 返回日志记录
    }

    // 移动到指定块并读取其内容
    private void moveToBlock(BlockId blk) {
        fm.read(blk, p); // 将指定块的内容读入页面 p
        boundary = p.getInt(0); // 获取页面头部的边界（日志记录的起始位置）
        currentpos = boundary; // 将当前读取位置设置为边界
    }
}
```

**图 4.7 SimpleDB 类 LogIterator 的代码**

进入页面并返回其第一条记录。`hasNext` 方法在页面中没有更多记录且没有更多前一个块时返回 `false`。
