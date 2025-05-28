---
typora-root-url: ./..\..\public
---

# 第 3 章 磁盘和文件管理 (Chapter 3 Disk and File Management)

数据库引擎将其数据保存在磁盘和闪存驱动器等持久存储设备上。本章将探讨这些设备的特性，并考虑可以提高其速度和可靠性的技术（如 RAID）。本章还将考察操作系统提供的与这些设备交互的两个接口——块级接口和文件级接口——并提出一种最适合数据库系统的两种接口组合。最后，本章将详细研究 SimpleDB 文件管理器，学习其 API 和实现。

## 3.1 持久数据存储 (Persistent Data Storage)

数据库的内容必须持久保存，以便即使数据库系统或计算机宕机，数据也不会丢失。本节将介绍两种特别有用的硬件技术：硬盘驱动器和闪存驱动器。尽管闪存驱动器的重要性将随着技术的成熟而增加，但其普及程度尚不及硬盘驱动器。让我们从硬盘驱动器开始。

### 3.1.1 硬盘驱动器 (Disk Drives)

硬盘驱动器包含一个或多个**旋转盘片 (rotating platters)**。盘片上有**同心磁道 (concentric tracks)**，每个磁道由一系列字节组成。通过带有**读/写磁头 (read/write head)** 的**可移动臂 (movable arm)** 从盘片读取（和写入）字节。磁臂定位在所需磁道上，磁头可以在字节旋转通过其下方时读取（或写入）字节。图 3.1 描绘了单盘硬盘驱动器的俯视图。当然，此图并非按比例绘制，因为典型的盘片有数千个磁道。

![fig3-1](/images/chapter3/fig3-1.png)

现代硬盘驱动器通常有多个盘片。为了节省空间，盘片通常背靠背连接，形成一个看起来像双面盘片的东西；但在概念上，每个面仍然是一个独立的盘片。每个盘片都有自己的读/写磁头。这些磁头不能独立移动；相反，它们都连接到一个**单个执行器 (single actuator)**，该执行器同时将它们移动到每个盘片上的相同磁道。此外，一次只能有一个读/写磁头处于活动状态，因为到计算机的数据路径只有一个。图 3.2 描绘了多盘硬盘驱动器的侧视图。

![fig3-2](/images/chapter3/fig3-2.png)

硬盘驱动器的整体性能可以通过四个值来衡量：**容量 (capacity)**、**旋转速度 (rotation speed)**、**传输速率 (transfer rate)** 和**寻道时间 (seek time)**。

驱动器的**容量**是可以存储的字节数。该值取决于盘片数量、每个盘片的磁道数量以及每个磁道的字节数。鉴于盘片倾向于采用或多或少的标准尺寸，制造商主要通过增加盘片密度来增加容量，即通过在每个盘片上挤入更多磁道和每个磁道更多字节。现在，超过 40GB 的盘片容量已很常见。

**旋转速度**是盘片旋转的速率，通常以每分钟转数表示。典型速度范围为 5400 rpm 到 15,000 rpm。

**传输速率**是字节通过磁盘磁头的速度，以便传输到/从内存。例如，一整个磁道的字节可以在盘片旋转一圈的时间内传输。因此，传输速率由旋转速度和每磁道字节数共同决定。100 MB/s 的速率很常见。

**寻道时间**是执行器将磁盘磁头从当前位置移动到请求磁道所需的时间。此值取决于需要遍历的磁道数量。它可以低至 0（如果目标磁道与起始磁道相同）高至 15-20 毫秒（如果目标磁道和起始磁道位于盘片的不同末端）。平均寻道时间通常可以合理地估计执行器速度。现代磁盘的平均寻道时间约为 5 毫秒。

考虑以下示例。假设一个四盘硬盘驱动器以 10,000 rpm 的速度旋转，平均寻道时间为 5 毫秒。每个盘片包含 10,000 个磁道，每个磁道包含 500,000 字节。以下是一些计算值：

驱动器的容量：

500,000 字节/磁道 x 10,000 磁道/盘片 x 4 盘片/驱动器 = 20,000,000,000 字节，或大约 20GB

传输速率：

500,000 字节/转 x 10,000 转/60 秒 = 83,333,333 字节/秒，或大约 83MB/秒

### 3.1.2 访问硬盘驱动器 (Accessing a Disk Drive)

**磁盘访问**是读取磁盘驱动器中的一些字节到内存或将内存中的一些字节写入磁盘的请求。这些字节必须位于某个盘片上磁道的连续部分。硬盘驱动器分三个阶段执行磁盘访问：

- 它将磁盘磁头移动到指定的磁道。此时间称为**寻道时间 (seek time)**。
- 它等待盘片旋转，直到第一个所需的字节位于磁盘磁头下方。此时间称为**旋转延迟 (rotational delay)**。
- 随着盘片继续旋转，它读取（或写入）出现在磁盘磁头下方的每个字节，直到最后一个所需的字节出现。此时间称为**传输时间 (transfer time)**。

执行磁盘访问所需的时间是寻道时间、旋转延迟和传输时间之和。这些时间都受到磁盘机械运动的限制。机械运动比电运动慢得多，这就是硬盘驱动器比 RAM 慢得多的原因。寻道时间和旋转延迟尤其令人恼火。这两个时间都只是每次磁盘操作都必须等待的开销。

计算磁盘访问的确切寻道时间和旋转延迟是不切实际的，因为它需要知道磁盘的先前状态。相反，您可以使用它们的平均值来估计这些时间。您已经了解了平均寻道时间。平均旋转延迟很容易计算。旋转延迟可以低至 0（如果第一个字节恰好在磁头下方）高至完整旋转时间（如果第一个字节刚刚通过磁头）。平均而言，您将不得不等待 1/2 旋转，直到盘片定位到您想要的位置。因此，平均旋转延迟是旋转时间的一半。

传输时间也可以很容易地从传输速率计算出来。特别是，如果传输速率为 r 字节/秒，并且您正在传输 b 字节，则传输时间为 b/r 秒。

例如，考虑一个以 10,000 rpm 旋转的硬盘驱动器，其平均寻道时间为 5 毫秒，传输速率为 83 MB/秒。以下是一些计算出的成本：

平均旋转延迟：

60 秒/分钟 x 1 分钟/10,000 转 x 1/2 转 = 0.003 秒 或 3 毫秒

1 字节的传输时间：

1 字节 x 1 秒/83,000,000 字节 = 0.000000012 秒 或 0.000012 毫秒

1000 字节的传输时间：

1,000 字节 x 1 秒/83,000,000 字节 = 0.000012 秒 或 0.012 毫秒

访问 1 字节的估计时间：

5 毫秒（寻道）+ 3 毫秒（旋转延迟）+ 0.000012 毫秒（传输）= 8.000012 毫秒

访问 1000 字节的估计时间：

5 毫秒（寻道）+ 3 毫秒（旋转延迟）+ 0.012 毫秒（传输）= 8.012 毫秒

请注意，访问 1000 字节的估计访问时间与访问 1 字节的估计访问时间基本相同。换句话说，从磁盘访问少量字节是没有意义的。事实上，即使您想这样做，也无法做到。现代磁盘的构造使得每个磁道被划分为固定长度的扇区；磁盘读取（或写入）必须一次操作整个扇区。扇区的大小可能由磁盘制造商决定，或者在格式化磁盘时选择。典型的扇区大小为 512 字节。

### 3.1.3 提高磁盘访问时间 (Improving Disk Access Time)

由于硬盘驱动器非常慢，因此开发了几种技术来帮助缩短访问时间。本节将介绍三种技术：**磁盘缓存 (disk caches)**、**柱面 (cylinders)** 和**磁盘条带化 (disk striping)**。

#### 磁盘缓存 (Disk Caches)

**磁盘缓存**是与硬盘驱动器捆绑在一起的内存，通常足够大以存储数千个扇区的内容。每当硬盘驱动器从磁盘读取一个扇区时，它会将该扇区的内容保存在其缓存中；如果缓存已满，新扇区将替换旧扇区。当请求一个扇区时，硬盘驱动器会检查缓存。如果扇区恰好在缓存中，则可以立即将其返回给计算机，而无需实际进行磁盘访问。

假设一个应用程序在相对较短的时间内多次请求同一个扇区。第一个请求会将扇区带入缓存，随后的请求将从缓存中检索它，从而节省磁盘访问。然而，此功能对数据库引擎来说不是特别有用，因为它已经在进行自己的缓存（如第 4 章所示）。如果多次请求一个扇区，引擎将在其自己的缓存中找到该扇区，甚至不需要访问磁盘。

磁盘缓存的真正价值在于其**预取扇区 (pre-fetch sectors)** 的能力。磁盘驱动器可以读取包含该扇区的整个磁道到缓存中，而不是只读取请求的扇区，希望该磁道的其他扇区稍后会被请求。关键是读取整个磁道所需的时间并不比读取单个扇区多得多。特别是，没有旋转延迟，因为磁盘可以从读/写磁头下方恰好所在的任何扇区开始读取磁道，并在整个旋转过程中继续读取。比较访问时间：

读取一个扇区的时间 = 寻道时间 + 1/2 旋转时间 + 扇区旋转时间

读取一个磁道的时间 = 寻道时间 + 旋转时间

