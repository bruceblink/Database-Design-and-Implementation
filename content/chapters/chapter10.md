---
typora-root-url: ./..\..\public
---

# 第 10 章 规划 (Planning)

在查询处理的第一步中，**解析器 (parser)** 从 SQL 语句中提取相关数据。下一步是将这些数据转换为关系代数查询树。这一步称为**规划 (planning)**。本章探讨基本的规划过程。它探讨了规划器需要做什么来验证 SQL 语句是否具有语义意义，并介绍了两种基本**计划构建算法 (plan-construction algorithms)**。

一个 SQL 语句可以有许多等效的查询树，它们的成本往往差异巨大。一个希望在商业上可行的数据库系统必须有一个能够找到高效计划的规划算法。第 15 章将探讨创建最优计划的困难主题。

## 10.1 验证 (Verification)

**规划器 (planner)** 的首要职责是确定给定的 SQL 语句是否实际有意义。规划器需要验证语句的以下几点：

- 所提及的表和字段确实存在于**目录 (catalog)** 中。
- 所提及的字段没有歧义。
- 字段上的操作是**类型正确 (type-correct)** 的。
- 所有常量对于其字段来说都具有正确的**大小 (size)** 和**类型 (type)**。

执行此验证所需的所有信息都可以通过检查所提及表的**模式 (schemas)** 来找到。例如，模式的缺失表明所提及的表不存在。类似地，任何模式中字段的缺失表明该字段不存在，而它出现在多个模式中则表明可能存在歧义。

规划器还应该通过检查每个提及字段的类型和长度来确定**谓词 (predicates)**、**修改赋值 (modification assignments)** 和**插入值 (inserted values)** 的类型正确性。对于谓词，表达式中每个操作符的参数必须是兼容类型，每个项中的表达式也必须是兼容类型。修改语句将一个表达式赋值给一个字段；这两种类型必须兼容。对于插入语句，每个插入值的类型必须与其关联字段的类型兼容。

SimpleDB 规划器可以通过元数据管理器的 `getLayout` 方法获取必要的表模式。然而，规划器目前不执行任何显式验证。练习 10.4-10.8 要求您纠正这种情况。

## 10.2 评估查询树的成本 (The Cost of Evaluating a Query Tree)

规划器的第二个职责是为查询构建一个**关系代数查询树 (relational algebra query tree)**。一个复杂之处在于，一个 SQL 查询可以通过几种不同的查询树来实现，每个查询树都有自己的执行时间。规划器负责选择最有效的一个。

但是规划器如何计算查询树的效率呢？回想一下，查询运行时间最重要的贡献者是它访问的块数。因此，查询树的成本定义为**完全迭代查询的扫描所需的块访问次数**。

扫描的成本可以通过递归计算其子扫描的成本，然后应用基于扫描类型的成本公式来计算。图 10.1 给出了三个成本函数的公式。每个关系操作符都有自己的这些函数公式。成本函数是：

**图 10.1 扫描的成本公式 (The cost formulas for scans)**

![image-20250613101553638](/images/chapter10/fig10-1.png)

- B(s) = 构建扫描 s 的输出所需的块访问次数。
- R(s) = 扫描 s 输出中的记录数。
- V(s,F) = 扫描 s 输出中不同 F 值的数量。

这些函数类似于统计管理器的 `blocksAccessed`、`recordsOutput` 和 `distinctValues` 方法。不同之处在于它们适用于扫描而不是表。

快速检查图 10.1 显示了三个成本函数之间的相互关系。给定一个扫描 s，规划器希望计算 B(s)。但如果 s 是两个表的乘积，那么 B(s) 的值取决于两个表的块数以及其左侧扫描中的记录数。如果左侧扫描涉及一个选择操作符，那么它的记录数取决于谓词中提及字段的不同值的数量。换句话说，规划器需要所有这三个函数。

以下小节将推导图 10.1 所示的成本函数，并举例说明如何使用它们来计算查询树的成本。

### 10.2.1 表扫描的成本 (The Cost of a Table Scan)

查询中的每个**表扫描 (table scan)** 都持有其当前的记录页，该记录页持有一个缓冲区，该缓冲区锁定一个页面。当该页面中的记录已被读取时，其缓冲区被解除锁定，并且文件中下一个块的记录页取代它的位置。因此，一次通过表扫描将精确地访问每个块一次，每次锁定一个缓冲区。因此，当 s 是一个表扫描时，B(s)、R(s) 和 V(s,F) 的值就是底层表中**块数 (number of blocks)**、**记录数 (number of records)** 和**不同值的数量 (number of distinct values)**。

