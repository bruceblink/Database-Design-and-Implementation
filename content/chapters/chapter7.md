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
