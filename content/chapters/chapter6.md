---
typora-root-url: ./..\..\public
---

# 第 6 章 记录管理 (Record Management)

事务管理器能够在磁盘块上的指定位置读写值。然而，它并不知道块中有哪些值，也不知道这些值可能位于何处。这个责任属于**记录管理器 (record manager)**。它将文件组织成记录集合，并提供了遍历记录和在其中放置值的方法。本章研究记录管理器提供的功能以及实现该功能所使用的技术。

## 6.1 设计记录管理器 (Designing a Record Manager)

记录管理器必须解决几个问题，例如：

- 每条记录是否应完全放置在一个块内？
- 块中的所有记录是否都来自同一张表？
- 每个字段是否可以使用预定数量的字节表示？
- 每个字段值应该在记录中的哪个位置？

本节讨论这些问题及其权衡。

### 6.1.1 跨块记录与非跨块记录 (Spanned Versus Unspanned Records)

假设记录管理器需要将四个 300 字节的记录插入到一个文件中，其中块大小为 1000 字节。三个记录可以很好地放入块的前 900 字节。但是记录管理器应该如何处理第四个记录呢？图 6.1 展示了两种选择。

![fig6-1](/images/chapter6/fig6-1.png)

 **图 6.1 跨块记录与非跨块记录. (a) R4 记录跨越块 0 和块 1, (b)R4 记录完全存储在块 1 中**

在图 6.1a 中，记录管理器创建一个**跨块记录 (spanned record)**，即其值跨越两个或更多块的记录。它将记录的前 100 字节存储在现有块中，将记录的后 200 字节存储在新块中。在图 6.1b 中，记录管理器将整个第四个记录存储在一个新块中。

记录管理器必须决定是否创建跨块记录。**非跨块记录 (unspanned records)** 的缺点是它们浪费磁盘空间。在图 6.1b 中，每个块浪费了 100 字节（或 10%）。更糟糕的情况是，如果每个记录包含 501 字节——那么一个块只能包含 1 条记录，并且近 50% 的空间将被浪费。另一个缺点是，非跨块记录的大小受限于块大小。如果记录可以大于一个块，那么跨块是必要的。

跨块记录的主要缺点是它们增加了**记录访问的复杂性 (complexity of record access)**。因为跨块记录分布在多个块中，所以读取它需要多次块访问。此外，跨块记录可能需要通过将其读入内存的单独区域来从这些块中重建。

### 6.1.2 同构文件与非同构文件 (Homogeneous Versus Nonhomogeneous Files)

如果文件中的所有记录都来自同一张表，则该文件是**同构的 (homogeneous)**。记录管理器必须决定是否允许**非同构文件 (nonhomogeneous files)**。权衡再次是**效率 (efficiency)** 与**灵活性 (flexibility)**。

例如，考虑 图 1.1 中的 `STUDENT` 和 `DEPT` 表。同构实现会将所有 `STUDENT` 记录放在一个文件中，所有 `DEPT` 记录放在另一个文件中。这种放置使得**单表 SQL 查询 (single-table SQL queries)** 易于回答——记录管理器只需扫描一个文件的块。然而，**多表查询 (multi-table queries)** 的效率会降低。考虑一个连接这两个表的查询，例如“查找学生姓名及其主修系”。记录管理器必须在 `STUDENT` 记录的块和 `DEPT` 记录的块之间来回搜索（如第 8 章将讨论），寻找匹配的记录。即使查询可以在没有过多搜索的情况下执行（例如，通过第 12 章的**索引连接 (index join)**），磁盘驱动器仍然必须在读取 `STUDENT` 和 `DEPT` 块之间交替时重复寻道。

**非同构组织 (nonhomogeneous organization)** 会将 `STUDENT` 和 `DEPT` 记录存储在同一个文件中，每个学生的记录存储在其主修系记录的附近。图 6.2 描绘了这种组织的前两个块，假设每个块有三条记录。文件由一条 `DEPT` 记录组成，后面跟着以该系为主修的 `STUDENT` 记录。这种组织需要更少的块访问来计算连接，因为连接的记录**聚簇 (clustered)** 在同一个（或附近的）块中。

![fig6-2](/images/chapter6/fig6-2.png)

 **图 6.2 聚簇、非同构记录**

**聚簇 (Clustering)** 提高了连接聚簇表的查询效率，因为匹配的记录存储在一起。然而，聚簇会导致单表查询效率降低，因为每张表的记录分布在更多的块中。同样，与其他表的连接效率也会降低。因此，聚簇仅在最常用的查询执行由聚簇编码的连接时才有效。

### 6.1.3 定长字段与变长字段 (Fixed-Length Versus Variable-Length Fields)

表中的每个字段都有一个定义好的类型。基于该类型，记录管理器决定是使用**定长 (fixed-length)** 还是**变长 (variable-length)** 表示来实现字段。定长表示使用完全相同的字节数来存储字段的每个值，而变长表示则根据存储的数据值进行扩展和收缩。

大多数类型自然是定长的。例如，整数和浮点数都可以存储为 4 字节的二进制值。事实上，所有数字和日期/时间类型都具有自然的定长表示。Java 类型 `String` 是需要变长表示的典型示例，因为字符串可以任意长。

变长表示会带来显著的复杂性。例如，考虑一个位于块中间且充满记录的记录，并假设您修改了其一个字段值。如果字段是定长的，那么记录的大小将保持不变，并且可以在原地修改字段。但是，如果字段是变长的，那么记录可能会变大。为了给更大的记录腾出空间，记录管理器可能必须**重新排列 (rearrange)** 块中记录的位置。事实上，如果修改后的记录变得太大，那么一个或多个记录可能需要移出该块并放置在不同的块中。因此，记录管理器会尽力在可能的情况下使用定长表示。例如，记录管理器可以从字符串字段的三种不同表示中选择：