### 10.2.2 选择扫描的成本 (The Cost of a Select Scan)

选择扫描 (select scan) s 有一个底层扫描；称之为 s1。每次调用 next 方法都会导致选择扫描对 s1.next 进行一次或多次调用；当对 s1.next 的调用返回 false 时，该方法将返回 false。每次调用 getInt、getString 或 getVal 都只是从 s1 请求字段值，不需要块访问。因此，遍历一个选择扫描所需的块访问次数与其底层扫描所需的块访问次数完全相同。也就是说：

B(s)=B(s1)

R(s) 和 V(s,F) 的计算取决于选择谓词。作为示例，我将分析选择谓词将字段与常量或另一个字段等同的常见情况。

#### 常量选择 (Selection on a Constant)

假设谓词的形式为 A=c（其中 A 是某个字段）。假设 A 中的值是均匀分布 (equally distributed) 的，则将有 R(s1)/V(s1,A) 条记录匹配该谓词。也就是说：

R(s)=R(s1)/V(s1,A)

均匀分布的假设也意味着其他字段的值在输出中仍然是均匀分布的。也就是说：

V(s,A)=1

V(s,F)=V(s1,F) 对于所有其他字段 F

#### 字段选择 (Selection on a Field)

现在假设谓词的形式为 A=B（其中 A 和 B 是字段）。在这种情况下，合理地假设字段 A 和 B 中的值以某种方式相关。特别是，假设如果 B 值多于 A 值（即 V(s1,A)<V(s1,B)），则每个 A 值都出现在 B 中的某个位置；如果 A 值多于 B 值，则情况相反。（这个假设在 A 和 B 具有键-外键关系 (key-foreign key relationship) 的典型情况下是确实如此的。）所以假设 B 值多于 A 值，并考虑 s1 中的任何一条记录。它的 A 值有 1/V(s1,B) 的机会与其 B 值匹配。类似地，如果 A 值多于 B 值，则它的 B 值有 1/V(s1,A) 的机会与其 A 值匹配。因此：

R(s)=R(s1)/max{V(s1,A),V(s1,B)}

均匀分布的假设也意味着每个 A 值与 B 值匹配的可能性均等。因此，我们有：

V(s,F)=min{V(s1,A),V(s1,B)} 对于 F=A 或 B

V(s,F)=V(s1,F) 对于所有除了 A 或 B 之外的字段 F

### 10.2.3 投影扫描的成本 (The Cost of a Project Scan)

与选择扫描一样，投影扫描 (project scan) 只有一个底层扫描（称为 s1），并且除了其底层扫描所需的块访问之外，不需要额外的块访问。此外，投影操作不改变记录数，也不改变任何记录的值。因此：

B(s)=B(s1)

R(s)=R(s1)

V(s,F)=V(s1,F) 对于所有字段 F

### 10.2.4 乘积扫描的成本 (The Cost of a Product Scan)

**乘积扫描 (product scan)** 有两个底层扫描，s1 和 s2。它的输出包含 s1 和 s2 中记录的所有组合。当遍历扫描时，底层扫描 s1 将被遍历一次，而底层扫描 s2 将为 s1 的每条记录遍历一次。以下公式随之而来：

B(s)=B(s1)+R(s1)⋅B(s2)

R(s)=R(s1)⋅R(s2)

V(s,F)=V(s1,F) 或 V(s2,F)，取决于 F 属于哪个模式。

意识到 B(s) 的公式对于 s1 和 s2 是不对称的 (not symmetric) 是非常有趣和重要的。也就是说，语句

Scan s3 = new ProductScan(s1, s2);

可能导致与逻辑等价的语句

Scan s3 = new ProductScan(s2, s1);

不同数量的块访问。

它们能有多大不同？定义

RPB(s)=R(s)/B(s)

也就是说，RPB(s) 表示扫描 s 的“每块记录数”——每次块访问产生的平均输出记录数。上述公式可以重写如下：

B(s)=B(s1)+(RPB(s1)⋅B(s1)⋅B(s2))

主导项是 B(s)=B(s1)+R(s1)⋅B(s2)。如果你将此项与交换 s1 和 s2 后获得的项进行比较，你会发现当 s1 是 RPB 最低的底层扫描时，乘积扫描的成本通常是最低的。

