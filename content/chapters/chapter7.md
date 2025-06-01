---
typora-root-url: ./..\..\public
---

# 元数据管理(Metadata Management)

上一章探讨了记录管理器如何在文件中存储记录。然而，正如您所看到的，文件本身是无用的；记录管理器还需要知道记录的**布局 (layout)**，以便“解码”每个块的内容。布局就是**元数据 (metadata)**的一个例子。本章将探讨数据库引擎支持的元数据类型、它们的用途和功能，以及引擎如何在数据库中存储元数据。

## 7.1 元数据管理器 (The Metadata Manager)

**元数据 (Metadata)** 是描述数据库的数据。数据库引擎维护着各种各样的元数据。例如：

- **表元数据 (Table metadata)** 描述了表的记录结构，例如每个字段的长度、类型和偏移量。记录管理器使用的**布局 (layout)** 就是这种元数据的一个例子。
- **视图元数据 (View metadata)** 描述了每个视图的属性，例如其定义和创建者。这种元数据帮助查询规划器 (planner) 处理提及视图的查询。
- **索引元数据 (Index metadata)** 描述了在表上定义的索引（将在第 12 章讨论）。查询规划器使用这种元数据来判断查询是否可以使用索引进行评估。
- **统计元数据 (Statistical metadata)** 描述了每个表的大小及其字段值的分布。查询优化器 (query optimizer) 使用这种元数据来估计查询的成本。

前三类元数据在创建表、视图或索引时生成。统计元数据在每次数据库更新时生成。**元数据管理器 (metadata manager)** 是数据库引擎中存储和检索其元数据的组件。SimpleDB 的元数据管理器由四个独立的管理器组成，对应于四种元数据类型。本章的其余部分将详细介绍这些管理器。

## 7.2 表元数据 (Table Metadata)

SimpleDB 的 **`TableMgr` 类** 管理表数据。它的 API 如 图 7.1 所示，由一个构造函数和两个方法组成。构造函数在系统启动期间只调用一次。`createTable` 方法以表名和模式作为参数；该方法计算记录偏移量并将所有这些信息保存在**目录 (catalog)** 中。`getLayout` 方法访问目录，提取指定表的元数据，并返回一个包含该元数据的 `Layout` 对象。

**图 7.1 SimpleDB 表管理器的 API (The API for the SimpleDB table manager)**

**`TableMgr` 类 (TableMgr Class)**

- `public TableMgr(boolean isnew, Transaction tx)`: 构造函数。`isnew` 参数指示数据库是否为新创建的；`tx` 是当前事务。
- `public void createTable(String tblname, Schema sch, Transaction tx)`: 创建一个表。`tblname` 是表名，`sch` 是表的模式，`tx` 是当前事务。
- `public Layout getLayout(String tblname, Transaction tx)`: 获取指定表的布局信息。`tblname` 是表名，`tx` 是当前事务。

图 7.2 中的 `TableMgrTest` 类演示了这些方法。它首先定义了一个包含名为“A”的整数字段和名为“B”的字符串字段的模式。然后它调用 `createTable` 来创建一个名为“MyTable”的表，该表具有此模式。接着，代码调用 `getLayout` 来检索计算出的布局。

**图 7.2 使用表管理器方法 (Using the table manager methods)**

```java
public class TableMgrTest {
    public static void main(String[] args) throws Exception {
        SimpleDB db = new SimpleDB("tblmgrtest", 400, 8); // 初始化SimpleDB实例
        Transaction tx = db.newTx(); // 开启一个新事务

        TableMgr tm = new TableMgr(true, tx); // 创建TableMgr实例，true表示数据库是新的

        Schema sch = new Schema(); // 创建一个Schema对象
        sch.addIntField("A"); // 添加一个名为"A"的整数字段
        sch.addStringField("B", 9); // 添加一个名为"B"的字符串字段，长度为9

        tm.createTable("MyTable", sch, tx); // 创建名为"MyTable"的表，使用定义的schema和事务

        Layout layout = tm.getLayout("MyTable", tx); // 获取"MyTable"的布局信息
        int size = layout.slotSize(); // 获取记录槽的大小
        Schema sch2 = layout.schema(); // 获取布局中的schema

        System.out.println("MyTable has slot size " + size); // 打印槽大小
        System.out.println("Its fields are:");
        for (String fldname : sch2.fields()) { // 遍历表的字段
            String type;
            if (sch2.type(fldname) == INTEGER) // 判断字段类型是否为INTEGER
                type = "int";
            else { // 如果是VARCHAR
                int strlen = sch2.length(fldname); // 获取字符串长度
                type = "varchar(" + strlen + ")"; // 构建varchar类型字符串
            }
            System.out.println(fldname + ": " + type); // 打印字段名和类型
        }
        tx.commit(); // 提交事务
    }
}
```

元数据管理器将其元数据保存在数据库中称为**目录 (catalog)** 的部分。但是它如何实现目录呢？最常见的策略是数据库引擎将目录信息存储在数据库表中。SimpleDB 使用两个表来保存其表元数据：**`tblcat` 表** 存储每个表的特定元数据，而 **`fldcat` 表** 存储每个表的每个字段的特定元数据。

这些表具有以下字段：

```sql
tblcat(TblName, SlotSize)
fldcat(TblName, FldName, Type, Length, Offset)
```