- **变长表示 (A variable-length representation)**：记录管理器在记录中为字符串分配所需的精确空间量。
- **定长表示 (A fixed-length representation)**：记录管理器将字符串存储在记录外部的位置，并在记录中保留对该位置的定长引用。
- **定长表示 (A fixed-length representation)**：记录管理器在记录中为每个字符串分配相同数量的空间，无论其长度如何。

![fig6-3](/images/chapter6/fig6-3.png)

**图 6.3 `COURSE` 记录中 `Title` 字段的不同表示方法, (a) 为每个字符串分配刚好所需的空间,(b)将字符串存储在单独的位置,(c) 为每个字符串分配相同数量的空间**

这些表示如 图 6.3 所示。图 (a) 显示了三个 `COURSE` 记录，其中 `Title` 字段使用变长表示实现。这些记录空间效率高，但存在刚刚讨论的问题。

图 (b) 显示了相同的三个记录，但 `Title` 字符串放置在单独的“字符串区域”中。该区域可以是单独的文件，或者（如果字符串非常大）一个目录，其中每个字符串都存储在自己的文件中。在任何一种情况下，字段都包含对字符串在该区域中位置的引用。这种表示使记录既**定长 (fixed-length)** 又**小巧 (small)**。小记录是好的，因为它们可以存储在更少的块中，因此需要更少的块访问。这种表示的缺点是，从记录中检索字符串值需要额外的块访问。

图 (c) 显示了其中两个记录，使用定长 `Title` 字段实现。这种实现的优点是记录是定长的，并且字符串存储在记录中。然而，缺点是一些记录会比它们需要的更大。如果字符串大小差异很大，那么这种浪费的空间将是显著的，导致文件更大，从而需要更多的块访问。

这些表示方式没有一个明显优于其他。为了帮助记录管理器选择合适的表示方式，标准 SQL 提供了三种不同的字符串数据类型：`char`、`varchar` 和 `clob`。`char(n)` 类型指定恰好 `n` 个字符的字符串。`varchar(n)` 和 `clob(n)` 类型指定最多 `n` 个字符的字符串。它们的区别在于 `n` 的预期大小。在 `varchar(n)` 中，`n` 相对较小，例如不超过 4K。另一方面，`clob(n)` 中 `n` 的值可以达到千兆字符范围。（`CLOB` 是“字符大对象”的缩写。）举一个 `clob` 字段的例子，假设大学数据库在其 `SECTION` 表中添加了一个 `Syllabus` 字段，其值将包含每个课程大纲的文本。假设大纲最多可包含 8000 个字符，您可以合理地将该字段定义为 `clob(8000)`。

`char` 类型的字段最自然地对应于图 6.3c。由于所有字符串都将具有相同的长度，因此记录内部没有浪费空间，并且定长表示将是最有效的。

`varchar(n)` 类型的字段最自然地对应于图 6.3a。由于 `n` 将相对较小，将字符串放置在记录内部不会使记录太大。此外，字符串大小的变化意味着定长表示会浪费空间。因此，变长表示是最好的选择。如果 `n` 碰巧很小（例如，小于 20），那么记录管理器可能会选择使用第三种表示来实现 `varchar` 字段。原因是与定长表示的优点相比，浪费的空间将微不足道。

`clob` 类型的字段对应于图 6.3b，因为该表示最能处理大字符串。通过将大字符串存储在记录外部，记录本身变得更小、更易于管理。

### 6.1.4 字段在记录中的放置 (Placing Fields in Records)

记录管理器确定其记录的结构。对于**定长记录 (fixed-length records)**，它确定每个字段在记录中的位置。最直接的策略是将字段彼此相邻存储。记录的大小然后变为字段大小的总和，每个字段的偏移量是前一个字段的结尾。

这种将字段紧密打包到记录中的策略适用于基于 Java 的系统（如 SimpleDB 和 Derby），但在其他地方可能会导致问题。问题在于确保值在内存中正确**对齐 (aligned)**。在大多数计算机中，访问整数的机器代码要求整数存储在 4 的倍数的内存位置中；据说整数**对齐在 4 字节边界上 (aligned on a 4-byte boundary)**。因此，记录管理器必须确保每个页面中的每个整数都对齐在 4 字节边界上。由于 OS 页面总是对齐在 2 的 N 次幂字节边界上（N 为某个合理大的整数），因此每个页面的第一个字节将正确对齐。因此，记录管理器必须简单地确保每个页面中每个整数的偏移量是 4 的倍数。如果前一个字段的结尾位置不是 4 的倍数，那么记录管理器必须用足够的字节**填充 (pad)** 它，使其成为 4 的倍数。

例如，考虑 `STUDENT` 表，它由三个整数字段和一个 `varchar(10)` 字符串字段组成。整数字段是 4 的倍数，因此它们不需要填充。然而，字符串字段需要 14 个字节（假设第 3.5.2 节的 SimpleDB 表示）；因此，它需要填充额外的 2 个字节，以便其后的字段将对齐在 4 的倍数上。

通常，不同的类型可能需要不同数量的填充。例如，双精度浮点数通常对齐在 8 字节边界上，而小整数通常对齐在 2 字节边界上。记录管理器负责确保这些对齐。一个简单的策略是按声明顺序放置字段，填充每个字段以确保下一个字段的正确对齐。一个更巧妙的策略是**重新排序 (reorder)** 字段，以便所需填充量最少。例如，考虑以下 SQL 表声明：

```sql
create table T (A smallint, B double precision, C smallint, D int, E int)
```