也就是说，读取单个扇区与读取包含多个扇区的整个磁道之间的差异小于磁盘旋转时间的一半。如果数据库引擎恰好请求了磁道上的另一个扇区，那么将整个磁道读入缓存将节省时间。

#### 柱面 (Cylinders)

数据库系统可以通过将相关信息存储在附近的扇区中来缩短磁盘访问时间。例如，存储文件的理想方式是将其内容放置在盘片的同一磁道上。如果磁盘进行基于磁道的缓存，这种策略显然是最佳的，因为整个文件将在一次磁盘访问中读取。但即使没有缓存，这种策略也很好，因为它消除了寻道时间——每次读取另一个扇区时，磁盘磁头都将已经位于正确的磁道上。

假设一个文件占用多个磁道。一个好主意是将其内容存储在盘片附近的磁道中，以便磁道之间的寻道时间尽可能小。然而，一个更好的主意是将其内容存储在其他盘片的同一磁道上。由于每个盘片的读/写磁头都一起移动，因此所有具有相同磁道号的磁道都可以无需额外寻道时间进行访问。

具有相同磁道号的磁道集称为**柱面 (cylinder)**，因为如果您从磁盘顶部观察这些磁道，它们会描述圆柱体的外部。实际上，可以将柱面视为一个非常大的磁道，因为它的所有扇区都可以以零额外寻道时间进行访问。

#### 磁盘条带化 (Disk Striping)

另一种缩短磁盘访问时间的方法是使用**多个磁盘驱动器**。两个小驱动器比一个大驱动器快，因为它们包含两个独立的执行器，因此可以同时响应两个不同的扇区请求。例如，两个 20 GB 的磁盘持续工作，速度大约是单个 40 GB 磁盘的两倍。这种加速效果很好：通常，N 个磁盘的速度大约是单个磁盘的 N 倍。（当然，几个较小的驱动器也比单个大驱动器更昂贵，因此效率的提高是以成本为代价的。）

然而，如果多个小磁盘无法保持忙碌，它们的效率就会丧失。例如，假设一个磁盘包含常用文件，而其他磁盘包含很少使用的归档文件。那么第一个磁盘将承担所有工作，而其他磁盘大部分时间处于空闲状态。这种设置的效率将与单个磁盘大致相同。

因此，问题是如何在多个磁盘之间平衡工作负载。数据库管理员可以尝试分析文件使用情况，以便最好地分配每个磁盘上的文件，但这种方法不切实际：它难以操作，难以保证，并且必须随着时间的推移不断重新评估和修改。

幸运的是，有一种更好的方法，称为**磁盘条带化 (disk striping)**。

磁盘条带化策略使用**控制器**将较小的磁盘隐藏起来，使其在操作系统看来像一个单个的大磁盘。控制器将虚拟磁盘上的扇区请求映射到实际磁盘上的扇区请求。映射工作原理如下。假设有 N 个小磁盘，每个磁盘有 k 个扇区。虚拟磁盘将有 N * k 个扇区；这些扇区以交替模式分配给真实磁盘的扇区。磁盘 0 将包含虚拟扇区 0、N、2N 等。磁盘 1 将包含虚拟扇区 1、N+1、2N+1 等，以此类推。术语“磁盘条带化”源于以下图像：如果您想象每个小磁盘都涂有不同的颜色，那么虚拟磁盘看起来像有条纹，其扇区涂有交替的颜色。参见图 3.3。

![fig3-3](/images/chapter3/fig3-3.png)

磁盘条带化是有效的，因为它将数据库均匀地分布在小磁盘上。如果一个随机扇区请求到达，那么该请求将以相等的概率发送到其中一个小磁盘。如果几个连续扇区的请求到达，它们将被发送到不同的磁盘。因此，磁盘保证以尽可能均匀的方式工作。

### 3.1.4 通过镜像提高磁盘可靠性 (Improving Disk Reliability by Mirroring)

数据库用户希望他们的数据安全地保存在磁盘上，不会丢失或损坏。不幸的是，硬盘驱动器并非完全可靠。盘片上的磁性材料可能会退化，导致扇区无法读取。或者一块灰尘或剧烈移动可能导致读/写磁头刮擦盘片，损坏受影响的扇区（“磁头崩溃”）。

防止磁盘故障最明显的方法是**保留磁盘内容的副本**。例如，您可以每晚备份磁盘；当磁盘发生故障时，您只需购买一个新磁盘并将备份复制到其上。这种策略的问题是，您会丢失磁盘从备份时到发生故障时之间发生的所有更改。解决此问题的唯一方法是在更改发生时立即复制磁盘的每次更改。换句话说，您需要保留两个相同的磁盘版本；这些版本被称为彼此的**镜像 (mirrors)**。

与条带化一样，需要一个**控制器**来管理两个镜像磁盘。当数据库系统请求磁盘读取时，控制器可以访问任一磁盘的指定扇区。当请求磁盘写入时，控制器对两个磁盘执行相同的写入。理论上，这两个磁盘写入可以并行执行，这不需要额外的时间。然而，在实践中，为了防止系统崩溃，**顺序写入镜像很重要**。问题是，如果系统在磁盘写入过程中崩溃，该扇区的内容就会丢失。因此，如果两个镜像都并行写入，两个扇区副本都可能丢失，而如果镜像顺序写入，则至少有一个镜像不会损坏。

假设镜像对中的一个磁盘发生故障。数据库管理员可以通过执行以下程序恢复系统：

1. 关闭系统。
2. 用新磁盘替换发生故障的磁盘。
3. 将数据从完好的磁盘复制到新磁盘。
4. 重新启动系统。

不幸的是，这个过程并非万无一失。如果在复制到新磁盘的过程中完好的磁盘发生故障，数据仍然可能丢失。两个磁盘在几个小时内都发生故障的可能性很小（根据今天的磁盘，大约是 1/60,000），但如果数据库很重要，这种小风险可能无法接受。您可以通过使用**三个镜像磁盘而不是两个**来降低风险。在这种情况下，只有当所有三个磁盘在相同的几个小时内都发生故障时，数据才会丢失；这种可能性虽然不为零，但非常小，可以放心地忽略。

**镜像可以与磁盘条带化共存。** 一种常见的策略是镜像条带化磁盘。例如，可以在四个 20 GB 的驱动器上存储 40 GB 的数据：其中两个驱动器将进行条带化，另外两个将是条带化驱动器的镜像。这种配置既快速又可靠。参见图 3.4。

![fig3-4](/images/chapter3/fig3-4.png)

### 3.1.5 通过存储奇偶校验提高磁盘可靠性 (Improving Disk Reliability by Storing Parity)

镜像的缺点是需要两倍的磁盘来存储相同数量的数据。当使用磁盘条带化时，这种负担尤其明显——如果您想使用 15 个 20 GB 的驱动器存储 300 GB 的数据，那么您将需要再购买 15 个驱动器作为它们的镜像。对于大型数据库安装来说，通过条带化许多小磁盘来创建巨大的虚拟磁盘并不少见，而购买相同数量的磁盘仅仅为了镜像的前景是不吸引人的。如果能在不使用这么多镜像磁盘的情况下从故障磁盘中恢复，那将是件好事。

事实上，有一种巧妙的方法可以使用**单个磁盘来备份任意数量的其他磁盘**。该策略通过在备份磁盘上存储**奇偶校验（parity）**信息来实现。对于一组位 S，奇偶校验定义如下：

- 如果 S 包含奇数个 1，则 S 的奇偶校验为 1。
- 如果 S 包含偶数个 1，则 S 的奇偶校验为 0。

换句话说，如果您将奇偶校验位添加到 S 中，您将始终拥有偶数个 1。

奇偶校验具有以下有趣且重要的特性：**任何位的值都可以从其他位的值中确定，只要您也知道奇偶校验。** 例如，假设 S = \{1, 0, 1\}。S 的奇偶校验为 0，因为它有偶数个 1。假设您丢失了第一个位的值。由于奇偶校验为 0，集合 \{x, 0, 1\} 必须有偶数个 1；因此，您可以推断缺失的位必须是 1。对其他每个位（包括奇偶校验位）也可以进行类似的推断。

奇偶校验的这种用法扩展到磁盘。假设您有 N + 1 个大小相同的磁盘。您选择其中一个磁盘作为**奇偶校验盘（parity disk）**，让其他 N 个磁盘保存**条带化数据（striped data）**。奇偶校验盘的每个位都是通过计算所有其他磁盘相应位的奇偶校验来计算的。如果任何磁盘发生故障（包括奇偶校验盘），该磁盘的内容可以通过逐位查看其他磁盘的内容来重建。参见图 3.5。

![fig3-5](/images/chapter3/fig3-5.png)

磁盘由控制器管理。读写请求的处理方式与条带化基本相同——控制器确定哪个磁盘保存请求的扇区并执行该读写操作。不同之处在于，写请求还必须更新奇偶校验盘的相应扇区。控制器可以通过确定修改扇区的哪些位发生了变化来计算更新后的奇偶校验；规则是如果一个位发生变化，则相应的奇偶校验位也必须发生变化。因此，控制器需要**四次磁盘访问**来执行扇区写入操作：它必须读取扇区和相应的奇偶校验扇区（以便计算新的奇偶校验位），并且必须写入两个扇区的新内容。

这种奇偶校验信息的使用有些神奇，因为它能够可靠地备份任意数量的其他磁盘。然而，这种魔力伴随着两个缺点。