`tblcat` 中每有一个数据库表就有一条记录，`fldcat` 中每有一个表的字段就有一条记录。`SlotSize` 字段表示由 `Layout` 计算出的槽的长度（以字节为单位）。`Length` 字段表示字段的长度（以字符为单位），如其表的模式中指定的那样。例如，图 1.1 中大学数据库对应的目录表如 图 7.3 所示。请注意表的布局信息是如何被“扁平化”为一系列 `fldcat` 记录的。表 `fldcat` 中的 `Type` 值包含 4 和 12；这些值是 JDBC 类 `Types` 中定义的 `INTEGER` 和 `VARCHAR` 类型的代码。

**tblcat**

| **TblName** | **SlotSize** |
| ----------- | ------------ |
| student     | 30           |
| dept        | 20           |
| course      | 36           |
| section     | 28           |
| enroll      | 22           |

**fldcat**

| **TblName** | **FldName** | **Type** | **Length** | **Offset** |
| ----------- | ----------- | -------- | ---------- | ---------- |
| student     | sid         | 4        | 0          | 4          |
| student     | sname       | 12       | 10         | 8          |
| student     | majorid     | 4        | 0          | 22         |
| student     | gradyear    | 4        | 0          | 26         |
| dept        | did         | 4        | 0          | 4          |
| dept        | dname       | 12       | 8          | 8          |
| course      | cid         | 4        | 0          | 4          |
| course      | title       | 12       | 20         | 8          |
| course      | deptid      | 4        | 0          | 32         |
| section     | sectid      | 4        | 0          | 4          |
| section     | courseid    | 4        | 0          | 8          |
| section     | prof        | 12       | 8          | 12         |
| section     | year        | 4        | 0          | 24         |
| enroll      | eid         | 4        | 0          | 4          |
| enroll      | studentid   | 4        | 0          | 8          |
| enroll      | sectionid   | 4        | 0          | 12         |
| enroll      | grade       | 12       | 2          | 16         |

**图 7.3 大学数据库的目录表 (Catalog tables for the university database)**

目录表可以像任何用户创建的表一样访问。例如，图 7.4 中的 SQL 查询检索 `STUDENT` 表中所有字段的名称和长度。

```sql
select FldName, Length from fldcat
where TblName = 'student';
```

**图 7.4 检索元数据的 SQL 查询 (An SQL query to retrieve metadata)**
目录表甚至包含描述其自身元数据的记录。这些记录未在 图 7.3 中显示。相反，练习 7.1 要求您确定它们。图 7.5 显示了 `CatalogTest` 类的代码，该代码打印每个表的记录长度和每个字段的偏移量。如果您运行该代码，您将看到目录表的元数据也会被打印出来。

```java
public class CatalogTest {
    public static void main(String[] args) throws Exception {
        SimpleDB db = new SimpleDB("catalogtest", 400, 8); // 初始化SimpleDB实例
        Transaction tx = db.newTx(); // 开启一个新事务

        TableMgr tm = new TableMgr(true, tx); // 创建TableMgr实例，true表示数据库是新的

        Schema sch = new Schema(); // 创建一个Schema对象
        sch.addIntField("A"); // 添加一个名为"A"的整数字段
        sch.addStringField("B", 9); // 添加一个名为"B"的字符串字段，长度为9
        tm.createTable("MyTable", sch, tx); // 创建名为"MyTable"的表

        System.out.println("All tables and their lengths:");
        Layout layout = tm.getLayout("tblcat", tx); // 获取tblcat表的布局
        TableScan ts = new TableScan(tx, "tblcat", layout); // 创建tblcat表的TableScan

        while (ts.next()) { // 遍历tblcat表的记录
            String tname = ts.getString("tblname"); // 获取表名
            int size = ts.getInt("slotsize"); // 获取槽大小
            System.out.println(tname + " " + size); // 打印表名和槽大小
        }
        ts.close(); // 关闭TableScan

        System.out.println("All fields and their offsets:");
        layout = tm.getLayout("fldcat", tx); // 获取fldcat表的布局
        ts = new TableScan(tx, "fldcat", layout); // 创建fldcat表的TableScan

        while (ts.next()) { // 遍历fldcat表的记录
            String tname = ts.getString("tblname"); // 获取表名
            String fname = ts.getString("fldname"); // 获取字段名
            int offset = ts.getInt("offset"); // 获取字段偏移量
            System.out.println(tname + " " + fname + " " + offset); // 打印表名、字段名和偏移量
        }
        ts.close(); // 关闭TableScan
    }
}
```

**图 7.5 使用表扫描读取目录表 (Using table scans to read the catalog tables)**

图 7.6 给出了 `TableMgr` 的代码。构造函数为目录表 `tblcat` 和 `fldcat` 创建模式并计算它们的 `Layout` 对象。如果数据库是新的，它还会创建这两个目录表。

`createTable` 方法使用表扫描向目录中插入记录。它为表在 `tblcat` 中插入一条记录，并为表的每个字段在 `fldcat` 中插入一条记录。

`getLayout` 方法打开两个目录表的表扫描，并扫描它们以查找与指定表名对应的记录。然后它从这些记录中构建请求的 `Layout` 对象。

