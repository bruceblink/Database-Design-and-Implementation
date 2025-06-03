---
typora-root-url: ./..\..\public
---

# 第 8 章 查询处理 (Chapter 8 Query Processing)

接下来的三章将探讨数据库引擎如何执行 SQL 查询。问题在于 SQL 查询指定了要返回什么数据，但没有指定如何获取这些数据。解决方案是让引擎实现一组数据检索操作符，称为**关系代数 (relational algebra)**。引擎可以将 SQL 查询翻译成关系代数查询，然后执行。本章将介绍关系代数查询及其实现。接下来的两章将探讨 SQL 到关系代数的翻译。

## 8.1 关系代数 (Relational Algebra)

关系代数由一组操作符组成。每个操作符执行一个专门的任务，接受一个或多个表作为输入，并产生一个输出表。可以通过以各种方式组合这些操作符来构建复杂的查询。

SimpleDB 版本的 SQL 可以使用以下三个操作符来实现：

- **选择 (select)**：其输出表与输入表具有相同的列，但删除了一些行。
- **投影 (project)**：其输出表与输入表具有相同的行，但删除了一些列。
- **乘积 (product)**：其输出表由其两个输入表的所有可能记录组合组成。

这些操作符将在以下小节中进行探讨。

### 8.1.1 选择 (Select)

**选择 (select)** 操作符接受两个参数：一个输入表和一个谓词。输出表由满足谓词的输入记录组成。选择查询总是返回一个与输入表具有相同模式但记录是其子集的表。

例如，查询 Q1 返回一个列出 2019 年毕业的学生的表。

`Q1=select(STUDENT,GradYear=2019)`

谓词可以是项的任何布尔组合，对应于 SQL 中的 `WHERE` 子句。例如，查询 Q2 查找那些 2019 年毕业且专业为 10 或 20 部门的学生。

`Q2=select(STUDENT,GradYear=2019 and (MajorId=10 or MajorId=20))`

一个查询的输出表可以作为另一个查询的输入。例如，查询 Q3 和 Q4 都等价于 Q2：

`Q3=select(select(STUDENT,GradYear=2019),MajorId=10 or MajorId=20)`

`Q4=select(Q1,MajorId=10 or MajorId=20)`

在 Q3 中，最外层查询的第一个参数是另一个查询，与 Q1 相同，它查找 2019 年毕业的学生。外层查询从这些记录中检索 10 或 20 部门的学生。查询 Q4 类似，只是它使用 Q1 的名称代替了其定义。

关系代数查询可以用图形表示，作为**查询树 (query tree)**。查询树包含查询中提到的每个表和操作符的节点。表节点是树的叶子，操作符节点是非叶子。操作符节点为其每个输入表都有一个子节点。例如，Q3 的查询树如 图 8.1 所示。

**图 8.1 Q3 的查询树 (A query tree for Q3)**

```txt
           select MajorId=10 or MajorId=20
              |   
           select GradYear=2019
              | 
           STUDENT 
```

### 8.1.2 投影 (Project)

**投影 (project)** 操作符接受两个参数：一个输入表和一组字段名。输出表与输入表具有相同的记录，但其模式只包含那些指定的字段。例如，查询 Q5 返回所有学生的姓名和毕业年份：

`Q5=project(STUDENT,{SName,GradYear})`

一个查询可以由投影和选择操作符组成。查询 Q6 返回一个列出所有主修 10 部门的学生的姓名的表：

`Q6=project(select(STUDENT,MajorId=10),{SName})`

Q6 的查询树如 图 8.2 所示。

**图 8.2 Q6 的查询树 (A query tree for Q6)**

```txt
           project {SName}
             |
           select  MajorId=10
             |       
           STUDENT 
```

投影查询的输出表可能包含重复记录。例如，如果有三个名叫“pat”且专业为 10 的学生，则 Q6 的输出将包含“pat”三次。

并非所有操作符的组合都有意义。例如，考虑通过反转 Q6 得到的查询：

`Q7=select(project(STUDENT,{SName}),MajorId=10) // 不合法！`

这个查询没有意义，因为内部查询的输出表不包含可以进行选择的 `MajorId` 字段。

### 8.1.3 乘积 (Product)

选择和投影操作符作用于单个表。**乘积 (product)** 操作符使得组合和比较来自多个表的信息成为可能。该操作符接受两个输入表作为参数。其输出表由输入表的所有记录组合组成，其模式由输入模式中字段的并集组成。输入表必须具有不相交的字段名，以便输出表不会有两个同名字段。