假设字段按给定顺序存储。那么字段 A 需要填充额外的 6 个字节，字段 C 需要填充额外的 2 个字节，导致记录长度为 28 字节；参见 图 6.4a。另一方面，如果字段按顺序 `[B, D, A, C, E]` 存储，则不需要填充，记录长度仅为 20 字节，如 图 6.4b 所示。

![fig6-4](/images/chapter6/fig6-4.png)

 **图 6.4 记录中字段的放置以实现对齐 ,(a)需要填充的放置方式图 ,(b) 不需要填充的放置方式**

除了填充字段，记录管理器还必须**填充 (pad)** 每条记录。其思想是每条记录需要以 k 字节边界结束，其中 k 是支持的最大对齐方式，以便页面中的每条记录都与第一条记录具有相同的对齐方式。再次考虑 图 6.4a 的字段放置，其记录长度为 28 字节。假设第一条记录从块的字节 0 开始。那么第二条记录将从块的字节 28 开始，这意味着第二条记录的字段 B 将从块的字节 36 开始，这是错误的对齐方式。**每条记录都必须从 8 字节边界开始**至关重要。在图 6.4 的示例中，部分 (a) 和部分 (b) 的记录都需要填充额外的 4 个字节。

Java 程序不需要考虑填充，因为它不能直接访问字节数组中的数值。例如，从页面读取整数的 Java 方法是 `ByteBuffer.getInt`。此方法不调用机器代码指令来获取整数，而是从数组的 4 个指定字节中构造整数本身。此活动不如单个机器代码指令高效，但它避免了对齐问题。

## 6.2 实现记录文件 (Implementing a File of Records)

前一节讨论了记录管理器必须解决的各种决策。本节将考虑这些决策如何实现。它从最直接的实现开始：一个包含**同构 (homogeneous)**、**非跨块 (unspanned)**、**定长记录 (fixed-length records)** 的文件。然后，它将考虑其他设计决策如何影响此实现。

### 6.2.1 直接实现 (A Straightforward Implementation)

假设您想创建一个包含同构、非跨块、定长记录的文件。记录**非跨块 (unspanned)** 的事实意味着您可以将文件视为一个**块序列 (sequence of blocks)**，其中每个块包含自己的记录。记录**同构 (homogeneous)** 且**定长 (fixed-length)** 的事实意味着您可以为块内的每条记录分配相同量的空间。换句话说，您可以将每个块视为**记录数组 (array of records)**。SimpleDB 将这种块称为**记录页 (record page)**。

记录管理器可以如下实现记录页：它将一个块分成**槽 (slots)**，其中每个槽都足够大，可以容纳一条记录加上一个额外的字节。这个字节的值是一个**标志 (flag)**，表示该槽是空的还是正在使用中；我们假设 0 表示“空”，1 表示“正在使用”。

例如，假设块大小为 400 字节，记录大小为 26 字节；那么每个槽长 27 字节，块可以容纳 14 个槽，并浪费 22 字节的空间。图 6.5 描绘了这种情况。此图显示了 14 个槽中的 4 个；槽 0 和 13 当前包含记录，而槽 1 和 2 是空的。

![fig6-5](/images/chapter6/fig6-5.png)

 **图 6.5 一个记录页，包含 14 条 26 字节记录的空间**

记录管理器需要能够插入、删除和修改记录页中的记录。为此，它使用关于记录的以下信息：

- **槽的大小 (The size of a slot)**
- **记录每个字段的名称、类型、长度和偏移量 (The name, type, length, and offset of each field of a record)**

这些值构成了记录的**布局 (layout)**。例如，考虑图 2.4 中定义的 `STUDENT` 表。一个 `STUDENT` 记录包含三个整数加上一个十字符的 `varchar` 字段。假设 SimpleDB 的存储策略，每个整数需要 4 字节，一个十字符字符串需要 14 字节。我们还假设不需要填充，`varchar` 字段通过为最大可能的字符串分配固定空间来实现，并且空/使用中标志在每个槽的开头占用一个字节。图 6.6 给出了此表的结果布局。

![fig6-6](/images/chapter6/fig6-6.png)

**图 6.6 `STUDENT` 表的布局**

给定一个布局，记录管理器可以确定页面中每个值的位置。槽 `k` 中的记录从位置 `RL * k + Offset(F)` 开始，其中 `RL` 是记录长度。该记录的空/使用中标志位于位置 `RL * k`，其字段 `F` 的值位于位置 `RL * k + Offset(F)`。

记录管理器可以非常容易地处理插入、删除、修改和检索操作：

- **插入新记录 (To insert a new record)**：记录管理器检查每个槽的空/使用中标志，直到找到一个 0。然后它将标志设置为 1 并返回该槽的位置。如果所有标志值都是 1，则该块已满，无法插入。
- **删除记录 (To delete a record)**：记录管理器只需将其空/使用中标志设置为 0。
- **修改记录的字段值 (To modify a field value of a record)**（或初始化新记录的字段）：记录管理器确定该字段的位置并将值写入该位置。
- **检索页面中的记录 (To retrieve the records in the page)**：记录管理器检查每个槽的空/使用中标志。每次找到 1 时，它就知道该槽包含一条现有记录。

记录管理器还需要一种方法来标识记录页中的记录。当记录是定长时，最直接的记录标识符是其**槽号 (slot number)**。

### 6.2.2 实现变长字段 (Implementing Variable-Length Fields)

定长字段的实现非常直接。本节将考虑引入变长字段如何影响该实现。