```java
public class TableMgr {
    // 定义常量：表名或字段名的最大长度为 16
    public static final int MAX_NAME = 16; 
    
    // 用于 tblcat 和 fldcat 这两个元数据表的布局对象
    private Layout tcatLayout, fcatLayout; 

    // 构造函数
    // isNew: 标记数据库是否是新创建的
    // tx: 当前的事务
    public TableMgr(boolean isNew, Transaction tx) {
        // 定义 tblcat 表的 Schema (模式)
        Schema tcatSchema = new Schema();
        tcatSchema.addStringField("tblname", MAX_NAME); // 表名 (字符串类型，最大长度 MAX_NAME)
        tcatSchema.addIntField("slotsize");            // 槽大小 (整数类型)
        tcatLayout = new Layout(tcatSchema);           // 根据 Schema 计算 tblcat 的布局

        // 定义 fldcat 表的 Schema (模式)
        Schema fcatSchema = new Schema();
        fcatSchema.addStringField("tblname", MAX_NAME); // 表名 (字符串类型，最大长度 MAX_NAME)
        fcatSchema.addStringField("fldname", MAX_NAME); // 字段名 (字符串类型，最大长度 MAX_NAME)
        fcatSchema.addIntField("type");                 // 字段类型 (整数类型，通常对应 JDBC Types 常量)
        fcatSchema.addIntField("length");               // 字段长度 (整数类型，对字符串为字符数，对整数为0)
        fcatSchema.addIntField("offset");               // 字段在槽中的偏移量 (整数类型)
        fcatLayout = new Layout(fcatSchema);           // 根据 Schema 计算 fldcat 的布局

        // 如果数据库是新创建的，则创建这两个存储元数据的“目录表”
        if (isNew) {
            createTable("tblcat", tcatSchema, tx); // 创建 tblcat 表
            createTable("fldcat", fcatSchema, tx); // 创建 fldcat 表
        }
    }

    // 创建表的方法
    // tblname: 要创建的表名
    // sch: 要创建的表的 Schema (模式)
    // tx: 当前的事务
    public void createTable(String tblname, Schema sch, Transaction tx) {
        Layout layout = new Layout(sch); // 根据传入的 Schema 计算新表的物理布局

        // 将新表的元数据插入到 tblcat 表中
        TableScan tcat = new TableScan(tx, "tblcat", tcatLayout); // 打开 tblcat 表的扫描器
        tcat.insert();                                        // 插入一条新记录
        tcat.setString("tblname", tblname);                   // 设置表名为新表的名称
        tcat.setInt("slotsize", layout.slotSize());           // 设置槽大小为新表计算出的槽大小
        tcat.close();                                         // 关闭扫描器

        // 为新表的每个字段插入一条记录到 fldcat 表中
        TableScan fcat = new TableScan(tx, "fldcat", fcatLayout); // 打开 fldcat 表的扫描器
        for (String fldname : sch.fields()) { // 遍历新表 Schema 中的所有字段
            fcat.insert();                               // 插入一条新记录
            fcat.setString("tblname", tblname);          // 设置表名为新表的名称
            fcat.setString("fldname", fldname);          // 设置字段名为当前字段的名称
            fcat.setInt("type", sch.type(fldname));      // 设置字段类型
            fcat.setInt("length", sch.length(fldname));  // 设置字段长度
            fcat.setInt("offset", layout.offset(fldname)); // 设置字段偏移量
        }
        fcat.close(); // 关闭扫描器
    }

    // 获取表的布局信息
    // tblname: 要获取布局的表名
    // tx: 当前的事务
    public Layout getLayout(String tblname, Transaction tx) {
        int size = -1; // 初始化槽大小为 -1

        // 从 tblcat 表中查找指定表的槽大小
        TableScan tcat = new TableScan(tx, "tblcat", tcatLayout);
        while (tcat.next()) { // 遍历 tblcat 表的记录
            if (tcat.getString("tblname").equals(tblname)) { // 如果找到匹配的表名
                size = tcat.getInt("slotsize"); // 获取槽大小
                break; // 找到后即可退出循环
            }
        }
        tcat.close(); // 关闭扫描器

        Schema sch = new Schema();                         // 创建一个新的 Schema 对象用于重建表的模式
        Map<String, Integer> offsets = new HashMap<String, Integer>(); // 创建一个 Map 用于存储字段偏移量

        // 从 fldcat 表中查找指定表的字段信息，并重建 Schema 和偏移量 Map
        TableScan fcat = new TableScan(tx, "fldcat", fcatLayout);
        while (fcat.next()) { // 遍历 fldcat 表的记录
            if (fcat.getString("tblname").equals(tblname)) { // 如果找到匹配的表名
                String fldname = fcat.getString("fldname"); // 获取字段名
                int fldtype = fcat.getInt("type");           // 获取字段类型
                int fldlen = fcat.getInt("length");         // 获取字段长度
                int offset = fcat.getInt("offset");         // 获取字段偏移量
                
                offsets.put(fldname, offset);             // 将字段名和偏移量存入 Map
                sch.addField(fldname, fldtype, fldlen);   // 将字段信息添加到重建的 Schema 中
            }
        }
        fcat.close(); // 关闭扫描器

        // 返回重建的 Layout 对象
        return new Layout(sch, offsets, size);
    }
}
```

**图 7.6 `TableMgr` 类的代码 (The code for TableMgr)**

## 7.3 视图元数据 (View Metadata)

**视图 (View)** 是一种表，其记录是根据查询动态计算的。该查询被称为视图的**定义 (definition)**，并在创建视图时指定。元数据管理器存储每个新创建视图的定义，并在请求时检索其定义。

SimpleDB 的 **`ViewMgr` 类** 负责此职责。该类将视图定义存储在**目录表 `viewcat`** 中，每个视图对应一条记录。该表具有以下字段：

```txt
viewcat(ViewName, ViewDef)
```