**图 8.3 查询 Q8 的输出 (The output of query Q8)**

这是 STUDENT 表和 DEPT 表的乘积结果示例。

假设 STUDENT 表有字段 (SId, SName, MajorId, GradYear)，DEPT 表有字段 (DId, DName)。

Q8 的输出将是：

![fig8-3](/images/chapter8/fig8-3.png)

查询 Q8 返回 `STUDENT` 和 `DEPT` 表的乘积：

`Q8=product(STUDENT,DEPT)`

图 1.1 的大学数据库中 `STUDENT` 表有 9 条记录，`DEPT` 表有 3 条记录。图 8.3 描绘了给定这些输入表时 Q8 的输出。输出表包含 27 条记录，每条记录都是学生记录与部门记录的每个配对。通常，如果 `STUDENT` 表有 N 条记录，`DEPT` 表有 M 条记录，那么输出表将包含 N×M 条记录（顺便说一句，这就是为什么该操作符被称为“乘积”的原因）。

查询 Q8 并没有特别的意义，因为它没有考虑到每个学生的专业。这种意义可以通过选择谓词来表达，如查询 Q9 和 图 8.4 所示：
**图 8.4 Q9 的查询树 (The query tree for Q9)**

```txt
          select  MajorId=DId
            |   
          product DEPT 
            |
          STUDENT  
```

`Q9=select(product(STUDENT,DEPT),MajorId=DId)`

这个查询的输出表只包含满足谓词的 `STUDENT` 和 `DEPT` 记录的组合。因此，在 27 种可能的组合中，只有那些学生的专业 ID 与部门 ID 相同的组合会保留下来——换句话说，结果表将由学生及其所属专业的部门组成。输出表现在有 9 条记录，而不是 27 条。

## 8.2 扫描 (Scans)

**扫描 (Scan)** 是一个对象，它表示关系代数查询的输出。SimpleDB 中的扫描实现了 **`Scan` 接口**；参见 图 8.5。`Scan` 方法是 `TableScan` 方法的一个子集，并且它们具有相同的行为。这种对应关系不足为奇——查询的输出是一个表，因此查询和表的访问方式相同是很自然的。

例如，考虑 图 8.6 中的 `printNameAndGradYear` 方法。

**图 8.5 SimpleDB `Scan` 接口 (The SimpleDB Scan interface)**

```java
public interface Scan {
    // 将扫描器定位到第一个记录之前
    public void beforeFirst();
    // 移动到下一条记录，如果存在则返回 true
    public boolean next();
    // 获取指定字段的整数值
    public int getInt(String fldname);
    // 获取指定字段的字符串值
    public String getString(String fldname);
    // 获取指定字段的 Constant 值（通用类型）
    public Constant getVal(String fldname);
    // 检查扫描结果是否包含指定字段
    public boolean hasField(String fldname);
    // 关闭扫描器，释放资源
    public void close();
}
```

**图 8.6 打印扫描记录的姓名和毕业年份 (Printing the name and graduation year of a scan’s records)**

```java
public static void printNameAndGradyear(Scan s) {
    s.beforeFirst(); // 将扫描器定位到第一个记录之前
    while (s.next()) { // 遍历扫描器的所有记录
        String sname = s.getString("sname"); // 获取 sname 字段的值
        int gradyr = s.getInt("gradyear");   // 获取 gradyear 字段的值
        System.out.println(sname + "\t" + gradyr); // 打印姓名和毕业年份
    }
    s.close(); // 关闭扫描器
}
```

此示例的重点是，该方法不知道扫描代表什么查询（或表）。它可能代表 `STUDENT` 表，或者可能是一个选择特定专业学生或与爱因斯坦教授一起上课的学生的查询。唯一的要求是扫描的输出表包含学生姓名和毕业年份。

一个 `Scan` 对象对应于查询树中的一个节点。SimpleDB 为每个关系操作符包含一个 `Scan` 类。这些类的对象构成了查询树的内部节点，而 `TableScan` 对象表示树的叶子。图 8.7 展示了 SimpleDB 支持的表和三个基本操作符的扫描构造函数。

**图 8.7 SimpleDB 实现 `Scan` 接口的构造函数 API (The API of the SimpleDB constructors that implement Scan)**

**`Scan` 接口**

- ```
  public TableScan(Transaction tx, String filename, Layout layout);
  ```

  - 创建一个 `TableScan`，用于访问存储在磁盘上的实际表。

- ```java
  public SelectScan(Scan s, Predicate pred);
  ```

  - 创建一个 `SelectScan`，它基于底层 `Scan` (`s`) 并应用一个谓词 (`pred`) 进行选择。