一个问题是记录中字段的**偏移量不再固定 (field offsets in a record are no longer fixed)**。特别是，所有在变长字段之后的字段的偏移量将因记录而异。确定这些字段偏移量的唯一方法是读取前一个字段并查看它在哪里结束。如果记录中的第一个字段是变长字段，那么为了确定第 `n` 个字段的偏移量，有必要读取记录的前 `n-1` 个字段。因此，记录管理器通常将**定长字段放在每条记录的开头 (fixed-length fields at the beginning of each record)**，以便可以通过预先计算的偏移量访问它们。变长字段则放在记录的末尾。第一个变长字段将具有固定偏移量，但其余的则不会。

另一个问题是**修改字段值会导致记录长度改变 (modifying a field value can cause a record’s length to change)**。如果新值更大，则必须**移动 (shifted)** 修改值右侧的块内容以腾出空间。在极端情况下，移动的记录将**溢出 (spill out of)** 块；这种情况必须通过分配一个**溢出块 (overflow block)** 来处理。溢出块是从称为**溢出区 (overflow area)** 的区域分配的新块。任何溢出原始块的记录都会从该块中删除并添加到溢出块中。如果发生许多此类修改，则可能需要由几个溢出块组成的链。每个块将包含对链中下一个溢出块的引用。从概念上讲，原始块和溢出块形成一个单一的（大）记录页。

例如，考虑 `COURSE` 表，并假设课程标题保存为**变长字符串 (variable-length strings)**。图 6.7a 描绘了一个包含该表前三条记录的块。（`Title` 字段已移到记录末尾，因为其他字段是定长的。）图 6.7b 描绘了将标题“DbSys”修改为“Database Systems Implementation”的结果。假设块大小为 80 字节，第三条记录不再适合该块，因此它被放置在**溢出块 (overflow block)** 中。原始块包含对该溢出块的引用。

![fig6-7](/images/chapter6/fig6-7.png)

**图 6.7 使用溢出块实现变长记录。(a) 原始块，(b) 修改课程 12 标题后的结果**

![fig6-8](/images/chapter6/fig6-8.png)

**图 6.8 使用 ID 表实现变长记录。(a) 原始块，(b) 删除记录 1 的直接方法，(c) 使用 ID 表删除记录 1**

第三个问题是关于将**槽号 (slot number)** 作为**记录标识符 (record identifier)** 的使用。不再可能像定长记录那样将槽号乘以槽大小。找到具有给定 ID 的记录开头唯一的方法是**从块的开头开始读取记录 (read the records starting from the beginning of the block)**。

将槽号作为记录标识符还会使记录插入复杂化。图 6.8 说明了这个问题。

图 (a) 描绘了一个包含前三条 `COURSE` 记录的块，与图 6.7a 相同。删除课程 22 的记录会将标志设置为 0（表示“空”）并保持记录不变，如图 (b) 所示。此空间现在可用于插入。然而，只有当其 `Title` 字段包含九个或更少字符时，才能将记录插入到该空间中。通常，即使存在由较小已删除记录留下的许多空白空间，新记录也可能不适合该块。该块被称为**碎片化 (fragmented)**。

减少这种碎片化的一种方法是**移动剩余的记录 (shift the remaining records)**，使它们都集中在块的一端。然而，这样做会改变移动记录的槽号，这不幸地改变了它们的 ID。

解决这个问题的方法是使用**ID 表 (ID table)** 将记录的槽号与其在页面中的位置**分离 (dissociate)**。ID 表是一个存储在页面开头的整数数组。数组中的每个槽都表示一个**记录 ID (record id)**。数组中的值是具有该 ID 的记录的位置；值为 0 表示当前没有记录具有该 ID。图 6.8c 描绘了与图 6.8b 相同的数据，但带有一个 ID 表。ID 表包含三个条目：其中两个指向块中偏移量 63 和 43 处的记录，另一个为空。位置 63 处的记录 ID 为 0，位置 43 处的记录 ID 为 2。目前没有 ID 为 1 的记录。

ID 表提供了一个**间接级别 (level of indirection)**，允许记录管理器在块内移动记录。如果记录移动，其在 ID 表中的条目会相应调整；如果记录被删除，其条目将设置为 0。当插入新记录时，记录管理器会在数组中找到一个可用的条目，并将其分配为新记录的 ID。通过这种方式，ID 表允许变长记录在块内移动，同时为每条记录提供一个**固定标识符 (fixed identifier)**。

ID 表随着块中记录数量的增加而扩展。数组的大小必然是**开放式 (open-ended)** 的，因为一个块可以容纳数量不等的变长记录。通常，ID 表放在块的一端，记录放在另一端，它们**相互生长 (grow toward each other)**。这种情况可以在图 6.8c 中看到，其中块中的第一条记录位于其最右端。ID 表使得**空/使用中标志 (empty/inuse flags)** 不再必要。如果 ID 表的条目指向一条记录，则该记录正在使用中。空记录的 ID 为 0（实际上甚至不存在）。ID 表还使记录管理器能够快速找到块中的每条记录。要移动到具有特定 ID 的记录，记录管理器只需使用存储在 ID 表该条目中的位置；要移动到下一条记录，记录管理器扫描 ID 表直到找到下一个非零条目。

### 6.2.3 实现跨块记录 (Implementing Spanned Records)

本节将考虑如何实现**跨块记录 (spanned records)**。当记录**非跨块 (unspanned)** 时，每个块中的第一条记录始终从相同的位置开始。对于跨块记录，这种情况不再成立。因此，记录管理器必须在每个块的开头存储一个整数，以保存第一条记录的**偏移量 (offset)**。

![fig6-9](/images/chapter6/fig6-9.png)

**图 6.9 实现跨块记录**