使用奇偶校验的第一个缺点是**扇区写入操作更耗时**，因为它需要从两个磁盘进行读取和写入。经验表明，使用奇偶校验会使条带化的效率降低约 20%。

奇偶校验的第二个缺点是，**数据库更容易受到无法恢复的多磁盘故障的影响**。考虑当一个磁盘发生故障时会发生什么——所有其他磁盘都需要重建发生故障的磁盘，其中任何一个磁盘的故障都是灾难性的。如果数据库由许多小磁盘组成（例如大约 100 个），那么发生第二次故障的可能性变得非常真实。将这种情况与镜像进行对比，在镜像中，从故障磁盘恢复只需要其镜像不发生故障，这发生的可能性要小得多。

### 3.1.6 RAID

前几节讨论了使用多个磁盘的三种方式：**条带化**以加快磁盘访问时间，**镜像**和**奇偶校验**以防止磁盘故障。这些策略使用控制器向操作系统隐藏多个磁盘的存在，并提供单个**虚拟磁盘**的错觉。控制器将每个虚拟读/写操作映射到一个或多个底层磁盘上的操作。控制器可以以软件或硬件实现，尽管硬件控制器更普遍。

这些策略是更大策略集合的一部分，称为 **RAID**，代表**廉价冗余磁盘阵列（Redundant Array of Inexpensive Disks）**。RAID 共有七个级别。

- **RAID-0** 是**条带化**，不提供任何防止磁盘故障的保护。如果其中一个条带化磁盘发生故障，则整个数据库可能会被毁坏。
- **RAID-1** 是**镜像条带化**。
- **RAID-2** 使用**位条带化**而不是扇区条带化，并使用基于纠错码的冗余机制而不是奇偶校验。这种策略已被证明难以实现且性能不佳。它已不再使用。
- **RAID-3** 和 **RAID-4** 使用**条带化和奇偶校验**。它们的区别在于 RAID-3 使用**字节条带化**，而 RAID-4 使用**扇区条带化**。一般来说，扇区条带化往往更高效，因为它对应于磁盘访问的单元。
- **RAID-5** 类似于 RAID-4，不同之处在于，它**没有将所有奇偶校验信息存储在一个单独的磁盘上，而是将奇偶校验信息分布在数据磁盘上。** 也就是说，如果有 N 个数据磁盘，则每个磁盘的每第 N 个扇区都包含奇偶校验信息。这种策略比 RAID-4 更高效，因为不再有单个奇偶校验盘成为瓶颈。参见练习 3.5。
- **RAID-6** 类似于 RAID-5，不同之处在于它保留了**两种奇偶校验信息**。因此，这种策略能够处理两个并发磁盘故障，但需要另一个磁盘来保存额外的奇偶校验信息。

最流行的两种 RAID 级别是 **RAID-1** 和 **RAID-5**。它们之间的选择实际上是**镜像与奇偶校验**的选择。在数据库安装中，镜像往往是更可靠的选择，首先是因为它的速度和鲁棒性，其次是因为额外磁盘驱动器的成本已经变得非常低。

### 3.1.7 闪存驱动器 (Flash Drives)

硬盘驱动器在当前的数据库系统中很常见，但它们有一个无法克服的缺点——它们的运行完全依赖于旋转盘片和移动执行器的机械活动。这个缺点使得硬盘驱动器与电子存储器相比本质上较慢，并且容易受到跌落、振动和其他冲击的损坏。

**闪存 (Flash memory)** 是一种较新的技术，有可能取代硬盘驱动器。它使用类似于 RAM 的半导体技术，但**不需要不间断的电源**。由于其活动完全是电动的，因此它比硬盘驱动器更快地访问数据，并且没有可损坏的移动部件。当前闪存驱动器的寻道时间约为 50 微秒，比硬盘驱动器快约 100 倍。当前闪存驱动器的传输速率取决于其连接的总线接口。通过快速内部总线连接的闪存驱动器与硬盘驱动器相当；然而，外部 USB 闪存驱动器比硬盘驱动器慢。

**闪存会磨损**。每个字节可以被重写固定次数；尝试写入已达到其限制的字节将导致闪存驱动器故障。目前，这个最大次数达到数百万次，对于大多数数据库应用程序来说已经相当高。高端驱动器采用“磨损均衡 (wear-leveling)”技术，自动将频繁写入的字节移动到写入较少的位置；这种技术允许驱动器运行，直到驱动器上的所有字节都达到其重写限制。

闪存驱动器向操作系统提供**基于扇区的接口**，这使得闪存驱动器看起来像硬盘驱动器。可以使用 RAID 技术与闪存驱动器，尽管条带化不太重要，因为闪存驱动器的寻道时间非常低。

闪存驱动器采用的主要障碍是其**价格**。目前价格大约是同等硬盘驱动器的 100 倍。尽管闪存和磁盘技术的价格将继续下降，但最终闪存驱动器将足够便宜，可以被视为主流。届时，硬盘驱动器可能会被降级为存档存储和超大型数据库的存储。

闪存还可以用作**持久前端**来增强硬盘驱动器。如果数据库完全适合闪存，那么硬盘驱动器将永远不会被使用。但随着数据库变大，使用频率较低的扇区将迁移到磁盘。

就数据库引擎而言，**闪存驱动器具有与硬盘驱动器相同的特性：它是持久的、慢速的，并且以扇区方式访问。** （它只是比硬盘驱动器慢得少。）因此，我将遵守当前的术语，并在本书的其余部分将持久存储器称为“磁盘”。

## 3.2 磁盘的块级接口 (The Block-Level Interface to the Disk)

磁盘可能具有不同的硬件特性——例如，它们不必具有相同的扇区大小，并且它们的扇区可能以不同的方式寻址。操作系统负责隐藏这些（以及其他）细节，为应用程序提供一个简单的接口来访问磁盘。

**块 (block)** 的概念是这个接口的核心。块类似于扇区，但其大小由操作系统决定。所有磁盘的每个块都具有相同的固定大小。操作系统维护块和扇区之间的映射。操作系统还为磁盘的每个块分配一个**块号 (block number)**；给定一个块号，操作系统确定实际的扇区地址。

块的内容不能直接从磁盘访问。相反，组成块的扇区必须首先**读入内存页面 (memory page)** 并从那里访问。要修改块的内容，客户端必须将块读入页面，修改页面中的字节，然后将页面写回磁盘上的块。

操作系统通常提供几种方法来访问磁盘块，例如：

- `readblock(n, p)` 将磁盘块 n 处的字节读入内存页面 p。
- `writeblock(n, p)` 将内存页面 p 中的字节写入磁盘块 n。
- `allocate(k, n)` 在磁盘上查找 k 个连续的未使用块，将其标记为已使用，并返回第一个块的块号。新块应尽可能靠近块 n。
- `deallocate(k, n)` 将从块 n 开始的 k 个连续块标记为未使用。

操作系统跟踪磁盘上哪些块可用于分配，哪些不可用。它有两种基本策略：**磁盘映射 (disk map)** 或**空闲列表 (free list)**。

**磁盘映射**是一系列位，磁盘上的每个块对应一位。位值为 1 表示块空闲，0 表示块已分配。磁盘映射存储在磁盘上，通常在它的前几个块中。操作系统可以通过简单地将磁盘映射的第 n 位更改为 1 来解除分配块 n。它可以通过在磁盘映射中搜索连续 k 位值为 1 的块，然后将这些位设置为 0 来分配 k 个连续块。

**空闲列表**是**块 (chunk)** 的链，其中块是连续的未分配块序列。每个块的第一个块存储两个值：**块的长度**和**链上下一个块的块号**。磁盘的第一个块包含指向链上第一个块的指针。当操作系统被要求分配 k 个连续块时，它会在空闲列表中搜索足够大的块。然后它可以选择将整个块从空闲列表中移除并分配它，或者分割出长度为 k 的一块并仅分配这些块。当被要求解除分配一组块时，操作系统只是将其插入到空闲列表中。

图 3.6 说明了这两种技术，用于一个已分配块 0、1、3、4、8 和 9 的磁盘。部分 (a) 显示了存储在磁盘块 0 中的磁盘映射；位值为 0 表示已分配的块。部分 (b) 显示了相应的空闲列表。块 0 包含值 2，表示空闲列表的第一个块从块 2 开始。块 2 包含两个值 1 和 5，表示该块包含 1 个块，并且下一个块从块 5 开始。类似地，块 5 的内容表示其块长 3 个块，并且下一个块在块 10。块 10 的值表示它是最后一个块，其中包含所有剩余的块。

![fig3-6](/images/chapter3/fig3-6.png)

**图 3.6 (a)磁盘映射与(b)空闲列表**

空闲列表技术需要最少的额外空间；您只需要在块 0 中存储一个整数来指向列表中的第一个块。另一方面，磁盘映射技术需要空间来保存映射。图 3.6a 假设映射可以放入一个块中。然而，通常可能需要几个块；参见练习 3.7。磁盘映射的优点是它让操作系统更好地了解磁盘中的“空洞”在哪里。例如，如果操作系统需要支持一次分配多个块，磁盘映射通常是首选策略。

## 3.3 磁盘的文件级接口 (The File-Level Interface to the Disk)