**图 7.7 SimpleDB `ViewMgr` 类的代码 (The code for the SimpleDB class ViewMgr)**

```java
class ViewMgr {
    // 视图定义的最大字符数
    private static final int MAX_VIEWDEF = 100; 
    // 对 TableMgr 的引用，用于访问表元数据
    TableMgr tblMgr; 

    // 构造函数
    // isNew: 标记数据库是否是新创建的
    // tblMgr: TableMgr 实例
    // tx: 当前的事务
    public ViewMgr(boolean isNew, TableMgr tblMgr, Transaction tx) {
        this.tblMgr = tblMgr;
        // 如果数据库是新创建的，则创建 viewcat 表
        if (isNew) {
            Schema sch = new Schema();
            sch.addStringField("viewname", TableMgr.MAX_NAME); // 视图名（字符串类型，最大长度由 TableMgr.MAX_NAME 定义）
            sch.addStringField("viewdef", MAX_VIEWDEF);        // 视图定义（字符串类型，最大长度 MAX_VIEWDEF）
            tblMgr.createTable("viewcat", sch, tx);             // 使用 TableMgr 创建 viewcat 表
        }
    }

    // 创建视图的方法
    // vname: 视图名称
    // vdef: 视图的定义（SQL 查询字符串）
    // tx: 当前事务
    public void createView(String vname, String vdef, Transaction tx) {
        // 获取 viewcat 表的布局
        Layout layout = tblMgr.getLayout("viewcat", tx);
        // 打开 viewcat 表的扫描器
        TableScan ts = new TableScan(tx, "viewcat", layout);
        // 插入一条新记录
        ts.insert(); 
        // 设置视图名
        ts.setString("viewname", vname);
        // 设置视图定义
        ts.setString("viewdef", vdef);
        // 关闭扫描器
        ts.close();
    }

    // 获取视图定义的方法
    // vname: 要获取定义的视图名称
    // tx: 当前事务
    public String getViewDef(String vname, Transaction tx) {
        String result = null; // 用于存储查询结果的视图定义
        // 获取 viewcat 表的布局
        Layout layout = tblMgr.getLayout("viewcat", tx);
        // 打开 viewcat 表的扫描器
        TableScan ts = new TableScan(tx, "viewcat", layout);
        // 遍历 viewcat 表的记录
        while (ts.next()) {
            // 如果找到匹配的视图名
            if (ts.getString("viewname").equals(vname)) {
                result = ts.getString("viewdef"); // 获取视图定义
                break; // 找到后退出循环
            }
        }
        ts.close(); // 关闭扫描器
        return result; // 返回视图定义
    }
}
```

`ViewMgr` 的代码如 图 7.7 所示。它的构造函数在系统启动期间被调用，如果数据库是新的，则创建 `viewcat` 表。`createView` 和 `getViewDef` 方法都使用**表扫描 (table scan)** 来访问目录表——`createView` 在表中插入一条记录，而 `getViewDef` 遍历表以查找与指定视图名称对应的记录。

视图定义存储为 `varchar` 字符串，这意味着视图定义的长度受到相对较小的限制。当前 100 个字符的限制显然是完全不现实的，因为视图定义可能长达数千个字符。一个更好的选择是将 `ViewDef` 字段实现为 `clob` 类型，例如 `clob(9999)`。

## 7.4 统计元数据 (Statistical Metadata)

数据库系统管理的另一种元数据是关于数据库中每个表的**统计信息 (statistical information)**，例如它有多少条记录以及其字段值的分布。这些统计数据被查询规划器用于估算查询成本。经验表明，一套好的统计数据可以显著提高查询的执行时间。因此，商业元数据管理器倾向于维护详细、全面的统计数据，例如每个表中每个字段的值和范围直方图，以及不同表中字段之间的相关信息。

为简单起见，本节仅考虑以下三种统计信息：

- 每个表 T 使用的块数，记为 B(T)
- 每个表 T 中的记录数，记为 R(T)
- 对于表 T 的每个字段 F， T 中 F 值的**不同值的数量**，记为 V(T,F)

图 7.8 给出了一些大学数据库的示例统计数据。这些值对应于一所每年招收约 900 名学生，每年提供约 500 个课程班次的大学；该大学已保留此信息 50 年。图 7.8 中的值力求真实，不一定与从图 1.1 中计算出的值相符。相反，这些数字假设每个块能容纳 10 条 `STUDENT` 记录，每个块能容纳 20 条 `DEPT` 记录，依此类推。

查看 `STUDENT` 表的 V(T,F) 值。`SId` 是 `STUDENT` 的键意味着 V(STUDENT,SId)=45,000。赋值 V(STUDENT,SName)=44,960 意味着 45,000 名学生中有 40 名学生的名字重复。赋值 V(STUDENT,GradYear)=50 意味着过去 50 年中每年至少有一名学生毕业。赋值 V(STUDENT,MajorId)=40 意味着 40 个系中的每个系在某个时候至少有一个专业。

**图 7.8 大学数据库的示例统计数据 (Example statistics about the university database)**