例如，考虑图 6.9。块 0 中的第一个整数是 4，表示第一条记录 R1 从偏移量 4 开始（即紧跟在该整数之后）。记录 R2 跨越块 0 和块 1，因此块 1 中的第一条记录是 R3，它从偏移量 60 开始。记录 R3 继续通过块 2 进入块 3。记录 R4 是块 3 中的第一条记录，从偏移量 30 开始。请注意，块 2 的第一个整数是 0，表示该块中没有记录开始。

记录管理器可以选择以两种不同的方式拆分跨块记录。第一种方式是尽可能地填充块，在块边界处拆分；剩余的字节放置在文件的下一个块（或多个块）中。第二种方式是逐值写入记录；当页面满时，写入继续在新页面上。第一种方式的优点是它**绝对不浪费空间 (wastes absolutely no space)**，但缺点是**将值拆分到多个块中 (splitting a value across blocks)**。要访问拆分的值，记录管理器必须通过连接来自两个块的字节来**重建 (reconstruct)** 该值。

### 6.2.4 实现非同构记录 (Implementing Nonhomogeneous Records)

如果记录管理器支持**非同构记录 (nonhomogeneous records)**，那么它还需要支持**变长记录 (variable-length records)**，因为来自不同表的记录大小不必相同。在块中包含非同构记录有两个问题：

- 记录管理器需要知道块中每种记录的**布局 (layout)**。
- 给定一条记录，记录管理器需要知道它来自哪个表。

记录管理器可以通过维护一个**布局数组 (array of layouts)** 来解决第一个问题，每个可能的表对应一个布局。记录管理器可以通过在每条记录的开头添加一个额外的**值 (value)** 来解决第二个问题；这个值有时称为**标签值 (tag value)**，它是布局数组的**索引 (index)**，指定该记录所属的表。

例如，再次考虑图 6.2，它描绘了来自 `DEPT` 和 `STUDENT` 表的非同构块。记录管理器将维护一个包含这两个表布局信息的数组；我们假设 `DEPT` 信息在数组的索引 0 中，`STUDENT` 信息在索引 1 中。那么来自 `DEPT` 的每条记录的标签值将是 0，而每条 `STUDENT` 记录的标签值将是 1。

记录管理器的行为不需要太多改变。当记录管理器访问一条记录时，它会根据标签值确定要使用哪个表信息。然后它可以使用该表来读取或写入任何字段，与同构情况相同。

SimpleDB 中的**日志记录 (log records)** 是非同构记录的一个例子。每个日志记录的第一个值是一个整数，表示日志记录的类型。恢复管理器使用该值来确定如何读取记录的其余部分。

## 6.3 SimpleDB 记录页面 (SimpleDB Record Pages)

接下来的两节将探讨 SimpleDB 的记录管理器，它实现了 6.2.1 节介绍的基本记录管理器。本节涵盖了**记录页面的实现 (implementation of record pages)**，而下一节将介绍如何实现**记录页面文件 (file of record pages)**。本章的一些期末练习会要求您修改它以处理其他设计决策。

### 6.3.1 管理记录信息 (Managing Record Information)

SimpleDB 的记录管理器使用 **`Schema`** 和 **`Layout`** 类来管理记录的信息。它们的 API 如 图 6.10 所示。

**图 6.10 SimpleDB 记录信息的 API**

**`Schema` 类 (Schema Class)**

- `public Schema()`: 构造函数，创建一个新的 `Schema` 对象。
- `public void addField(String fldname, int type, int length)`: 添加一个字段，指定字段名、类型和长度。
- `public void addIntField(String fldname)`: 便捷方法，添加一个整数字段。
- `public void addStringField(String fldname, int length)`: 便捷方法，添加一个字符串字段，指定最大长度。
- `public void add(String fldname, Schema sch)`: 从另一个 `Schema` 对象复制指定字段的信息。
- `public void addAll(Schema sch)`: 从另一个 `Schema` 对象复制所有字段的信息。
- `public List<String> fields()`: 获取所有字段名称的列表。
- `public boolean hasField(String fldname)`: 检查模式中是否存在指定字段。
- `public int type(String fldname)`: 获取指定字段的类型。
- `public int length(String fldname)`: 获取指定字段的长度（对字符串而言是最大字符数）。

**`Layout` 类 (Layout Class)**

- `public Layout(Schema schema)`: 构造函数，根据给定的 `Schema` 计算并创建物理布局。
- `public Layout(Schema schema, Map<String,Integer> offsets, int slotSize)`: 构造函数，使用已计算的偏移量和槽大小创建布局（用于加载现有表）。
- `public Schema schema()`: 获取关联的 `Schema` 对象。
- `public int offset(String fldname)`: 获取指定字段在槽内的字节偏移量。
- `public int slotSize()`: 获取每个记录槽的总字节大小。

一个 **`Schema` 对象** 保存着记录的**模式 (schema)**，即每个字段的名称、类型以及每个字符串字段的长度。这些信息对应于用户在创建表时会指定的内容，并且**不包含任何物理存储信息**。例如，字符串的长度是指允许的最大字符数，而不是其在字节中的实际大小。

`Schema` 可以被认为是 `[字段名, 类型, 长度]` 形式的三元组列表。`Schema` 类包含五个方法来向此列表添加三元组。`addField` 方法显式地添加一个三元组。`addIntField`、`addStringField`、`add` 和 `addAll` 都是便捷方法；前两个方法计算三元组，后两个方法从现有模式中复制三元组。该类还具有**访问器方法 (accessor methods)**，用于检索字段名集合，确定指定字段是否在集合中，以及检索指定字段的类型和长度。

**`Layout` 类** 则额外包含了记录的**物理信息 (physical information)**。它计算字段和槽的大小，以及字段在槽内的偏移量。该类有两个构造函数，对应于创建 `Layout` 对象的两种原因。第一个构造函数在创建表时调用；它根据给定的模式计算布局信息。第二个构造函数在表创建后调用；客户端只需提供先前计算好的值。