操作系统向磁盘提供了另一个更高级别的接口，称为**文件系统 (file system)**。客户端将文件视为**命名的字节序列 (named sequence of bytes)**。在此级别没有块的概念。相反，客户端可以从文件中的任何位置开始读取（或写入）任意数量的字节。

Java 类 `RandomAccessFile` 提供了一个典型的文件系统 API。每个 `RandomAccessFile` 对象都持有一个**文件指针 (file pointer)**，指示下一次读写操作将发生的字节位置。此文件指针可以通过调用 `seek` 显式设置。调用 `readInt`（或 `writeInt`）方法也将文件指针移动到读取（或写入）整数之后。

图 3.7 中的代码片段是一个示例，它将文件“junk”中字节 7992-7995 处存储的整数递增。调用 `readInt` 读取字节 7992 处的整数并将文件指针移动到其后，即字节 7996。随后的 `seek` 调用将文件指针设置回字节 7992，以便该位置的整数可以被覆盖。

```java
RandomAccessFile f = new RandomAccessFile("junk", "rws"); // 打开文件 "junk"，读写模式
f.seek(7992); // 将文件指针移动到字节 7992
int n = f.readInt(); // 读取一个整数
f.seek(7992); // 将文件指针移回字节 7992
f.writeInt(n + 1); // 写入递增后的整数
f.close(); // 关闭文件
```

**图 3.7 使用磁盘的文件系统接口**

请注意，`readInt` 和 `writeInt` 的调用就像直接访问磁盘一样，隐藏了磁盘块必须通过页面访问的事实。操作系统通常会为自己保留几个内存页面；这些页面被称为 **I/O 缓冲区 (I/O buffers)**。当文件打开时，操作系统会为文件分配一个 I/O 缓冲区，客户端对此一无所知。

文件级接口使得文件可以被认为是**块的序列**。例如，如果块长 4096 字节（即 4K 字节），那么字节 7992 位于文件的块 1（即其第二个块）中。像“文件的块 1”这样的块引用称为**逻辑块引用 (logical block references)**，因为它们告诉我们块相对于文件的位置，而不是块在磁盘上的物理位置。

给定特定的文件位置，`seek` 方法确定包含该位置的实际磁盘块。特别是，`seek` 执行两次转换：

- 它将指定的字节位置转换为逻辑块引用。
- 它将逻辑块引用转换为物理块引用。

第一次转换很容易——逻辑块号就是字节位置除以块大小。例如，假设块大小为 4K 字节，则字节 7992 在块 1 中，因为 7992/4096=1（整数除法）。

第二次转换更难，取决于文件系统的实现方式。本节的其余部分将考虑三种文件实现策略：**连续分配 (contiguous allocation)**、**基于扩展区分配 (extent-based allocation)** 和**索引分配 (indexed allocation)**。这三种策略都将其文件位置信息存储在磁盘上的文件系统目录中。`seek` 方法在将逻辑块引用转换为物理块引用时访问此目录的块。您可以将这些磁盘访问视为文件系统强加的隐藏“开销”。操作系统试图最小化这种开销，但无法消除它。

#### 连续分配 (Continuous Allocation)

**连续分配**是最简单的策略，它将每个文件存储为**连续的块序列**。为了实现连续分配，文件系统目录包含每个文件的长度及其第一个块的位置。将逻辑块引用映射到物理块引用很容易——如果文件从磁盘块 b 开始，那么文件的块 N 位于磁盘块 b+N 中。图 3.8 描绘了包含两个文件的文件系统目录：一个名为“junk”的 48 块长文件，从块 32 开始；一个名为“temp”的 16 块长文件，从块 80 开始。

```txt
名称   起始块  长度
junk    32     48
temp    80     16
```

**图 3.8 连续分配的文件系统目录**

连续分配有两个问题。第一个问题是，如果文件后面紧跟着另一个文件，则文件无法扩展。图 3.8 中的文件“junk”就是这样的一个例子。因此，客户端必须创建具有其可能需要的最大块数的文件，当文件未满时会导致空间浪费。这个问题被称为**内部碎片 (internal fragmentation)**。第二个问题是，随着磁盘变满，它可能有很多小尺寸的未分配块，但没有大的块。因此，即使磁盘包含大量可用空间，也可能无法创建大文件。这个问题被称为**外部碎片 (external fragmentation)**。

换句话说：

- **内部碎片**是文件内部的浪费空间。
- **外部碎片**是所有文件外部的浪费空间。

#### 基于扩展区分配 (Extent-Based Allocation)

**基于扩展区分配**策略是连续分配的一种变体，它减少了内部碎片和外部碎片。在这里，操作系统将文件存储为**一系列固定长度的扩展区 (extents)**，其中每个扩展区是**连续的块块**。文件一次扩展一个扩展区。此策略的文件系统目录为每个文件包含一个文件每个扩展区第一个块的列表。

例如，假设操作系统以 8 块扩展区存储文件。图 3.9 描绘了文件“junk”和“temp”的文件系统目录。这些文件的大小与之前相同，但现在被分割成扩展区。“junk”文件有六个扩展区，“temp”文件有两个扩展区。

```txt
名称   扩展区
junk   32, 480, 696, 72, 528, 336
temp   64, 8
```

**图 3.9 基于扩展区分配的文件系统目录**

为了找到保存文件块 N 的磁盘块，`seek` 方法在文件系统目录中搜索该文件的扩展区列表；然后它搜索扩展区列表以确定包含块 N 的扩展区，从中可以计算出块的位置。例如，考虑图 3.9 的文件目录。文件“junk”的块 21 的位置可以按如下方式计算：

1. 块 21 位于文件的扩展区 2 中，因为 21/8=2（整数除法）。
2. 扩展区 2 从文件的逻辑块 2×8=16 开始。
3. 因此，块 21 位于该扩展区的 21−16=5 块中。
4. 文件的扩展区列表显示扩展区 2 从物理块 696 开始。
5. 因此，块 21 的位置是 696+5=701。

基于扩展区分配减少了内部碎片，因为文件浪费的空间不会超过一个扩展区的大小。并且消除了外部碎片，因为所有扩展区的大小都相同。

#### 索引分配 (Indexed Allocation)

**索引分配**采取了不同的方法——它甚至不尝试以连续块分配文件。相反，**文件的每个块都单独分配**（如果愿意，可以认为是长度为一的扩展区）。操作系统通过为每个文件分配一个特殊的**索引块 (index block)** 来实现此策略，该索引块跟踪分配给该文件的磁盘块。也就是说，索引块 ib 可以被认为是一个整数数组，其中 ib[N] 的值是保存文件的逻辑块 N 的磁盘块。因此，计算任何逻辑块的位置是微不足道的——您只需在索引块中查找即可。

图 3.10a 描绘了文件“junk”和“temp”的文件系统目录。“junk”的索引块是块 34。图 3.10b 给出了该块的前几个整数。从图中可以很容易地看出，文件“junk”的块 1 位于磁盘的块 103 处。

```txt
(a)
名称   索引块
junk   34
temp   439

(b)
块 34: (索引块内容)
32   // 逻辑块 0 对应的物理块
103  // 逻辑块 1 对应的物理块
16   // 逻辑块 2 对应的物理块
17   // 逻辑块 3 对应的物理块
98   // 逻辑块 4 对应的物理块
...
```

**图 3.10 索引分配的文件系统目录。(a) 目录表，(b) 索引块 34 的内容**

这种方法的优点是块是逐个分配的，因此没有碎片。其主要问题是文件将有一个最大大小，因为它们只能拥有与索引块中值数量一样多的块。UNIX 文件系统通过支持多级索引块来解决这个问题，从而允许最大文件大小非常大。参见练习 3.12 和 3.13。

## 3.4 数据库系统与操作系统 (The Database System and the OS)

操作系统提供了两个级别的磁盘访问支持：块级支持和文件级支持。数据库引擎的实现者应该选择哪个级别呢？

选择使用**块级支持 (block-level support)** 的优点是，引擎可以完全控制哪些磁盘块用于什么目的。例如，经常使用的块可以存储在磁盘中部，从而减少寻道时间。类似地，倾向于一起访问的块可以存储在一起。另一个优点是数据库引擎不受操作系统对文件的限制，从而可以支持比操作系统限制更大或跨多个磁盘驱动器的表。

另一方面，使用块级接口有几个缺点：这种策略实现复杂；它要求磁盘被格式化并作为**裸磁盘 (raw disk)** 挂载，即其块不属于文件系统的磁盘；并且它要求数据库管理员对块访问模式有广泛的了解才能微调系统。

另一个极端是数据库引擎尽可能使用操作系统**文件系统 (OS file system)**。例如，每个表都可以存储在一个单独的文件中，并且引擎使用文件级操作访问记录。这种策略实现起来容易得多，并且它允许操作系统向数据库系统隐藏实际的磁盘访问。但这种情况是不可接受的，原因有二：首先，数据库系统需要知道**块边界 (block boundaries)** 在哪里，以便它可以有效地组织和检索数据。其次，数据库系统需要管理自己的页面，因为操作系统管理 I/O 缓冲区的方式不适用于数据库查询。

您将在后续章节中遇到这些问题。