| **T**   | **B(T)** | **R(T)**  | **V(T,F)**             |
| ------- | -------- | --------- | ---------------------- |
| STUDENT | 4,500    | 45,000    | 45,000 for F=SId       |
|         |          |           | 44,960 for F=SName     |
|         |          |           | 50 for F=GradYear      |
|         |          |           | 40 for F=MajorId       |
| DEPT    | 2        | 40        | 40 for F=DId, DName    |
| COURSE  | 25       | 500       | 500 for F=CId, Title   |
|         |          |           | 40 for F=DeptId        |
| SECTION | 2,500    | 25,000    | 25,000 for F=SectId    |
|         |          |           | 500 for F=CourseId     |
|         |          |           | 250 for F=Prof         |
|         |          |           | 50 for F=YearOffered   |
| ENROLL  | 50,000   | 1,500,000 | 1,500,000 for F=EId    |
|         |          |           | 25,000 for F=SectionId |
|         |          |           | 45,000 for F=StudentId |
|         |          |           | 14 for F=Grade         |

**图 7.9 SimpleDB 表统计信息的 API (The API for SimpleDB table statistics)**

**`StatMgr` 类 (StatMgr Class)**

- `public StatMgr(TableMgr tm, Transaction tx)`: 构造函数，创建一个 `StatMgr` 对象。
- `public StatInfo getStatInfo(String tblname, Layout lo, Transaction tx)`: 获取指定表的统计信息，返回一个 `StatInfo` 对象。

**`StatInfo` 类 (StatInfo Class)**

- `public int blocksAccessed()`: 返回表使用的块数（即 B(T)）。
- `public int recordsOutput()`: 返回表中的记录数（即 R(T)）。
- `public int distinctValues(String fldname)`: 返回指定字段的不同值的数量（即 V(T,F)）。

SimpleDB 的 **`StatMgr` 类** 管理这些统计信息。数据库引擎持有一个 `StatMgr` 对象。该对象有一个 `getStatInfo` 方法，它为指定表返回一个 `StatInfo` 对象。`StatInfo` 对象保存该表的统计数据，并具有 `blocksAccessed`、`recordsOutput` 和 `distinctValues` 方法，它们分别实现了统计函数 B(T)、R(T) 和 V(T,F)。这些类的 API 如 图 7.9 所示。

**图 7.10 获取和打印表统计信息 (Obtaining and printing statistics about a table)**

```java
// 假设 SimpleDB db = ...; TableMgr tblmgr = ...; 已初始化

SimpleDB db = /* ... */; // 假设 SimpleDB 实例已创建
Transaction tx = db.newTx(); // 开启一个新事务

TableMgr tblmgr = /* ... */; // 假设 TableMgr 实例已创建

StatMgr statmgr = new StatMgr(tblmgr, tx); // 创建 StatMgr 实例
Layout layout = tblmgr.getLayout("student", tx); // 获取 "student" 表的布局

StatInfo si = statmgr.getStatInfo("student", layout, tx); // 获取 "student" 表的统计信息

System.out.println(si.blocksAccessed() + " " + // 打印 B(STUDENT)
                   si.recordsOutput() + " " +   // 打印 R(STUDENT)
                   si.distinctValues("majorid")); // 打印 V(STUDENT, MajorId)

tx.commit(); // 提交事务
```

图 7.10 中的代码片段展示了这些方法的典型用法。此代码获取 `STUDENT` 表的统计信息，并打印 B(STUDENT)、R(STUDENT) 和 V(STUDENT,MajorId) 的值。

数据库引擎可以通过两种方式管理统计元数据。一种是将信息存储在数据库目录中，并在数据库更改时更新它。另一种是将信息存储在内存中，在引擎初始化时计算它。

第一种方法对应于创建两个新的目录表，称为 tblstats 和 fldstats，它们具有以下字段：

tblstats(TblName, NumBlocks, NumRecords)

fldstats(TblName, FldName, NumValues)

`tblstats` 表将为每个表 T 包含一条记录，其中包含 B(T) 和 R(T) 的值。`fldstats` 表将为每个表 T 的每个字段 F 包含一条记录，其中包含 V(T,F) 的值。这种方法的问题在于保持统计数据最新所需的成本。每次调用 `insert`、`delete`、`setInt` 和 `setString` 都可能需要更新这些表。还需要额外的磁盘访问来将修改后的页面写入磁盘。此外，并发性会降低——每次更新表 T 都会对包含 T 统计记录的块进行排他锁 (xlock)，这将迫使需要读取 T 统计数据的事务（以及在同一页面上有记录的其他表的统计数据）等待。

解决这个问题的一个可行方案是允许事务在不获取共享锁 (slocks) 的情况下读取统计数据，就像第 5.4.7 节中读未提交 (read-uncommitted) 隔离级别一样。准确性损失是可以容忍的，因为数据库系统使用这些统计数据来比较查询计划的估计执行时间。因此，统计数据不需要非常精确，只要它们产生的估计是合理的即可。

第二种实现策略是抛弃目录表，直接将统计数据存储在内存中。统计数据相对较小，应该很容易适应主内存。唯一的问题是每次服务器启动时都需要从头开始计算统计数据。这种计算需要扫描数据库中的每个表，以计数记录、块和已见值的数量。

如果数据库不是太大，这种计算不会过多地延迟系统启动。

这种主内存策略有两种处理数据库更新的选项。第一个选项是像以前一样，每次数据库更新都更新统计数据。第二个选项是让统计数据不更新，但每隔一段时间从头开始重新计算它们。这第二个选项再次依赖于不需要精确统计信息的事实，因此在刷新它们之前让统计数据稍微过时是可以容忍的。

SimpleDB 采用了第二种方法的第二个选项。`StatMgr` 类维护一个名为 `tableStats` 的变量，其中包含每个表的成本信息。该类有一个公共方法 `statInfo`，它返回指定表的成本值，以及私有方法 `refreshStatistics` 和 `refreshTableStats` 来重新计算成本值。该类的代码如 图 7.11 所示。