图 6.11 中的代码片段演示了这两个类的用法。代码的第一部分创建了一个包含 `COURSE` 表三个字段的模式，然后从该模式创建了一个 `Layout` 对象。代码的第二部分打印了每个字段的名称和偏移量。

**图 6.11 指定 `COURSE` 记录的结构 (Specifying the structure of COURSE records)**

```java
Schema sch = new Schema(); // 创建一个新的 Schema 对象
sch.addIntField("cid"); // 添加一个名为 "cid" 的整数字段
sch.addStringField("title", 20); // 添加一个名为 "title" 的字符串字段，最大长度为 20
sch.addIntField("deptid"); // 添加一个名为 "deptid" 的整数字段

Layout layout = new Layout(sch); // 根据 Schema 创建 Layout 对象，计算物理布局

// 遍历布局中的所有字段，并打印它们的名称和偏移量
for (String fldname : layout.schema().fields()) {
    int offset = layout.offset(fldname); // 获取字段的字节偏移量
    System.out.println(fldname + " has offset " + offset); // 打印结果
}
```

------

### 6.3.2 实现 `Schema` 和 `Layout` (Implementing the Schema and Layout)

**`Schema` 类** 的代码非常直接，如 图 6.12 所示。在内部，该类将三元组存储在以字段名作为键的 `Map` 中。与字段名关联的对象属于私有内部类 `FieldInfo`，它封装了字段的长度和类型。

------

**图 6.12 SimpleDB `Schema` 类的代码 (The code for SimpleDB class Schema)**

```java
public class Schema {
    private List<String> fields = new ArrayList<>(); // 存储字段名的列表，保持顺序
    private Map<String,FieldInfo> info = new HashMap<>(); // 存储字段信息（FieldInfo对象），键为字段名

    // 显式添加字段的方法
    public void addField(String fldname, int type, int length) {
        fields.add(fldname); // 将字段名添加到列表中
        info.put(fldname, new FieldInfo(type, length)); // 将字段信息存储到Map中
    }

    // 添加整数字段的便捷方法 (类型为 INTEGER，长度为 0，因为整数长度固定)
    public void addIntField(String fldname) {
        addField(fldname, INTEGER, 0);
    }

    // 添加字符串字段的便捷方法 (类型为 VARCHAR，指定长度)
    public void addStringField(String fldname, int length) {
        addField(fldname, VARCHAR, length);
    }

    // 从另一个 Schema 复制指定字段
    public void add(String fldname, Schema sch) {
        int type = sch.type(fldname);
        int length = sch.length(fldname);
        addField(fldname, type, length);
    }

    // 从另一个 Schema 复制所有字段
    public void addAll(Schema sch) {
        for (String fldname : sch.fields())
            add(fldname, sch);
    }

    // 获取所有字段名
    public List<String> fields() {
        return fields;
    }

    // 检查是否包含某个字段
    public boolean hasField(String fldname) {
        return fields.contains(fldname);
    }

    // 获取指定字段的类型
    public int type(String fldname) {
        return info.get(fldname).type;
    }

    // 获取指定字段的长度
    public int length(String fldname) {
        return info.get(fldname).length;
    }

    // 私有内部类，封装字段的类型和长度
    class FieldInfo {
        int type, length;
        public FieldInfo(int type, int length) {
            this.type = type;
            this.length = length;
        }
    }
}
```

类型由 JDBC 类 `Types` 中定义的常量 `INTEGER` 和 `VARCHAR` 表示。字段的长度仅对字符串字段有意义；`addIntField` 方法为整数赋予长度值 0，但此值不相关，因为它永远不会被访问。

**`Layout` 类** 的代码如 图 6.13 所示。第一个构造函数按照它们在 `Schema` 中出现的顺序定位字段。它以字节为单位确定每个字段的长度，将**槽大小 (slot size)** 计算为字段长度的总和，并为整数大小的空/使用中标志额外添加四个字节。它将标志分配在槽的偏移量 0 处，并将每个字段的偏移量分配为前一个字段结束的位置（即**没有填充 (no padding)**）。

**图 6.13 SimpleDB `Layout` 类的代码 (The code for the SimpleDB class Layout)**

```java
public class Layout {
    private Schema schema; // 关联的 Schema 对象
    private Map<String,Integer> offsets; // 存储字段名到其在槽中偏移量的映射
    private int slotsize; // 每个记录槽的总大小（字节）

    // 构造函数：根据 Schema 计算布局
    public Layout(Schema schema) {
        this.schema = schema;
        offsets = new HashMap<>();
        // 从 Integer.BYTES (4字节) 处开始计算字段偏移量，因为前 4 字节用于空/使用中标志
        int pos = Integer.BYTES; 
        for (String fldname : schema.fields()) {
            offsets.put(fldname, pos); // 记录当前字段的偏移量
            pos += lengthInBytes(fldname); // 增加位置，为下一个字段做准备
        }
        slotsize = pos; // 槽大小等于所有字段长度加上标志位的总和
    }

    // 构造函数：使用预先计算好的偏移量和槽大小（用于加载现有表）
    public Layout(Schema schema, Map<String,Integer> offsets, int slotsize) {
        this.schema = schema;
        this.offsets = offsets;
        this.slotsize = slotsize;
    }

    // 获取关联的 Schema
    public Schema schema() {
        return schema;
    }

    // 获取指定字段的偏移量
    public int offset(String fldname) {
        return offsets.get(fldname);
    }

    // 获取槽的大小
    public int slotSize() {
        return slotsize;
    }

    // 私有辅助方法：计算字段在字节中的实际长度
    private int lengthInBytes(String fldname) {
        int fldtype = schema.type(fldname);
        if (fldtype == INTEGER)
            return Integer.BYTES; // 整数字段固定为 Integer.BYTES 字节 (通常是 4)
        else // fldtype == VARCHAR
            // 字符串字段的长度由 Page.maxLength 计算，基于其最大字符数
            return Page.maxLength(schema.length(fldname));
    }
}
```