一个折衷的策略是，数据库系统将其所有数据存储在一个或多个操作系统文件中，但将这些文件视为**裸磁盘**。也就是说，数据库系统使用**逻辑文件块 (logical file blocks)** 访问其“磁盘”。操作系统负责通过 `seek` 方法将每个逻辑块引用映射到其对应的物理块。由于 `seek` 在检查文件系统目录时可能会产生磁盘访问，因此数据库系统将无法完全控制磁盘。然而，这些额外的块通常与数据库系统访问的大量块相比微不足道。因此，数据库系统能够使用操作系统的高级接口，同时保持对磁盘访问的显著控制。

许多数据库系统都使用了这种折衷策略。Microsoft Access 将所有内容保存在单个 `.mdb` 文件中，而 Oracle、Derby 和 SimpleDB 使用多个文件。

## 3.5 SimpleDB 文件管理器 (The SimpleDB File Manager)

数据库引擎中与操作系统交互的部分称为**文件管理器 (file manager)**。本节将探讨 SimpleDB 的文件管理器。第 3.5.1 节探讨客户端如何使用文件管理器；第 3.5.2 节探讨其实现。

### 3.5.1 使用文件管理器 (Using the File Manager)

一个 SimpleDB 数据库存储在多个文件中。每个表和每个索引都有一个文件，还有一个日志文件和几个目录文件。SimpleDB 文件管理器通过 `simpledb.file` 包提供对这些文件的**块级访问 (block-level access)**。此包公开了三个类：`BlockId`、`Page` 和 `FileMgr`。它们的 API 如 图 3.11 所示。

```java
// BlockId 类：标识一个特定的块，通过文件名和逻辑块号
public class BlockId {
    // 构造函数：创建 BlockId 对象
    public BlockId(String filename, int blknum);

    // 返回文件名
    public String filename();

    // 返回块号
    public int number();
}

// Page 类：存储磁盘块的内容
public class Page {
    // 构造函数：创建一个页面，其内存来自操作系统 I/O 缓冲区
    public Page(int blocksize);

    // 构造函数：创建一个页面，其内存来自 Java 数组
    public Page(byte[] b);

    // 从指定偏移量读取一个整数
    public int getInt(int offset);

    // 从指定偏移量读取字节数组 (blob)
    public byte[] getBytes(int offset);

    // 从指定偏移量读取一个字符串
    public String getString(int offset);

    // 在指定偏移量写入一个整数
    public void setInt(int offset, int val);

    // 在指定偏移量写入字节数组 (blob)
    public void setBytes(int offset, byte[] val);

    // 在指定偏移量写入一个字符串
    public void setString(int offset, String val);

    // 计算给定字符串长度在页面中所需的字节数
    public int maxLength(int strlen);
}

// FileMgr 类：处理与操作系统文件系统的实际交互
public class FileMgr {
    // 构造函数：初始化文件管理器
    public FileMgr(String dbDirectory, int blocksize);

    // 将指定块的内容读取到指定页面中
    public void read(BlockId blk, Page p);

    // 将页面的内容写入指定块
    public void write(BlockId blk, Page p);

    // 将新块追加到指定文件的末尾，并返回新块的 BlockId
    public BlockId append(String filename);

    // 检查数据库目录是否是新建的
    public boolean isNew();

    // 返回指定文件中的块数
    public int length(String filename);

    // 返回块大小
    public int blockSize();
}
```

**图 3.11 SimpleDB 文件管理器的 API**

例如，语句 `BlockId blk = new BlockId("student.tbl", 23)` 创建了一个指向文件 `student.tbl` 中块 23 的引用。`filename` 和 `number` 方法返回其文件名和块号。
`Page` 对象保存磁盘块的内容。它的第一个构造函数创建一个从操作系统 I/O 缓冲区获取内存的页面；这个构造函数由缓冲区管理器使用。它的第二个构造函数创建一个从 Java 数组获取内存的页面；这个构造函数主要由日志管理器使用。各种 `get` 和 `set` 方法使客户端能够在页面的指定位置存储或访问值。一个页面可以保存三种值类型：整数、字符串和“大对象 (blobs)”（即任意字节数组）。如果需要，可以添加相应的方法来支持其他类型；参见练习 3.17。客户端可以在页面的任何偏移量处存储值，但负责知道哪些值存储在哪里。试图从错误的偏移量获取值将导致不可预测的结果。

`FileMgr` 类处理与操作系统文件系统的实际交互。它的构造函数接受两个参数：一个表示数据库名称的字符串和一个表示每个块大小的整数。数据库名称用作包含数据库文件的文件夹的名称；此文件夹位于引擎的当前目录中。如果不存在此类文件夹，则为新数据库创建一个文件夹。`isNew` 方法在这种情况下返回 `true`，否则返回 `false`。此方法对于新数据库的正确初始化是必需的。

`read` 方法将指定块的内容读入指定页面。`write` 方法执行相反的操作，将页面的内容写入指定块。`length` 方法返回指定文件中的块数。

引擎有一个 `FileMgr` 对象，它在系统启动时创建。`SimpleDB` 类（在 `simpledb.server` 包中）创建该对象，其 `fileMgr` 方法返回创建的对象。

图 3.12 中的 `FileTest` 类说明了这些方法的使用。这段代码有三个部分。第一部分初始化 `SimpleDB` 对象；这三个参数指定引擎应该使用名为“studentdb”的数据库，使用 400 字节的块和 8 个缓冲区的池。400 字节的块大小是 SimpleDB 的默认值。它被人为地设置得很小，以便您可以轻松创建包含大量块的演示数据库。在商业数据库系统中，此值将设置为操作系统定义的块大小；典型的块大小为 4K 字节。缓冲区池将在第 4 章中讨论。

图 3.12 的第二部分在文件“testfile”的第二个块的偏移量 88 处写入字符串“abcdefghijklm”。然后它调用 `maxLength` 方法来确定字符串的最大长度，以便它可以确定字符串后面的位置。然后它将整数 345 写入该位置。

第三部分将此块读入另一个页面并从中提取这两个值。

```java
import java.io.IOException; // 导入 IOException 异常

public class FileTest {
    public static void main(String[] args) throws IOException { // main 方法声明抛出 IOException
        // 第一部分：初始化 SimpleDB 对象
        // 创建一个 SimpleDB 实例，数据库目录名为 "filetest"，块大小 400 字节，缓冲区池大小 8
        SimpleDB db = new SimpleDB("filetest", 400, 8);
        FileMgr fm = db.fileMgr(); // 获取文件管理器实例

        // 第二部分：写入数据到文件
        BlockId blk = new BlockId("testfile", 2); // 标识文件 "testfile" 的逻辑块 2
        Page p1 = new Page(fm.blockSize()); // 创建一个页面，大小与文件管理器定义的块大小相同

        int pos1 = 88; // 写入字符串的起始偏移量
        p1.setString(pos1, "abcdefghijklm"); // 在页面 p1 的 pos1 处写入字符串 "abcdefghijklm"

        // 计算字符串写入后占用的最大长度，以便确定下一个值的写入位置
        int size = Page.maxLength("abcdefghijklm".length());
        int pos2 = pos1 + size; // 整数的写入位置

        p1.setInt(pos2, 345); // 在页面 p1 的 pos2 处写入整数 345

        fm.write(blk, p1); // 将页面 p1 的内容写入到文件 "testfile" 的块 2

        // 第三部分：从文件读取数据并打印
        Page p2 = new Page(fm.blockSize()); // 创建另一个页面用于读取
        fm.read(blk, p2); // 从文件 "testfile" 的块 2 读取内容到页面 p2

        // 从页面 p2 中提取并打印写入的整数和字符串
        System.out.println("偏移量 " + pos2 + " 包含 " + p2.getInt(pos2));
        System.out.println("偏移量 " + pos1 + " 包含 " + p2.getString(pos1));
    }
}
```

**图 3.12 测试 SimpleDB 文件管理器**

### 3.5.2 实现文件管理器 (Implementing the File Manager)

本小节将探讨三个文件管理器类的实现。

#### `BlockId` 类

`BlockId` 类的代码如 图 3.13 所示。除了对 `fileName` 和 `number` 方法的直接实现之外，该类还实现了 `equals`、`hashCode` 和 `toString` 方法。

```java
public class BlockId {
    private String filename; // 文件名
    private int blknum;      // 块号

    // 构造函数
    public BlockId(String filename, int blknum) {
        this.filename = filename;
        this.blknum = blknum;
    }

    // 返回文件名
    public String fileName() {
        return filename;
    }

    // 返回块号
    public int number() {
        return blknum;
    }

    // 重写 equals 方法，用于比较两个 BlockId 对象是否相等
    @Override
    public boolean equals(Object obj) {
        // 如果 obj 不是 BlockId 的实例，直接返回 false
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;

        BlockId blk = (BlockId) obj; // 将 obj 强制转换为 BlockId
        // 比较文件名和块号是否都相等
        return filename.equals(blk.filename) && blknum == blk.blknum;
    }

    // 重写 toString 方法，返回 BlockId 的字符串表示
    @Override
    public String toString() {
        return "[file " + filename + ", block " + blknum + "]";
    }

    // 重写 hashCode 方法，用于散列集合中的键
    @Override
    public int hashCode() {
        // 使用 toString() 的 hashCode 作为 BlockId 的 hashCode
        return toString().hashCode();
    }
}
```

**图 3.13 SimpleDB 类 BlockId 的代码**

#### `Page` 类