- ```java
  public ProjectScan(Scan s, List<String> fldlist);
  ```

  - 创建一个 `ProjectScan`，它基于底层 `Scan` (`s`) 并只选择指定的字段列表 (`fldlist`)。

- ```java
  public ProductScan(Scan s1, Scan s2);
  ```

  - 创建一个 `ProductScan`，它将两个底层 `Scan` (`s1` 和 `s2`) 进行笛卡尔积操作。

`SelectScan` 构造函数接受两个参数：一个**底层扫描 (underlying scan)** 和一个谓词。底层扫描是选择操作符的输入。由于 `Scan` 是一个接口，`SelectScan` 对象不知道其输入是存储的表还是另一个查询的输出。这种情况对应于关系操作符的输入可以是任何表或查询的事实。

传递给 `SelectScan` 构造函数的选择谓词的类型是 `Predicate`。8.6 节讨论了 SimpleDB 如何处理谓词的细节；在此之前，我将对此问题保持模糊。

查询树是通过组合扫描构建的。树的每个节点都将有一个扫描。例如，图 8.8 给出了图 8.2 查询树的 SimpleDB 代码（省略了选择谓词的细节）。`Scan` 变量 `s1`、`s2` 和 `s3` 各自对应于查询树中的一个节点。树是**自底向上**构建的：首先创建表扫描，然后是选择扫描，最后是投影扫描。变量 `s3` 包含了最终的查询树。`while` 循环遍历 `s3`，打印每个学生姓名。

**图 8.8 将图 8.2 表示为扫描 (Representing Fig. 8.2 as a scan)**

```java
// 假设 db 已初始化
Transaction tx = db.newTx();        // 开启一个新事务
MetadataMgr mdm = db.MetadataMgr(); // 获取元数据管理器

// the STUDENT node (STUDENT 节点)
// 获取 "student" 表的布局
Layout layout = mdm.getLayout("student", tx);
// 创建一个 TableScan 来访问 "student" 表
Scan s1 = new TableScan(tx, "student", layout);

// the Select node (Select 节点)
// 假设 Predicate 对象 pred 已经创建，其谓词是 "majorid=10"
Predicate pred = /* new Predicate(...) */; // majorid=10
// 创建一个 SelectScan，以 s1 为输入，并应用 pred 谓词
Scan s2 = new SelectScan(s1, pred);

// the Project node (Project 节点)
// 定义要投影的字段列表，这里是 "sname"
List<String> c = Arrays.asList("sname");
// 创建一个 ProjectScan，以 s2 为输入，并只选择 "sname" 字段
Scan s3 = new ProjectScan(s2, c);

// 遍历最终的查询结果并打印
s3.beforeFirst(); // 定位到第一条记录之前
while (s3.next()) { // 遍历所有记录
    System.out.println(s3.getString("sname")); // 打印学生姓名
}
s3.close(); // 关闭扫描器
// 注意：原图中此处的 s3.close() 和 System.out.println() 位置有误，
// getString 应该在 next() 内部调用，且 close() 应该在遍历结束后。
// 上述代码已修正为更合理的逻辑。
```

**图 8.9 将图 8.4 表示为扫描 (Representing Fig. 8.4 as a scan)**

```java
// 假设 db 已初始化
Transaction tx = db.newTx();        // 开启一个新事务
MetadataMgr mdm = db.MetadataMgr(); // 获取元数据管理器

// the STUDENT node (STUDENT 节点)
// 获取 "student" 表的布局
Layout layout1 = mdm.getLayout("student", tx);
// 创建 TableScan 来访问 "student" 表
Scan s1 = new TableScan(tx, "student", layout1);

// the DEPT node (DEPT 节点)
// 获取 "dept" 表的布局
Layout layout2 = mdm.getLayout("dept", tx);
// 创建 TableScan 来访问 "dept" 表
Scan s2 = new TableScan(tx, "dept", layout2);

// the Product node (Product 节点)
// 创建 ProductScan，将 s1 和 s2 进行笛卡尔积操作
Scan s3 = new ProductScan(s1, s2);

// the Select node (Select 节点)
// 假设 Predicate 对象 pred 已经创建，其谓词是 "majorid=did"
Predicate pred = /* new Predicate(...) */; // majorid=did
// 创建 SelectScan，以 s3 为输入，并应用 pred 谓词
Scan s4 = new SelectScan(s3, pred);

// 遍历最终的查询结果并打印
s4.beforeFirst(); // 定位到第一条记录之前
while (s4.next()) { // 遍历所有记录
    // 打印学生姓名、毕业年份和部门名称
    System.out.println(s4.getString("sname") + ", " + 
                       s4.getString("gradyear") + ", " + 
                       s4.getString("dname"));
}
s4.close(); // 关闭扫描器
```