`StatMgr` 类维护一个计数器，每次调用 `statInfo` 时都会递增。如果计数器达到特定值（此处为 100），则调用 `refreshStatistics` 以重新计算所有表的成本值。如果对没有已知值的表调用 `statInfo`，则调用 `refreshTableStats` 来计算该表的统计数据。

`refreshStatistics` 的代码遍历 `tblcat` 表。循环体提取表名并调用 `refreshTableStats` 来计算该表的统计数据。`refreshTableStats` 方法遍历该表的内容，计数记录，并调用 `size` 来确定使用的块数。为简单起见，该方法不计数字段值。相反，`StatInfo` 对象根据其表中的记录数，对字段的不同值的数量进行大胆猜测。

**图 7.11 SimpleDB `StatMgr` 类的代码 (The code for the SimpleDB class StatMgr)**

```java
class StatMgr {
    private TableMgr tblMgr;             // TableMgr 的引用，用于获取表布局
    private Map<String, StatInfo> tablestats; // 存储每个表的统计信息（表名 -> StatInfo 对象）
    private int numcalls;                // 计数器，记录 getStatInfo 被调用的次数

    // 构造函数
    // tblMgr: TableMgr 实例
    // tx: 当前事务
    public StatMgr(TableMgr tblMgr, Transaction tx) {
        this.tblMgr = tblMgr;
        refreshStatistics(tx); // 构造时立即刷新所有表的统计信息
    }

    // 获取表的统计信息
    // tblname: 表名
    // layout: 表的布局
    // tx: 当前事务
    public synchronized StatInfo getStatInfo(String tblname, Layout layout, Transaction tx) {
        numcalls++; // 每次调用增加计数器
        if (numcalls > 100) { // 如果调用次数超过 100，则刷新所有统计信息
            refreshStatistics(tx);
        }
        StatInfo si = tablestats.get(tblname); // 尝试从缓存中获取统计信息
        if (si == null) { // 如果缓存中没有该表的统计信息
            si = calcTableStats(tblname, layout, tx); // 计算该表的统计信息
            tablestats.put(tblname, si); // 存储到缓存中
        }
        return si; // 返回统计信息
    }

    // 刷新所有表的统计信息
    private synchronized void refreshStatistics(Transaction tx) {
        tablestats = new HashMap<String, StatInfo>(); // 清空旧的统计信息缓存
        numcalls = 0; // 重置计数器
        Layout tcatlayout = tblMgr.getLayout("tblcat", tx); // 获取 tblcat 表的布局
        TableScan tcat = new TableScan(tx, "tblcat", tcatlayout); // 打开 tblcat 表的扫描器

        while (tcat.next()) { // 遍历 tblcat 表的记录
            String tblname = tcat.getString("tblname"); // 获取表名
            Layout layout = tblMgr.getLayout(tblname, tx); // 获取该表的布局
            StatInfo si = calcTableStats(tblname, layout, tx); // 计算该表的统计信息
            tablestats.put(tblname, si); // 存储到缓存中
        }
        tcat.close(); // 关闭扫描器
    }

    // 计算单个表的统计信息
    // tblname: 表名
    // layout: 表的布局
    // tx: 当前事务
    private synchronized StatInfo calcTableStats(String tblname, Layout layout, Transaction tx) {
        int numRecs = 0;   // 记录数
        int numblocks = 0; // 块数
        TableScan ts = new TableScan(tx, tblname, layout); // 打开表的扫描器
        while (ts.next()) { // 遍历表的记录
            numRecs++; // 记录数加一
            numblocks = ts.getRid().blockNumber() + 1; // 更新块数（取当前记录所在块号加一，因为块号从0开始）
        }
        ts.close(); // 关闭扫描器
        return new StatInfo(numblocks, numRecs); // 返回 StatInfo 对象
    }
}
```

`StatInfo` 类的代码如 图 7.12 所示。请注意，`distinctValues` 方法没有使用传入的字段值，因为它天真地假设任何字段的大约 1/3 的值是不同的。不用说，这个假设非常糟糕。练习 7.12 要求您纠正这种情况。

**图 7.12 SimpleDB `StatInfo` 类的代码 (The code for the SimpleDB class StatInfo)**

```java
public class StatInfo {
    private int numBlocks; // 块数
    private int numRecs;   // 记录数

    // 构造函数
    public StatInfo(int numblocks, int numrecs) {
        this.numBlocks = numblocks;
        this.numRecs = numrecs;
    }

    // 返回块数 (B(T))
    public int blocksAccessed() {
        return numBlocks;
    }

    // 返回记录数 (R(T))
    public int recordsOutput() {
        return numRecs;
    }

    // 返回字段的不同值的数量 (V(T,F))
    // 注意：这里的实现非常不准确，它没有实际计算不同值，而是基于记录数进行粗略猜测
    public int distinctValues(String fldname) {
        return 1 + (numRecs / 3); // 这非常不准确。
    }
}
```

## 7.5 索引元数据 (Index Metadata)

索引的元数据包括其名称、它索引的表名称以及其索引字段的列表。索引管理器是存储和检索此元数据的系统组件。SimpleDB 索引管理器由两个类组成：`IndexMgr` 和 `IndexInfo`。它们的 API 如 图 7.13 所示。

**图 7.13 SimpleDB 索引元数据的 API (The API for SimpleDB index metadata)**

**`IndexMgr` 类 (IndexMgr Class)**