`Page` 类的实现代码如 图 3.14 所示。每个页面都使用 **Java `ByteBuffer` 对象**来实现。`ByteBuffer` 对象用方法包装了一个字节数组，这些方法可以在数组的任意位置读写值。这些值可以是基本类型（如整数）以及较小的字节数组。例如，`Page` 的 `setInt` 方法通过调用 `ByteBuffer` 的 `putInt` 方法将一个整数保存到页面中。`Page` 的 `setBytes` 方法将一个 Blob 保存为两个值：首先是指定 Blob 的字节数，然后是字节本身。它调用 `ByteBuffer` 的 `putInt` 方法来写入整数，并调用 `put` 方法来写入字节。

`ByteBuffer` 类没有读取和写入字符串的方法，因此 `Page` 选择将字符串值作为 Blob 写入。Java 的 `String` 类有一个 `getBytes` 方法，它将字符串转换为字节数组；它还有一个构造函数可以将字节数组转换回字符串。因此，`Page` 的 `setString` 方法调用 `getBytes` 将字符串转换为字节，然后将这些字节作为 Blob 写入。类似地，`Page` 的 `getString` 方法从字节缓冲区读取一个 Blob，然后将字节转换为字符串。

字符串与其字节表示之间的转换由**字符编码 (character encoding)** 决定。存在几种标准编码，例如 ASCII 和 Unicode-16。Java 的 `Charset` 类包含实现了许多这些编码的对象。`String` 的构造函数及其 `getBytes` 方法接受一个 `Charset` 参数。在图 3.14 中，您可以看到 `Page` 使用 ASCII 编码，但您可以更改 `CHARSET` 常量以获得您偏好的编码。

一个字符集决定了每个字符编码成多少字节。ASCII 每个字符使用一个字节，而 Unicode-16 每个字符使用 2 到 4 个字节。因此，数据库引擎可能无法确切知道给定字符串将编码成多少字节。`Page` 的 `maxLength` 方法计算具有指定字符数的字符串的 Blob 的最大大小。它通过将字符数乘以每个字符的最大字节数，并加上与字节一起写入的整数所需的 4 个字节来实现。

```java
import java.nio.ByteBuffer;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

public class Page {
    private ByteBuffer bb; // underlying ByteBuffer for the page's content
    // Defines the character set used for string conversions. US_ASCII is 1 byte per character.
    public static final Charset CHARSET = StandardCharsets.US_ASCII;

    // Constructor for creating data buffers managed by the buffer manager.
    // Allocates a direct ByteBuffer for efficient I/O.
    public Page(int blocksize) {
        bb = ByteBuffer.allocateDirect(blocksize);
    }

    // Constructor for creating log pages or other pages from an existing byte array.
    // Wraps a given byte array with a ByteBuffer.
    public Page(byte[] b) {
        bb = ByteBuffer.wrap(b);
    }

    // Reads an integer from the specified offset in the page.
    public int getInt(int offset) {
        return bb.getInt(offset);
    }

    // Writes an integer to the specified offset in the page.
    public void setInt(int offset, int n) {
        bb.putInt(offset, n);
    }

    // Reads a byte array (blob) from the specified offset.
    // First reads the length of the blob (an integer), then the bytes themselves.
    public byte[] getBytes(int offset) {
        bb.position(offset); // Set the buffer's position to the offset
        int length = bb.getInt(); // Read the length of the byte array
        byte[] b = new byte[length]; // Create a byte array of that length
        bb.get(b); // Read the bytes into the array
        return b;
    }

    // Writes a byte array (blob) to the specified offset.
    // First writes the length of the byte array (as an integer), then the bytes.
    public void setBytes(int offset, byte[] b) {
        bb.position(offset); // Set the buffer's position to the offset
        bb.putInt(b.length); // Write the length of the byte array
        bb.put(b); // Write the byte array itself
    }

    // Reads a string from the specified offset by first reading it as a byte array (blob),
    // then converting the byte array to a string using the defined CHARSET.
    public String getString(int offset) {
        byte[] b = getBytes(offset); // Get the byte array representation of the string
        return new String(b, CHARSET); // Convert bytes to a String using the specified charset
    }

    // Writes a string to the specified offset by first converting it to a byte array (blob)
    // using the defined CHARSET, then writing the byte array.
    public void setString(int offset, String s) {
        byte[] b = s.getBytes(CHARSET); // Convert the string to a byte array
        setBytes(offset, b); // Write the byte array as a blob
    }

    // Calculates the maximum number of bytes a string of a given character length
    // will occupy on the page. Accounts for the integer storing the length of the string
    // and the bytes per character in the chosen CHARSET.
    public static int maxLength(int strlen) {
        float bytesPerChar = CHARSET.newEncoder().maxBytesPerChar();
        return Integer.BYTES + (strlen * (int) bytesPerChar); // 4 bytes for length + (char_length * max_bytes_per_char)
    }

    // Package-private method to expose the underlying ByteBuffer.
    // Used by FileMgr to perform actual disk I/O. Resets position to 0.
    ByteBuffer contents() {
        bb.position(0); // Reset buffer position to 0 before returning
        return bb;
    }
}
```

**图 3.14 SimpleDB 类 Page 的代码**

作为 `ByteBuffer` 对象基础的字节数组可以来自 Java 数组或操作系统的 I/O 缓冲区。`Page` 类有两个构造函数，每个都对应不同类型的底层字节数组。由于 I/O 缓冲区是宝贵的资源，第一个构造函数的使用由缓冲区管理器严格控制，并将在下一章中讨论。数据库引擎的其他组件（如日志管理器）使用另一个构造函数。

#### `FileMgr` 类

`FileMgr` 类的代码如 图 3.15 所示。它的主要工作是实现将页面读写到磁盘块的方法。它的 `read` 方法**定位到指定文件的适当位置**，并将该块的内容读取到指定页面的字节缓冲区中。`write` 方法类似。`append` 方法**定位到文件末尾**并向其写入一个空字节数组，这会使操作系统自动扩展文件。请注意文件管理器总是从文件中读取或写入**块大小的字节数**，并且总是在**块边界**处。通过这样做，文件管理器确保每次调用 `read`、`write` 或 `append` 都将精确地产生**一次磁盘访问**。

`openFiles` 映射中的每个 `RandomAccessFile` 对象都对应一个打开的文件。请注意，文件是以“rws”模式打开的。“rw”部分指定文件为读写模式。“s”部分指定操作系统不应延迟磁盘 I/O 以优化磁盘性能；相反，**每个写入操作必须立即写入磁盘**。此功能确保数据库引擎确切知道何时发生磁盘写入，这对于实现第 5 章的数据恢复算法尤为重要。

`read`、`write` 和 `append` 方法是**同步的 (synchronized)**，这意味着一次只有一个线程可以执行它们。当方法共享可更新对象（例如 `RandomAccessFile` 对象）时，需要同步以保持一致性。例如，如果 `read` 未同步，可能会发生以下场景：假设两个 JDBC 客户端，每个都在自己的线程中运行，试图从同一个文件读取不同的块。线程 A 首先运行。它开始执行 `read`，但在调用 `f.seek` 后立即被中断，即它已经设置了文件位置但尚未从中读取。线程 B 接下来运行并完成 `read`。当线程 A 恢复时，文件位置已经改变，但线程不会注意到它；因此，它将错误地从错误的块读取。

SimpleDB 中只有一个 `FileMgr` 对象，它由 `simpledb.server` 包中的 `SimpleDB` 构造函数创建。`FileMgr` 构造函数确定指定的数据库文件夹是否存在，并在必要时创建它。构造函数还会删除可能由第 14 章的物化操作符创建的任何临时文件。