代码包含四个扫描，因为查询树有四个节点。变量 `s4` 包含了最终的查询树。请注意 `while` 循环与之前的代码几乎相同。为了节省空间，循环只打印每个输出记录的三个字段值，但可以很容易地修改以包含所有六个字段值。

## 8.3 更新扫描 (Update Scans)

查询定义了一个**虚拟表 (virtual table)**。`Scan` 接口有允许客户端从这个虚拟表读取数据的方法，但不能更新它。并非所有扫描都可以有意义地更新。如果扫描中的每个输出记录 `r` 在底层数据库表中都有一个对应的记录 `r0`，则该扫描是**可更新的 (updatable)**。在这种情况下，对 `r` 的更新被定义为对 `r0` 的更新。

可更新扫描支持 `UpdateScan` 接口；参见 图 8.10。该接口的前五个方法是基本的修改操作。另外两个方法涉及扫描当前记录底层存储记录的标识符。`getRid` 方法返回此标识符，`moveToRid` 将扫描定位到指定的存储记录。

**图 8.10 SimpleDB `UpdateScan` 接口 (The SimpleDB UpdateScan interface)**

```java
public interface UpdateScan extends Scan {
    // 设置指定字段的整数值
    public void setInt(String fldname, int val);
    // 设置指定字段的字符串值
    public void setString(String fldname, String val);
    // 设置指定字段的 Constant 值（通用类型）
    public void setVal(String fldname, Constant val);
    // 在当前位置插入一条新记录
    public void insert();
    // 删除当前记录
    public void delete();
    // 获取当前记录的记录 ID (Record ID)
    public RID getRid();
    // 将扫描器移动到指定的记录 ID
    public void moveToRid(RID rid);
}
```

SimpleDB 中只有两个类实现了 `UpdateScan`：`TableScan` 和 `SelectScan`。作为它们使用的一个示例，考虑 图 8.11。

**图 8.11 将 SQL UPDATE 语句表示为更新扫描。(a) 修改第 53 节学生成绩的 SQL 语句，(b) 对应语句的 SimpleDB 代码 (Representing an SQL update statement as an update scan. (a) An SQL statement to modify the grades of students in section 53, (b) the SimpleDB code corresponding to the statement)**

(a) SQL 语句：

```sql
UPDATE ENROLL
SET Grade = 'C'
WHERE SectionId = 53;
```

(b) SimpleDB 代码：

```sql
// 假设 db 已初始化
Transaction tx = db.newTx();        // 开启一个新事务
MetadataMgr mdm = db.MetadataMgr(); // 获取元数据管理器

// 获取 "enroll" 表的布局
Layout layout = mdm.getLayout("enroll", tx);
// 创建一个 TableScan 来访问 "enroll" 表
Scan s1 = new TableScan(tx, "enroll", layout);

// 假设 Predicate 对象 pred 已经创建，其谓词是 "SectionId=53"
Predicate pred = /* new Predicate(...) */; // SectionId=53
// 创建一个 SelectScan，以 s1 为输入，并应用 pred 谓词。
// 注意这里强制转换为 UpdateScan，因为需要进行更新操作。
UpdateScan s2 = new SelectScan(s1, pred);

// 遍历所有满足条件（SectionId=53）的记录
s2.beforeFirst(); // 定位到第一条记录之前
while (s2.next()) {
    s2.setString("grade", "C"); // 将 "grade" 字段的值设置为 "C"
}
s2.close(); // 关闭扫描器
tx.commit(); // 提交事务
```

(a) 部分显示了一个 SQL 语句，它更改了选修第 53 节课的每个学生的成绩，(b) 部分给出了实现此语句的代码。该代码首先创建了一个针对第 53 节所有注册记录的选择扫描；然后它遍历扫描，更改每条记录的成绩。

变量 `s2` 调用 `setString` 方法，因此它必须被声明为 `UpdateScan`。另一方面，`SelectScan` 构造函数的第一个参数是一个 `Scan`，这意味着它不需要被声明为 `UpdateScan`。相反，`s2` 的 `setString` 方法的代码将把其底层扫描（即 `s1`）强制转换为 `UpdateScan`；如果该扫描不可更新，则会抛出 `ClassCastException`。