### 6.3.3 管理页面中的记录 (Managing the Records in a Page)

**`RecordPage` 类** 管理页面中的记录。它的 API 如 图 6.14 所示。

**图 6.14 SimpleDB 记录页的 API (The API for SimpleDB record pages)**

**`RecordPage` 类 (RecordPage Class)**

- `public RecordPage(Transaction tx, BlockId blk, Layout layout)`: 构造函数，用于管理特定块 (`blk`) 上具有给定 `layout` 的记录，所有操作都在一个事务 (`tx`) 内完成。
- `public BlockId block()`: 返回该页面所属块的 `BlockId`。
- `public int getInt(int slot, String fldname)`: 从指定槽位、指定字段获取一个整数值。
- `public String getString(int slot, String fldname)`: 从指定槽位、指定字段获取一个字符串值。
- `public void setInt(int slot, String fldname, int val)`: 在指定槽位、指定字段设置一个整数值。
- `public void setString(int slot, String fldname, String val)`: 在指定槽位、指定字段设置一个字符串值。
- `public void format()`: 格式化页面，将所有记录槽设置为默认值（标志为空，整数为 0，字符串为空）。
- `public void delete(int slot)`: 删除指定槽位的记录（将其标志设为空）。
- `public int nextAfter(int slot)`: 在指定槽位之后查找下一个已使用的槽位。如果找不到，返回负值。
- `public int insertAfter(int slot)`: 在指定槽位之后查找下一个空槽位。如果找到，将其标志设为“已使用”并返回槽号；否则返回负值。

`get/set` 方法访问指定记录中指定字段的值。`delete` 方法将记录的标志设置为 `EMPTY`。`format` 方法为页面中所有记录槽提供默认值。它将每个空/使用中标志设置为 `EMPTY`，所有整数设置为 0，所有字符串设置为 `""`。

**`RecordTest` 类** 演示了 `RecordPage` 方法的使用；其代码如 图 6.15 所示。它定义了一个包含两个字段的记录模式：一个整数字段 A 和一个字符串字段 B。然后它为新块创建一个 `RecordPage` 对象并对其进行格式化。`for` 循环使用 `insertAfter` 方法用随机值记录填充页面。（每个 A 值是 0 到 49 之间的随机数，B 值是该数字的字符串版本。）两个 `while` 循环使用 `nextAfter` 方法搜索页面。第一个循环删除选定的记录，第二个循环打印剩余记录的内容。

**图 6.15 测试 `RecordPage` 类 (Testing the RecordPage class)**

```java
public class RecordTest {
    public static void main(String[] args) throws Exception {
        // 初始化SimpleDB，指定数据库名称、块大小和缓冲区数量
        SimpleDB db = new SimpleDB("recordtest", 400, 8); 
        Transaction tx = db.newTx(); // 开始一个新的事务

        // 定义记录的模式 (Schema)
        Schema sch = new Schema();
        sch.addIntField("A"); // 添加一个名为"A"的整数字段
        sch.addStringField("B", 9); // 添加一个名为"B"的字符串字段，最大长度为9字符
        Layout layout = new Layout(sch); // 根据Schema创建布局

        // 打印字段名称和它们的偏移量
        for (String fldname : layout.schema().fields()) {
            int offset = layout.offset(fldname);
            System.out.println(fldname + " has offset " + offset);
        }

        // 将一个新块附加到"testfile"并将其钉住（pin）在缓冲区中
        BlockId blk = tx.append("testfile");
        tx.pin(blk);

        // 创建一个RecordPage对象来管理这个块中的记录
        RecordPage rp = new RecordPage(tx, blk, layout);
        rp.format(); // 格式化页面，将所有槽位标记为"空"并初始化字段

        System.out.println("Filling the page with random records.");
        // 从-1（表示从开头）开始插入记录，直到页面满
        int slot = rp.insertAfter(-1); 
        while (slot >= 0) {
            int n = (int) Math.round(Math.random() * 50); // 生成0到50之间的随机整数
            rp.setInt(slot, "A", n); // 设置字段"A"的值
            rp.setString(slot, "B", "rec"+n); // 设置字段"B"的值（字符串形式）
            System.out.println("inserting into slot " + slot + ": {"+ n + ", " + "rec"+n + "}");
            slot = rp.insertAfter(slot); // 获取下一个可用的槽位
        }

        System.out.println("Deleted these records with A-values < 25.");
        int count = 0;
        // 从-1（表示从开头）开始查找已使用的槽位
        slot = rp.nextAfter(-1);
        while (slot >= 0) {
            int a = rp.getInt(slot, "A"); // 获取字段"A"的值
            String b = rp.getString(slot, "B"); // 获取字段"B"的值
            if (a < 25) { // 如果A的值小于25
                count++;
                System.out.println("slot " + slot + ": {"+ a + ", " + b + "}");
                rp.delete(slot); // 删除该记录
            }
            slot = rp.nextAfter(slot); // 获取下一个已使用的槽位
        }
        System.out.println(count + " values under 25 were deleted.\n");

        System.out.println("Here are the remaining records.");
        // 再次从-1（表示从开头）开始查找已使用的槽位，打印剩余记录
        slot = rp.nextAfter(-1);
        while (slot >= 0) {
            int a = rp.getInt(slot, "A");
            String b = rp.getString(slot, "B");
            System.out.println("slot " + slot + ": {"+ a + ", " + b + "}");
            slot = rp.nextAfter(slot);
        }
        
        tx.unpin(blk); // 解除块的钉住
        tx.commit(); // 提交事务
    }
}
```