```java
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.HashMap;
import java.util.Map;
import java.nio.ByteBuffer; // Added as per the provided code snippet where Page uses ByteBuffer

public class FileMgr {
    private File dbDirectory; // 数据库文件存储的目录
    private int blocksize;   // 每个块的大小
    private boolean isNew;   // 标记数据库是否是新建的
    // Map to hold open RandomAccessFile objects for each filename.
    private Map<String, RandomAccessFile> openFiles = new HashMap<>();

    // Constructor for FileMgr.
    // It initializes the database directory, block size, and checks if it's a new database.
    // It also cleans up any temporary files if the database is new.
    public FileMgr(String dbDirectoryName, int blocksize) {
        this.dbDirectory = new File(dbDirectoryName);
        this.blocksize = blocksize;
        isNew = !dbDirectory.exists(); // If directory doesn't exist, it's a new database

        // If it's a new database, create the directory; otherwise, clean up existing temp files.
        if (isNew) {
            dbDirectory.mkdirs(); // Create the directory (and any necessary parent directories)
        } else {
            // Remove any temporary files (those starting with "temp")
            for (String filename : dbDirectory.list()) {
                if (filename.startsWith("temp")) {
                    new File(dbDirectory, filename).delete();
                }
            }
        }
    }

    // Synchronized method to read a block from disk into a Page object.
    // Ensures thread safety for file access.
    public synchronized void read(BlockId blk, Page p) {
        try {
            RandomAccessFile f = getFile(blk.fileName()); // Get the RandomAccessFile for the block's file
            // Seek to the start of the specified block within the file.
            // Block position is block number * block size.
            f.seek(blk.number() * blocksize);
            // Read the block's content into the ByteBuffer of the Page.
            // The Page's contents() method returns the ByteBuffer at position 0.
            f.getChannel().read(p.contents());
        } catch (IOException e) {
            throw new RuntimeException("cannot read block " + blk + ": " + e.getMessage());
        }
    }

    // Synchronized method to write the content of a Page object to a block on disk.
    // Ensures thread safety for file access.
    public synchronized void write(BlockId blk, Page p) {
        try {
            RandomAccessFile f = getFile(blk.fileName()); // Get the RandomAccessFile for the block's file
            // Seek to the start of the specified block within the file.
            f.seek(blk.number() * blocksize);
            // Write the Page's content from its ByteBuffer to the file.
            f.getChannel().write(p.contents());
        } catch (IOException e) {
            throw new RuntimeException("cannot write block " + blk + ": " + e.getMessage());
        }
    }

    // Synchronized method to append a new, empty block to the end of a file.
    // This implicitly extends the file on disk.
    public synchronized BlockId append(String filename) {
        int newblknum = length(filename); // The new block number will be the current file length
        BlockId blk = new BlockId(filename, newblknum); // Create a BlockId for the new block
        try {
            RandomAccessFile f = getFile(blk.fileName()); // Get the RandomAccessFile for the file
            // Seek to the end of the file.
            f.seek(blk.number() * blocksize);
            // Write an empty byte array of blocksize to extend the file.
            byte[] b = new byte[blocksize];
            f.write(b);
        } catch (IOException e) {
            throw new RuntimeException("cannot append block " + blk + ": " + e.getMessage());
        }
        return blk; // Return the BlockId of the newly appended block
    }

    // Returns whether this is a new database (directory was just created).
    public boolean isNew() {
        return isNew;
    }

    // Returns the number of blocks in the specified file.
    public int length(String filename) {
        try {
            RandomAccessFile f = getFile(filename); // Get the RandomAccessFile for the file
            // Calculate length by dividing total file size by block size.
            return (int) (f.length() / blocksize);
        } catch (IOException e) {
            throw new RuntimeException("cannot access file " + filename + ": " + e.getMessage());
        }
    }

    // Returns the block size configured for this file manager.
    public int blockSize() {
        return blocksize;
    }

    // Helper method to get an open RandomAccessFile for a given filename.
    // If the file is not already open, it opens it in "rws" mode and stores it in the map.
    private RandomAccessFile getFile(String filename) throws IOException {
        RandomAccessFile f = openFiles.get(filename);
        if (f == null) {
            // "rws" mode: read/write, and synchronous writes to disk (no OS buffering)
            f = new RandomAccessFile(new File(dbDirectory, filename), "rws");
            openFiles.put(filename, f);
        }
        return f;
    }
}
```

**图 3.15 SimpleDB 类 FileMgr 的代码**

## 3.6 本章总结 (Chapter Summary)

- **磁盘驱动器 (disk drive)** 包含一个或多个旋转的**盘片 (platters)**。每个盘片都有同心**磁道 (tracks)**，每个磁道由**扇区 (sectors)** 组成。扇区的大小由磁盘制造商决定；常见的扇区大小是 512 字节。

```java
public class FileMgr {
    private File dbDirectory; // 数据库文件存储的目录
    private int blocksize;   // 每个块的大小
    private boolean isNew;   // 标记数据库是否是新建的
    // 存储已打开的 RandomAccessFile 对象的映射
    private Map<String, RandomAccessFile> openFiles = new HashMap<>();

    // 构造函数：初始化文件管理器
    public FileMgr(File dbDirectory, int blocksize) {
        this.dbDirectory = dbDirectory; // 设置数据库目录
        this.blocksize = blocksize;     // 设置块大小
        isNew = !dbDirectory.exists();  // 检查目录是否存在以确定是否为新数据库

        // 如果是新数据库，则创建目录
        if (isNew)
            dbDirectory.mkdirs();

        // 移除任何遗留的临时表文件 (以 "temp" 开头的文件)
        for (String filename : dbDirectory.list())
            if (filename.startsWith("temp"))
                new File(dbDirectory, filename).delete();
    }

    // 同步方法：从磁盘读取一个块到 Page 对象
    public synchronized void read(BlockId blk, Page p) {
        try {
            RandomAccessFile f = getFile(blk.fileName()); // 获取对应的 RandomAccessFile
            f.seek(blk.number() * blocksize);             // 定位到块的起始位置
            f.getChannel().read(p.contents());            // 将数据读取到 Page 的 ByteBuffer 中
        } catch (IOException e) {
            throw new RuntimeException("无法读取块 " + blk); // 抛出运行时异常
        }
    }

    // 同步方法：将 Page 对象的内容写入磁盘上的一个块
    public synchronized void write(BlockId blk, Page p) {
        try {
            RandomAccessFile f = getFile(blk.fileName()); // 获取对应的 RandomAccessFile
            f.seek(blk.number() * blocksize);             // 定位到块的起始位置
            f.getChannel().write(p.contents());           // 将 Page 的 ByteBuffer 内容写入文件
        } catch (IOException e) {
            throw new RuntimeException("无法写入块" + blk); // 抛出运行时异常
        }
    }

    // 同步方法：向文件末尾追加一个新的空块
    public synchronized BlockId append(String filename) {
        int newblknum = length(filename); // 新块的块号将是当前文件的长度 (块数)
        BlockId blk = new BlockId(filename, newblknum); // 创建新块的 BlockId
        byte[] b = new byte[blocksize]; // 创建一个空字节数组 (块大小)
        try {
            RandomAccessFile f = getFile(blk.fileName()); // 获取对应的 RandomAccessFile
            f.seek(blk.number() * blocksize);             // 定位到文件末尾 (新块的起始位置)
            f.write(b);                                   // 写入空字节数组以扩展文件
        } catch (IOException e) {
            throw new RuntimeException("无法追加块" + blk); // 抛出运行时异常
        }
        return blk; // 返回新追加块的 BlockId
    }

    // 返回指定文件中块的数量
    public int length(String filename) {
        try {
            RandomAccessFile f = getFile(filename);     // 获取对应的 RandomAccessFile
            return (int) (f.length() / blocksize);      // 文件总长度除以块大小得到块数
        } catch (IOException e) {
            throw new RuntimeException("无法访问文件 " + filename); // 抛出运行时异常
        }
    }

    // 返回数据库是否是新建的
    public boolean isNew() {
        return isNew;
    }

    // 返回当前配置的块大小
    public int blockSize() {
        return blocksize;
    }

    // 辅助方法：获取或打开一个 RandomAccessFile 对象
    private RandomAccessFile getFile(String filename) throws IOException {
        RandomAccessFile f = openFiles.get(filename); // 尝试从映射中获取文件
        if (f == null) { // 如果文件尚未打开
            File dbTable = new File(dbDirectory, filename); // 创建文件对象
            // 以 "rws" 模式打开文件：读写，并确保每次写入都立即同步到磁盘
            f = new RandomAccessFile(dbTable, "rws");
            openFiles.put(filename, f); // 将打开的文件添加到映射中
        }
        return f; // 返回 RandomAccessFile 对象
    }
}
```

**图 3.15 SimpleDB 类 FileMgr 的代码**

- 每个盘片都有自己的读/写**磁头 (read/write head)**。这些磁头不能独立移动；相反，它们都连接到一个单独的**执行器 (actuator)**，执行器同时将它们移动到每个盘片上的同一磁道。

- 磁盘驱动器执行一次

  磁盘访问 (disk access)

   分为三个阶段：

  - 执行器将磁盘磁头移动到指定的磁道。这个时间称为**寻道时间 (seek time)**。
  - 驱动器等待盘片旋转，直到第一个所需的字节位于磁头下方。这个时间称为**旋转延迟 (rotational delay)**。
  - 位于磁头下方旋转的字节被读取（或写入）。这个时间称为**传输时间 (transfer time)**。

- 磁盘驱动器速度慢是因为它们的活动是机械的。访问时间可以通过使用**磁盘缓存 (disk caches)**、**柱面 (cylinders)** 和**磁盘条带化 (disk striping)** 来改善。磁盘缓存允许磁盘通过一次读取整个磁道来预取扇区。**柱面**由每个盘片上具有相同磁道号的磁道组成。同一柱面上的块可以无需额外寻道时间即可访问。**磁盘条带化**将虚拟磁盘的内容分布到多个小磁盘上。速度提升是因为小磁盘可以同时操作。

- RAID 技术 (RAID techniques)

   可以用于提高磁盘可靠性。基本的 RAID 级别是：

  - **RAID-0** 是条带化，没有额外的可靠性。如果一个磁盘发生故障，整个数据库实际上就毁了。
  - **RAID-1** 在条带化磁盘中增加了**镜像 (mirroring)**。每个磁盘都有一个相同的镜像磁盘。如果一个磁盘发生故障，它的镜像可以用来重建它。
  - **RAID-4** 使用条带化，并额外增加一个磁盘来保存**冗余奇偶校验信息 (redundant parity information)**。如果一个磁盘发生故障，其内容可以通过将其他磁盘上的信息与奇偶校验磁盘结合来重建。

- RAID 技术需要一个**控制器 (controller)** 来向操作系统隐藏多个磁盘的存在，并提供一个**单一的、虚拟的磁盘 (single, virtual disk)** 的错觉。控制器将每个虚拟读/写操作映射到一个或多个底层磁盘上的操作。