例如，假设 s1 是 `STUDENT` 的表扫描，s2 是 `DEPT` 的表扫描。由于 `STUDENT` 记录比 `DEPT` 记录大，更多 `DEPT` 记录可以放入一个块中，这意味着 `STUDENT` 的 RPB 比 `DEPT` 小。上述分析表明，当 `STUDENT` 的扫描先进行时，磁盘访问次数最少。

### 10.2.5 一个具体示例 (A Concrete Example)

考虑一个查询，它返回主修数学的学生的姓名。图 10.2a 描绘了该查询的**查询树 (query tree)**，图 10.2b 给出了相应扫描的 SimpleDB 代码。

**图 10.2 查找主修数学的学生姓名。(a) 查询树，(b) 相应的 SimpleDB 扫描**

![image-20250613102005933](/images/chapter10/fig10-2a.png)

```java
// (b) 相应的 SimpleDB 扫描代码片段
SimpleDB db = new SimpleDB("studentdb");
Transaction tx = db.newTx();
MetadataMgr mdm = db.mdMgr();

// 获取 STUDENT 表的布局信息
Layout slayout = mdm.getLayout("student", tx);
// 获取 DEPT 表的布局信息
Layout dlayout = mdm.getLayout("dept", tx);

// s1: 对 STUDENT 表的表扫描
Scan s1 = new TableScan(tx, "student", slayout);

// s2: 对 DEPT 表的表扫描
Scan s2 = new TableScan(tx, "dept", dlayout);

// pred1: 谓词，例如 DName='math'
Predicate pred1 = new Predicate(. . .); // 例如：new Term(new Expression("dname"), new Expression(new Constant("math")))

// s3: 对 s2 (DEPT 表) 的选择扫描，过滤 DName='math'
Scan s3 = new SelectScan(s2, pred1);

// s4: s1 (STUDENT) 和 s3 (选择后的 DEPT) 的乘积扫描
Scan s4 = new ProductScan(s1, s3);

// pred2: 谓词，例如 majorid=did
Predicate pred2 = new Predicate(. . .); // 例如：new Term(new Expression("majorid"), new Expression("did"))

// s5: 对 s4 (乘积结果) 的选择扫描，过滤 majorid=did
Scan s5 = new SelectScan(s4, pred2);

// fields: 要投影的字段列表，例如 "sname"
List<String> fields = Arrays.asList("sname");

// s6: 对 s5 (选择后的乘积结果) 的投影扫描
Scan s6 = new ProjectScan(s5, fields);
```

图 10.3 使用图 7.8 中的**统计元数据 (statistical metadata)** 计算了图 10.2b 中每个扫描的成本。s1 和 s2 的条目只是简单地复制了图 7.8 中 `STUDENT` 和 `DEPT` 的统计数据。s3 的条目表示对 `DName` 的选择返回 1 条记录，但需要搜索 `DEPT` 的两个块才能找到它。扫描 s4 返回 45,000 条 `STUDENT` 记录与 1 条选定记录的所有组合；输出为 45,000 条记录。然而，该操作需要 94,500 次块访问，因为必须找到唯一的数学系记录 45,000 次，并且每次都需要对 `DEPT` 进行 2 个块的扫描。（另外 4500 次块访问来自对 `STUDENT` 的单次扫描。）扫描 s5 中对 `MajorId` 的选择将输出减少到 1125 条记录（45,000 名学生 / 40 个系），但不会改变所需的块访问次数。当然，投影操作什么也不会改变。

**图 10.3 查询树的成本 (Cost of the Query Tree)**

![image-20250613101846110](/images/chapter10/fig10-3.png)

数据库系统会重新计算数学系记录 45,000 次，并且代价高昂，这可能看起来很奇怪；然而，这就是**管道式查询处理 (pipelined query processing)** 的本质。（事实上，在这种情况下，第 13 章的非管道式实现会很有用。）

查看 STUDENT 和 s3 的 RPB 值，你会发现 RPB(STUDENT) = 10，而 RPB(s3) = 0.5。由于当 RPB 较小的扫描位于左侧时，乘积操作最快，因此更有效的策略是将 s4 定义如下：

s4 = new ProductScan(s3, STUDENT)

练习 10.3 要求你证明在这种情况下，操作仅需要 4502 次块访问。这种差异主要归因于现在只计算了一次选择操作。