### 6.3.4 实现记录页 (Implementing Record Pages)

SimpleDB 实现了 图 6.5 中所示的**槽页结构 (slotted-page structure)**。唯一的区别是空/使用中标志被实现为 4 字节整数而不是单个字节（原因是 SimpleDB 不支持字节大小的值）。`RecordPage` 类的代码如 图 6.16 所示。

**图 6.16 SimpleDB `RecordPage` 类的代码 (The code for the SimpleDB class RecordPage)**

```java
public class RecordPage {
    public static final int EMPTY = 0, USED = 1; // 定义槽状态常量：空和已使用
    private Transaction tx; // 事务对象
    private BlockId blk; // 块ID
    private Layout layout; // 记录布局

    // 构造函数：初始化RecordPage对象，并钉住（pin）其关联的块
    public RecordPage(Transaction tx, BlockId blk, Layout layout) {
        this.tx = tx;
        this.blk = blk;
        this.layout = layout;
        tx.pin(blk); 
    }

    // 获取指定槽位、指定字段的整数值
    public int getInt(int slot, String fldname) {
        int fldpos = offset(slot) + layout.offset(fldname); // 计算字段的绝对字节位置
        return tx.getInt(blk, fldpos); // 从块中读取整数
    }

    // 获取指定槽位、指定字段的字符串值
    public String getString(int slot, String fldname) {
        int fldpos = offset(slot) + layout.offset(fldname); // 计算字段的绝对字节位置
        return tx.getString(blk, fldpos); // 从块中读取字符串
    }

    // 设置指定槽位、指定字段的整数值
    public void setInt(int slot, String fldname, int val) {
        int fldpos = offset(slot) + layout.offset(fldname); // 计算字段的绝对字节位置
        tx.setInt(blk, fldpos, val, true); // 向块中写入整数，并记录日志
    }

    // 设置指定槽位、指定字段的字符串值
    public void setString(int slot, String fldname, String val) {
        int fldpos = offset(slot) + layout.offset(fldname); // 计算字段的绝对字节位置
        tx.setString(blk, fldpos, val, true); // 向块中写入字符串，并记录日志
    }

    // 删除指定槽位的记录（通过设置其标志为空）
    public void delete(int slot) {
        setFlag(slot, EMPTY);
    }

    // 格式化页面：将所有槽位标记为“空”，并初始化字段为默认值
    public void format() {
        int slot = 0;
        while (isValidSlot(slot)) { // 遍历所有可能的槽位
            tx.setInt(blk, offset(slot), EMPTY, false); // 设置标志为空，不记录日志（格式化是初始操作）
            Schema sch = layout.schema();
            for (String fldname : sch.fields()) {
                int fldpos = offset(slot) + layout.offset(fldname);
                if (sch.type(fldname) == INTEGER)
                    tx.setInt(blk, fldpos, 0, false); // 初始化整数为0，不记录日志
                else
                    tx.setString(blk, fldpos, "", false); // 初始化字符串为空串，不记录日志
            }
            slot++;
        }
    }

    // 在指定槽位之后查找下一个已使用的槽位
    public int nextAfter(int slot) {
        return searchAfter(slot, USED);
    }

    // 在指定槽位之后查找下一个空槽位，如果找到则标记为已使用
    public int insertAfter(int slot) {
        int newslot = searchAfter(slot, EMPTY);
        if (newslot >= 0) // 如果找到了空槽位
            setFlag(newslot, USED); // 将其标志设置为“已使用”
        return newslot;
    }

    // 获取此RecordPage关联的块ID
    public BlockId block() {
        return blk;
    }

    // 私有辅助方法
    // 设置指定槽位的标志
    private void setFlag(int slot, int flag) {
        tx.setInt(blk, offset(slot), flag, true); // 设置标志并记录日志
    }

    // 在指定槽位之后搜索具有特定标志（USED或EMPTY）的槽位
    private int searchAfter(int slot, int flag) {
        slot++; // 从下一个槽位开始搜索
        while (isValidSlot(slot)) { // 只要槽位有效
            if (tx.getInt(blk, offset(slot)) == flag) // 检查槽位的标志是否匹配
                return slot; // 找到匹配的槽位，返回其槽号
            slot++; // 否则，移动到下一个槽位
        }
        return -1; // 没有找到匹配的槽位
    }

    // 检查指定槽位是否有效（即是否在块的范围内）
    private boolean isValidSlot(int slot) {
        // 槽位有效条件：该槽位紧邻的下一个槽位的起始位置不超出块大小
        return offset(slot+1) <= tx.blockSize(); 
    }

    // 计算指定槽位的起始字节偏移量
    private int offset(int slot) {
        return slot * layout.slotSize(); // 槽号乘以槽大小
    }
}
```

私有方法 `offset` 使用槽大小来计算记录槽的起始位置。`get/set` 方法通过将字段的偏移量（从 `Layout` 获取）添加到记录的偏移量来计算其指定字段的位置。`nextAfter` 和 `insertAfter` 方法分别调用私有方法 `searchAfter` 来查找具有指定标志（`USED` 或 `EMPTY`）的槽。`searchAfter` 方法会重复递增指定的槽号，直到找到具有指定标志的槽或用完槽。`delete` 方法将指定槽的标志设置为 `EMPTY`，而 `insertAfter` 将找到的槽的标志设置为 `USED`。