- 磁盘技术正受到**闪存 (flash memory)** 的挑战。闪存是持久的，但由于它是完全电子的，因此比磁盘快。然而，由于闪存仍比 RAM 慢得多，操作系统将闪存驱动器与磁盘驱动器同样对待。

- 操作系统通过提供**基于块的接口 (block-based interface)** 来隐藏磁盘和闪存驱动器的物理细节。**块 (block)** 类似于扇区，只是它的大小是操作系统定义的。客户端通过块号访问设备的内容。操作系统通过使用**磁盘映射**或**空闲列表**来跟踪磁盘上哪些块可用于分配。

- **页面 (page)** 是内存中一个块大小的区域。客户端通过将块的内容读入页面，修改页面，然后将页面写回块来修改块。

- 操作系统还提供了**文件级接口 (file-level interface)** 到磁盘。客户端将文件视为**命名的字节序列**。

- 操作系统可以使用**连续分配 (contiguous allocation)**、**基于扩展区分配 (extent-based allocation)** 或**索引分配 (indexed allocation)** 来实现文件。连续分配将每个文件存储为连续的块序列。基于扩展区分配将文件存储为扩展区序列，其中每个扩展区是连续的块块。索引分配单独分配文件的每个块。每个文件都带有一个特殊的索引块，用于跟踪分配给该文件的磁盘块。

- 数据库系统可以选择使用磁盘的块级接口或文件级接口。一个好的折衷方案是将数据存储在文件中，但以块级访问文件。

## 3.7 建议阅读 (Suggested Reading)

Chen 等人 (1994) 的文章详细调查了各种 RAID 策略及其性能特征。一本讨论基于 UNIX 文件系统的好书是 von Hagen (2002)，而讨论 Windows NTFS 的是 Nagar (1997)。许多操作系统教科书，如 Silberschatz 等人 (2004)，都提供了各种文件系统实现的简要概述。1



闪存具有以下特性：覆盖现有值比写入全新值慢得多。因此，针对基于闪存的文件系统进行了大量研究，这些文件系统不覆盖值。此类文件系统将更新存储在日志中，类似于第 4 章的日志。Wu 和 Kuo (2006) 以及 Lee 和 Moon (2007) 的文章探讨了这些问题。

- Chen, P., Lee, E., Gibson, G., & Patterson, D. (1994) RAID: High-performance, reliable secondary storage.2

   ACM Computing Surveys, 26(2), 145–185.

- Lee, S., & Moon, B. (2007) Design of flash-based DBMS: An in-page logging approach.3

   Proceedings of the ACM-SIGMOD Conference, pp. 55–66.

- Nagar, R. (1997) Windows NT file system internals.4

   O’Reilly.

- Silberschatz, A., Gagne, G., & Galvin, P. (2004) Operating system concepts.5

   Addison Wesley.

- von Hagen, W. (2002) Linux filesystems.6

   Sams Publishing.

- Wu, C., & Kuo, T. (2006) The design of efficient initialization and crash recovery for log-based file systems over flash memory.7

   ACM Transactions on Storage, 2(4), 449–467.

## 3.8 练习 (Exercises)

#### 概念性练习 (Conceptual Exercises)

3.1. 考虑一个包含 50,000 个磁道且以 7200 rpm 旋转的单盘片磁盘。每个磁道包含 500 个扇区，每个扇区包含 512 字节。

(a) 盘片的容量是多少？

(b) 平均旋转延迟是多少？

(c) 最大传输速率是多少？

3.2. 考虑一个 80 GB 的磁盘驱动器，以 7200 rpm 旋转，传输速率为 100 MB/s。假设每个磁道包含相同数量的字节。

(a) 每个磁道包含多少字节？磁盘包含多少个磁道？

(b) 如果磁盘以 10,000 rpm 旋转，传输速率会是多少？

3.3. 假设您有 10 个 20 GB 的磁盘驱动器，每个驱动器每个磁道有 500 个扇区。假设您想通过条带化这些小磁盘来创建一个 200 GB 的虚拟驱动器，每个条带的大小是整个磁道而不是单个扇区。

(a) 假设控制器收到一个虚拟扇区 M 的请求。给出计算相应实际驱动器和扇区号的公式。

(b) 给出磁道大小的条带可能比扇区大小的条带更高效的理由。

(c) 给出磁道大小的条带可能比扇区大小的条带效率更低的理由。

3.4. 本章讨论的所有故障恢复过程都要求在更换故障磁盘时系统必须关闭。许多系统无法忍受任何停机时间，但它们也不想丢失数据。

(a) 考虑基本的镜像策略。给出在不停机的情况下恢复故障镜像的算法。您的算法会增加第二次磁盘故障的风险吗？应该如何做才能降低这种风险？

(b) 类似地修改奇偶校验策略以消除停机时间。您如何处理第二次磁盘故障的风险？

3.5. RAID-4 奇偶校验策略的一个结果是，每次磁盘写入操作都会访问奇偶校验磁盘。一个建议的改进是省略奇偶校验磁盘，而是用奇偶校验信息“条带化”数据磁盘。例如，磁盘 0 的扇区 0、N、2N 等将包含奇偶校验信息，磁盘 1 的扇区 1、N+1、2N+1 等也将包含奇偶校验信息，依此类推。这种改进称为 RAID-5。

(a) 假设一个磁盘发生故障。解释它将如何恢复。

(b) 证明通过这种改进，磁盘读写仍然需要与 RAID-4 相同数量的磁盘访问。

(c) 解释为什么这种改进仍然导致更高效的磁盘访问。

**3.6.** 考虑图 3.5，并假设其中一个条带化磁盘发生故障。展示如何使用奇偶校验磁盘重建其内容。

3.7. 考虑一个 1 GB 的数据库，存储在一个块大小为 4K 字节的文件中。

(a) 文件将包含多少个块？

(b) 假设数据库系统使用磁盘映射来管理其空闲块。需要多少额外的块来保存磁盘映射？

3.8. 考虑图 3.6。在执行以下操作后，绘制磁盘映射和空闲列表的图示：

allocate(1,4); allocate(4,10); allocate(5,12);

**3.9.** 图 3.16 描绘了一个 RAID-4 系统，其中一个磁盘发生故障。使用奇偶校验磁盘重建其值。

![fig3-16](/images/chapter3/fig3-16.png)

3.10. 空闲列表分配策略最终可能在空闲列表中出现两个连续的块。

(a) 解释如何修改空闲列表技术，以便可以合并连续的块。

(b) 解释为什么当文件连续分配时，合并未分配的块是一个好主意。

(c) 解释为什么合并对于基于扩展区或索引的文件分配不重要。

3.11. 假设操作系统使用基于扩展区的文件分配，扩展区大小为 12，并且文件的扩展区列表是 [240, 132, 60, 252, 12, 24]。

(a) 文件的大小是多少？

(b) 计算文件的逻辑块 2、12、23、34 和 55 的物理磁盘块。

**3.12.** 考虑使用索引文件分配的文件实现。假设块大小为 4K 字节，最大可能的文件大小是多少？

3.13. 在 UNIX 中，文件的目录项指向一个名为 inode 的块。在 inode 的一个实现中，块的开头包含各种头部信息，其最后 60 字节包含 15 个整数。其中前 12 个整数是文件中前 12 个数据块的物理位置。接下来的两个整数是两个索引块的位置，最后一个整数是双索引块的位置。一个索引块完全由文件中下一个数据块的块号组成；一个双索引块完全由索引块的块号组成（其内容指向数据块）。

(a) 再次假设块大小为 4K 字节，一个索引块引用多少个数据块？

(b) 忽略双索引块，UNIX 最大可能的文件大小是多少？

(c) 一个双索引块引用多少个数据块？

(d) UNIX 最大可能的文件大小是多少？

(e) 读取一个 1 GB 文件的最后一个数据块需要多少次块访问？

(f) 给出实现 UNIX 文件中 seek 函数的算法。

**3.14.** 电影和歌曲标题“艳阳天你可望到永远 (On a clear day you can see forever)”有时被误引为“清盘日可无尽寻道 (On a clear disk you can seek forever)”。评论这个双关语的巧妙之处和准确性。

#### 编程练习 (Programming Exercises)

**3.15**. 数据库系统通常包含诊断例程。

(a) 修改 FileMgr 类，使其保留有用的统计数据，例如读取/写入的块数。向该类添加新方法以返回这些统计数据。

(b) 修改 RemoteConnectionImpl 类（在 simpledb.jdbc.network 包中）的 commit 和 rollback 方法，使其打印这些统计数据。对 EmbeddedConnection 类（在 simpledb.jdbc.embedded 包中）执行相同的操作。结果是引擎将打印它执行的每个 SQL 语句的统计数据。

**3.16**. Page 类的 setInt、setBytes 和 setString 方法不检查新值是否适合页面。

(a) 修改代码以执行检查。如果检查失败，您应该怎么做？

(b) 给出不执行检查是合理的理由。

**3.17.** `Page` 类有获取/设置整数、Blob 和字符串的方法。修改该类以处理其他类型，例如短整数、布尔值和日期。

**3.18.** `Page` 类通过从字符串的字符创建 Blob 来实现字符串。实现字符串的另一种方法是单独写入每个字符，并在末尾附加一个分隔符。Java 中一个合理的分隔符是 `'\0'`。相应地修改该类。