- `public IndexMgr(boolean isnew, TableMgr tmgr, StatMgr smgr, Transaction tx)`: 构造函数，创建一个 `IndexMgr` 对象。
- `public createIndex(String iname, String tname, String fname, Transaction tx)`: 创建一个索引。`iname` 是索引名，`tname` 是被索引的表名，`fname` 是被索引的字段名。
- `public Map<String, IndexInfo> getIndexInfo(String tblname, Transaction tx)`: 获取指定表上所有索引的元数据，返回一个以索引字段为键的 `IndexInfo` 对象映射。

**`IndexInfo` 类 (IndexInfo Class)**

- `public IndexInfo(String iname, String tname, String fname, Transaction tx)`: 构造函数，创建一个 `IndexInfo` 对象。
- `public int blocksAccessed()`: 返回搜索索引所需的块访问次数（不是索引的大小）。
- `public int recordsOutput()`: 返回索引中的记录数。
- `public int distinctValues(String fldname)`: 返回被索引字段的不同值的数量。
- `public Index open()`: 打开索引（返回一个 `Index` 对象）。

索引的元数据包括其名称、被索引的表名称以及它所索引的字段。`IndexMgr` 方法 `createIndex` 将此元数据存储在目录中。`getIndexInfo` 方法检索指定表上所有索引的元数据。特别是，它返回一个以索引字段为键的 `IndexInfo` 对象映射。该映射的 `keyset` 方法告诉您该表中有哪些字段具有可用索引。`IndexInfo` 方法提供有关所选索引的统计信息，类似于 `StatInfo` 类。`blocksAccessed` 方法返回搜索索引所需的块访问次数（不是索引的大小）。`recordsOutput` 和 `distinctValues` 方法返回索引中的记录数和被索引字段的不同值的数量，这些值与被索引表中的值相同。

`IndexInfo` 对象还具有 `open` 方法，该方法返回索引对应的 `Index` 对象。`Index` 类包含搜索索引的方法，并将在第 12 章讨论。

**图 7.14 使用 SimpleDB 索引管理器 (Using the SimpleDB index manager)**

```java
// 假设 SimpleDB db = ...; Transaction tx = db.newTx(); 已初始化

SimpleDB db = /* ... */;      // 假设 SimpleDB 实例已创建
Transaction tx = db.newTx(); // 开启一个新事务

TableMgr tblmgr = /* ... */; // 假设 TableMgr 实例已创建
StatMgr statmgr = new StatMgr(tblmgr, tx); // 创建 StatMgr 实例

// 创建 IndexMgr 实例，true 表示数据库是新的（如果需要，将创建索引目录表）
IndexMgr idxmgr = new IndexMgr(true, tblmgr, statmgr, tx);

// 在 "student" 表的 "sid" 字段上创建名为 "sidIdx" 的索引
idxmgr.createIndex("sidIdx", "student", "sid", tx);
// 在 "student" 表的 "sname" 字段上创建名为 "snameIdx" 的索引
idxmgr.createIndex("snameIdx", "student", "sname", tx);

// 获取 "student" 表上所有索引的元数据
Map<String, IndexInfo> indexes = idxmgr.getIndexInfo("student", tx);

// 遍历每个索引的字段名，并打印其搜索成本
for (String fldname : indexes.keySet()) {
    IndexInfo ii = indexes.get(fldname);
    // 打印字段名和该索引的块访问成本
    System.out.println(fldname + "\t" + ii.blocksAccessed()); 
}
tx.commit(); // 提交事务
```

图 7.14 的代码片段说明了这些方法的用法。该代码在 `STUDENT` 表上创建了两个索引。然后，它检索它们的元数据，打印每个索引的名称和搜索成本。

图 7.15 给出了 `IndexMgr` 的代码。它将索引元数据存储在**目录表 `idxcat`** 中。该表为每个索引存储一条记录，包含三个字段：索引的名称、被索引的表名称以及被索引的字段名称。构造函数在系统启动期间被调用，如果数据库是新的，则创建此目录表。`createIndex` 和 `getIndexInfo` 方法的代码都很直接。这两个方法都在目录表上打开一个表扫描。`createIndex` 方法插入一条新记录。`getIndexInfo` 方法搜索表中具有指定表名的记录，并将它们插入到 `Map` 中。

**图 7.15 SimpleDB 索引管理器代码 (The code for the SimpleDB index manager)**

