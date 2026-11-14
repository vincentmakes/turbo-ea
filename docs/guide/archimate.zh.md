# ArchiMate 图

**ArchiMate** 编辑器在您的卡片之上绘制 [ArchiMate 3](https://pubs.opengroup.org/architecture/archimate3-doc/) 图：您放置标准记法中的元素（Business Process、Application Component、Node 等），用该语言允许的关系把它们连接起来，并且可以选择把每个元素关联到清单中的一张卡片。图以 **ArchiMate Model Exchange File**（The Open Group 的 XML 格式，3.1 版）保存，因此可以与其他 ArchiMate 工具交换。

!!! warning "版本状态"
    此版本提供的 ArchiMate 基础功能是一个**面向管理员的沙盒**。该模块默认关闭，这些图不会出现在[图表](diagrams.md)菜单中，目前也不能发布或嵌入。参见[已知限制](#known-limits)。

第一行显示图表名称、卡片颜色、卡片显示内容和同步。同步会刷新关联卡片的数据。第二行包含绘图工具、缩放、SVG 导出和属性面板。 使用 **点状网格** 显示或隐藏背景上的点。浏览器会记住每个图表的设置。

## 开启模块

1. 打开**管理 → 设置**，找到 **ArchiMate 图表**卡片（与其他模块开关在一起）。
2. 将其开启。卡片显示 **ArchiMate 已开启**。
3. 可随时再次关闭。图会被保留；模块关闭期间这些页面无法访问，通过直接链接访问的人会看到标准的“模块已禁用”占位页。

## 打开沙盒

模块开启期间，ArchiMate 图可从**图表**页面创建和打开，也可从其所引用的任意卡片的**资源**标签页打开。`/admin/architectureStudio` 仍是您的 ArchiMate 图列表，可在其中创建、打开和删除图；访问它需要至少一个 ArchiMate 层的权限，并且模块已开启。在编辑器中，**返回**会回到您来时的页面。

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## 您的第一张图

1. 在沙盒中，于**新建 ArchiMate 图**下输入**名称**，然后点击**创建**。编辑器随即打开。
2. **放置元素**。调色板按层列出元素类型（战略、业务、应用、技术、物理、动机、实施与迁移、其他）。把条目拖到画布上，或使用键盘：移到某个条目上，按 **Enter** 或 **Space**，即可把元素放在可见区域的中央。新元素会立即打开其名称供编辑。
3. **绘制关系**。选中一个元素：其周围的上下文面板提供“绘制 *关系*”条目。选择其一，然后点击目标元素。只有 ArchiMate 关系表允许的元素对才能连接：只有当该语言允许从此元素向至少一种元素类型建立该关系时才会提供该条目，表中不允许的目标会被拒绝。选中一条连线可更改其**访问类型**（针对 Access）或方向（针对 Association）。
4. **把元素关联到卡片**。选中元素并使用上下文面板：
    - **关联到卡片**打开一个选择器，仅限于映射到此元素类型的卡片类型（参见[映射](#mapping)）。
    - **创建卡片**会询问卡片类型和名称，一步完成创建并关联。
    - 一旦关联了卡片，就会出现**打开已关联的卡片**和**取消关联卡片**。

    关联始终是显式的。放置元素**绝不会**创建卡片，把元素从图中移除（**从图中移除**）也**绝不会**删除卡片。保存时，图所关联的卡片集合会同步，与其他图相同。
5. **保存**。编辑器会在您最后一次更改三秒后自动保存；**保存**按钮可立即保存。状态显示*正在保存…*、*已保存*或*有未保存的更改*。

!!! warning "保存失败的提示会一直保留"
    如果保存失败，错误会一直显示，并带有**重试**按钮，图仍标记为未保存，任何内容都不会被悄悄丢弃。在有未保存或保存失败的更改时离开页面（关闭标签页、使用浏览器的“后退”按钮或打开应用的其他页面），会先要求确认。

## 映射 {#mapping}

**映射**（mapping）说明 Turbo EA 的某个卡片类型、子类型或关系类型对应哪个 ArchiMate 概念。编辑器读取它来决定哪些卡片可以关联到哪个元素。每个卡片类型、子类型和关系类型都带有一个 ArchiMate 元素类型或关系类型；关系还带有一个**方向标志**（设置后，ArchiMate 关系从目标卡片画向源卡片；例如“组织*使用*应用”是从应用指向组织的 ArchiMate *Serving* 关系），对于 Access 还带有**访问类型**。

!!! note
    在此版本中，映射是**只读**的：它保存下面的默认值。用于修改它的管理界面（**管理 → 元模型**中的 **ARCHI MAP**）将在之后推出。此版本不会根据绘制的关系创建或更改卡片关系。

元素和关系的名称是 The Open Group 交换格式中的名称。元素为空（`—`）的卡片类型没有默认映射，因此在设置元素类型之前，其卡片无法关联。子类型若有自己的映射就使用它，否则使用卡片类型的映射。

### 卡片类型和子类型

| 卡片类型 | ArchiMate 元素 |
|---|---|
| 目标 | `Goal` |
| 目标 › 业务目标 | `Goal` |
| 目标 › 价值关卡 | `Assessment` |
| 平台 | `Grouping` |
| 举措 | `WorkPackage` |
| 组织 | `BusinessActor` |
| 组织 › 区域 | `Location` |
| 业务能力 | `Capability` |
| 业务上下文 | — |
| 业务上下文 › 流程 | `BusinessProcess` |
| 业务上下文 › 价值流 | `ValueStream` |
| 业务上下文 › 客户旅程 | `BusinessProcess` |
| 业务上下文 › 业务产品 | `Product` |
| 业务上下文 › ESG能力 | `Capability` |
| 业务流程 | `BusinessProcess` |
| 业务流程 › 流程类别 | `BusinessFunction` |
| 业务流程 › 流程组 | `BusinessFunction` |
| 应用程序 | `ApplicationComponent` |
| 接口 | `ApplicationInterface` |
| 数据对象 | `BusinessObject` |
| IT组件 | `Node` |
| IT组件 › 软件 | `SystemSoftware` |
| IT组件 › 硬件 | `Device` |
| IT组件 › SaaS | `TechnologyService` |
| IT组件 › PaaS | `TechnologyService` |
| IT组件 › IaaS | `TechnologyService` |
| IT组件 › 服务 | `TechnologyService` |
| IT组件 › AI模型 | `SystemSoftware` |
| 技术类别 | `Grouping` |
| 供应商 | `BusinessActor` |

### 关系类型

对于 Access 关系，`crud` 表示访问类型遵循该关系自身的 Create/Read/Update/Delete 标志：只读得到 Read，任何创建、更新或删除得到 Write，两者都有得到 Read/Write，都没有则得到普通的 Access。“继承”关系存在于每个具有它的卡片类型上，并映射为 Association，Business Context 的那一条除外，它在表中有单独一行。

| 关系 | ArchiMate 关系 | 备注 |
|---|---|---|
| 目标 → 业务能力, *改进* | `Association` | — |
| 平台 → 目标, *支持* | `Influence` | — |
| 平台 → 应用程序, *运行* | `Aggregation` | — |
| 平台 → IT组件, *实现* | `Aggregation` | — |
| 举措 → 目标, *支持* | `Influence` | — |
| 举措 → 平台, *影响* | `Association` | — |
| 举措 → 业务能力, *改进* | `Association` | — |
| 举措 → 应用程序, *影响* | `Association` | — |
| 举措 → 接口, *影响* | `Association` | — |
| 举措 → 数据对象, *影响* | `Association` | — |
| 举措 → IT组件, *影响* | `Association` | — |
| 组织 → 目标, *拥有* | `Association` | — |
| 组织 → 举措, *拥有* | `Assignment` | — |
| 组织 → 业务上下文, *拥有* | `Association` | — |
| 组织 → 应用程序, *使用* | `Serving` | 从目标指向来源绘制 |
| 组织 → IT组件, *拥有* | `Association` | — |
| 应用程序 → 业务能力, *支持* | `Realization` | — |
| 应用程序 → 业务上下文, *支持* | `Association` | — |
| 应用程序 → 接口, *提供 / 消费* | `Association` | — |
| 应用程序 → 数据对象, *CRUD* | `Access` | 访问类型取自 CRUD 标志 |
| 应用程序 → IT组件, *使用* | `Serving` | 从目标指向来源绘制 |
| IT组件 → 技术类别, *属于* | `Aggregation` | 从目标指向来源绘制 |
| IT组件 → 平台, *实现* | `Aggregation` | 从目标指向来源绘制 |
| 接口 → 数据对象, *传输* | `Association` | — |
| 接口 → IT组件, *使用* | `Association` | — |
| 供应商 → 举措, *支持* | `Association` | — |
| 供应商 → 应用程序, *提供* | `Association` | — |
| 供应商 → IT组件, *提供* | `Association` | — |
| 业务上下文 → 业务能力, *关联于* | `Association` | — |
| 业务流程 → 业务能力, *支持* | `Realization` | — |
| 业务流程 → 应用程序, *被支持* | `Serving` | 从目标指向来源绘制 |
| 业务流程 → 数据对象, *使用* | `Access` | 访问类型取自 CRUD 标志 |
| 业务流程 → IT组件, *使用* | `Serving` | 从目标指向来源绘制 |
| 业务流程 → 业务流程, *依赖于* | `Association` | — |
| 业务流程 → 业务流程, *调用* | `Triggering` | — |
| 业务流程 → 组织, *属于* | `Assignment` | 从目标指向来源绘制 |
| 业务流程 → 举措, *被影响* | `Association` | — |
| 业务流程 → 目标, *支持* | `Influence` | — |
| 业务流程 → 业务上下文, *实现* | `Realization` | — |
| 目标 → 业务上下文, *是其目标* | `Association` | — |
| 业务上下文 → 业务上下文, *继承* | `Triggering` | 从目标指向来源绘制 |

右键点击连线，选择**直线**或**直角**。移动节点以及保存并重新打开图表后，连线仍会保留所选走向。

## Exchange 文件 {#exchange-file}

工具栏提供**导出为 Exchange 文件**和**导入 Exchange 文件**，以及用于生成图片的**导出为 SVG**。

- **导出**会把图下载为 ArchiMate Model Exchange File（`.xml`，3.1 格式）。
- **导入**会在确认后（**替换该图？**）替换当前打开的图中的全部内容。用其他工具（如 Archi）制作的图，只要遵循 The Open Group 格式就可以读取。
- 超过 5 MB 的文件会被拒绝，含有 DOCTYPE 或实体声明的文件同样会被拒绝。

**导入时不会保留的内容：**

- **文件夹**（`organizations` 部分）：会被丢弃，编辑器会提示您。
- **来自其他工具的注释、分组和普通连线**：没有元素对应的标签和容器，以及没有关系对应的连线，都会被忽略。
- **除 string 以外的属性类型**：每个属性定义都按字符串读取。
- **名称的其他语言**：每个元素、关系和视图只保留一个名称。
- 基本样式之外的字体和其他样式不会保留。

## 检查模型

工具栏中的**检查模型**按钮会把当前图发送到服务器，服务器按 The Open Group 的交换规则进行验证，并列出发现的每个问题（最多 100 个）。每条消息都有一个代码；`…` 代表相关的名称或标识符：

| Code | 消息 |
|---|---|
| `too_large` | 模型超过 5 MB。 |
| `xml_invalid` | 模型不是格式良好的 XML。 |
| `dtd_forbidden` | 不允许使用 DOCTYPE 和实体声明。 |
| `wrong_root` | 根元素不是 ArchiMate 模型。 |
| `missing_identifier` | 有元素、关系或图节点没有标识符。 |
| `unknown_element_type` | 未知的元素类型：… |
| `unknown_relationship_type` | 未知的关系类型：… |
| `unknown_access_type` | … 上的访问类型未知 |
| `duplicate_identifier` | 标识符重复：… |
| `dangling_source` | 关系 … 的起点指向不存在的对象。 |
| `dangling_target` | 关系 … 的终点指向不存在的对象。 |
| `relationship_not_allowed` | ArchiMate 不允许关系 …：既不能连接这两个元素，也不能从关系指向其自身。 |
| `dangling_element_ref` | 图节点 … 显示的元素不存在。 |
| `dangling_relationship_ref` | 图连线 … 显示的关系不存在。 |
| `connection_endpoint_mismatch` | 图连线 … 没有连接其关系对应的节点。 |

关系检查还会拒绝指向另一个关系的关系，除非它是 Association、Aggregation 或 Composition。没有可报告的内容时，对话框显示**未发现问题**。

## 键盘快捷键

点击工具栏中的**键盘快捷键**可查看列表。请先点击画布，使其获得焦点。

| 操作 | 快捷键 |
|------|--------|
| 撤销 | `Ctrl+Z` |
| 重做 | `Ctrl+Y` / `Ctrl+Shift+Z` |
| 复制 | `Ctrl+C` |
| 粘贴 | `Ctrl+V` |
| 删除 | `Delete` / `Backspace` |
| 重命名 | `F2` / `Enter` |
| 全选 | `Ctrl+A` |
| 放大 | `Ctrl++` |
| 缩小 | `Ctrl+-` |
| 适应屏幕 | `Ctrl+0` |

在调色板上，对获得焦点的条目按 `Enter` 或 `Space` 即可放置该元素。

## 已知限制 {#known-limits}

- **每个文件只编辑一个视图**。如果导入的文件包含多个视图，则编辑第一个，其余视图在保存时原样保留。
- **关系之间的关系**（指向另一个关系的 Association、Aggregation 或 Composition）会被读取和写入，检查器也接受它们，但不会被绘制。
- **绘制关系需要使用鼠标**。键盘可以放置元素，但不能连接元素。
- **键盘放置的元素会叠放**。每个用 `Enter` 或 `Space` 放置的元素都落在可见区域的中央，因此连续放置的元素会重叠，直到您移动它们。
- **暂不支持发布**。ArchiMate 图不能发布或嵌入，也不会出现在**图表**菜单中；请从沙盒列表，或从其所引用卡片的**资源**标签页进入。
- **连接点（junction）没有标签**。And 或 Or 连接点只是一个圆点。
- 映射是只读的（参见[映射](#mapping)），导入时文件夹会被丢弃（参见 [Exchange 文件](#exchange-file)）。

---

ArchiMate® 是 The Open Group 的注册商标。Turbo EA 绘制 ArchiMate 记法，并未获得 The Open Group 的认证。