```java
public class IndexMgr {
    // 存储 idxcat 表的布局
    private Layout layout; 
    // 对 TableMgr 和 StatMgr 的引用
    private TableMgr tblmgr;
    private StatMgr statmgr;

    // 构造函数
    public IndexMgr(boolean isnew, TableMgr tblmgr, StatMgr statmgr, Transaction tx) {
        if (isnew) { // 如果数据库是新创建的
            Schema sch = new Schema();
            sch.addStringField("indexname", TableMgr.MAX_NAME); // 索引名
            sch.addStringField("tablename", TableMgr.MAX_NAME); // 被索引的表名
            sch.addStringField("fieldname", TableMgr.MAX_NAME); // 被索引的字段名
            tblmgr.createTable("idxcat", sch, tx); // 创建 idxcat 目录表
        }
        this.tblmgr = tblmgr;
        this.statmgr = statmgr;
        // 获取 idxcat 表的布局
        layout = tblmgr.getLayout("idxcat", tx); 
    }

    // 创建索引的方法
    public void createIndex(String idxname, String tblname, String fldname, Transaction tx) {
        TableScan ts = new TableScan(tx, "idxcat", layout); // 打开 idxcat 表的扫描器
        ts.insert();                                      // 插入新记录
        ts.setString("indexname", idxname);               // 设置索引名
        ts.setString("tablename", tblname);               // 设置被索引的表名
        ts.setString("fieldname", fldname);               // 设置被索引的字段名
        ts.close();                                       // 关闭扫描器
    }

    // 获取指定表上所有索引的信息
    public Map<String, IndexInfo> getIndexInfo(String tblname, Transaction tx) {
        Map<String, IndexInfo> result = new HashMap<String, IndexInfo>(); // 存储结果的 Map
        TableScan ts = new TableScan(tx, "idxcat", layout); // 打开 idxcat 表的扫描器
        while (ts.next()) { // 遍历 idxcat 表记录
            if (ts.getString("tablename").equals(tblname)) { // 如果找到匹配的表名
                String idxname = ts.getString("indexname"); // 获取索引名
                String fldname = ts.getString("fieldname"); // 获取字段名

                // 获取被索引表的布局和统计信息
                Layout tblLayout = tblmgr.getLayout(tblname, tx);
                StatInfo tblsi = statmgr.getStatInfo(tblname, tblLayout, tx);

                // 创建 IndexInfo 对象并将其放入结果 Map，以字段名为键
                IndexInfo ii = new IndexInfo(idxname, fldname, tblLayout.schema(), tx, tblsi);
                result.put(fldname, ii);
            }
        }
        ts.close(); // 关闭扫描器
        return result; // 返回包含索引信息的 Map
    }
}
```

`IndexInfo` 类的代码如 图 7.16 所示。构造函数接收索引的名称和被索引的字段，以及持有其关联表的布局和统计元数据的变量。这些元数据允许 `IndexInfo` 对象构建索引记录的模式并估计索引文件的大小。

`open` 方法通过将索引名称和模式传递给 `HashIndex` 构造函数来打开索引。`HashIndex` 类实现了静态哈希索引，并将在第 12 章讨论。要改用 B-树索引，请将此构造函数替换为被注释掉的那个。`blocksAccessed` 方法估计索引的搜索成本。它首先使用索引的 `Layout` 信息来确定每个索引记录的长度，并估计索引的每块记录数 (RPB) 和索引文件的大小。然后它调用索引特定的 `searchCost` 方法来计算该索引类型的块访问次数。`recordsOutput` 方法估计匹配搜索键的索引记录数。`distinctValues` 方法返回与被索引表中相同的值。

**图 7.16 SimpleDB `IndexInfo` 类的代码 (The code for the SimpleDB class IndexInfo)**

```java
public class IndexInfo {
    private String idxname, fldname; // 索引名，被索引字段名
    private Transaction tx;            // 事务对象
    private Schema tblSchema;         // 被索引表的 Schema
    private Layout idxLayout;         // 索引记录的布局
    private StatInfo si;              // 被索引表的统计信息

    // 构造函数
    public IndexInfo(String idxname, String fldname, Schema tblSchema, Transaction tx, StatInfo si) {
        this.idxname = idxname;
        this.fldname = fldname;
        this.tblSchema = tblSchema; // 保存表的 Schema
        this.tx = tx;
        this.idxLayout = createIdxLayout(); // 创建索引记录的布局
        this.si = si; // 保存表的统计信息
    }

    // 打开索引，返回 Index 对象
    public Index open() {
        // Schema sch = schema(); // 此行似乎未使用
        return new HashIndex(tx, idxname, idxLayout); // 返回一个 HashIndex 实例
        // return new BTreeIndex(tx, idxname, idxLayout); // 如果使用 B-Tree 索引，则使用此行
    }

    // 估计搜索索引所需的块访问次数
    public int blocksAccessed() {
        int rpb = tx.blockSize() / idxLayout.slotSize(); // 每块的记录数 (Records Per Block)
        int numblocks = si.recordsOutput() / rpb;       // 索引文件中的总块数 (基于表记录数和 RPB 估算)
        return HashIndex.searchCost(numblocks, rpb);     // 调用 HashIndex 的静态方法计算搜索成本
        // return BTreeIndex.searchCost(numblocks, rpb); // 如果使用 B-Tree 索引，则使用此行
    }

    // 估计匹配搜索键的记录数
    public int recordsOutput() {
        // 假设每个不同的字段值，索引平均指向的记录数
        return si.recordsOutput() / si.distinctValues(fldname); 
    }

    // 返回被索引字段的不同值的数量
    // 如果查询的是被索引字段本身，则返回 1（因为索引是针对特定值的）
    // 否则，返回表的统计信息中该字段的不同值数量
    public int distinctValues(String fname) {
        return fldname.equals(fname) ? 1 : si.distinctValues(fname);
    }

    // 创建索引记录的布局
    private Layout createIdxLayout() {
        Schema sch = new Schema();
        sch.addIntField("block"); // 索引记录中的块号字段
        sch.addIntField("id");    // 索引记录中的槽 ID 字段 (记录页中的槽号)

        // 根据被索引字段的类型，添加数据值字段
        if (tblSchema.type(fldname) == INTEGER) {
            sch.addIntField("dataval"); // 如果是整数，添加整数数据值字段
        } else {
            int fldlen = tblSchema.length(fldname);
            sch.addStringField("dataval", fldlen); // 如果是字符串，添加字符串数据值字段
        }
        return new Layout(sch); // 返回索引记录的布局
    }
}
```
