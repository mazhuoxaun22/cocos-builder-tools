# Cocos Creator 场景编辑原理与工具手册

---

## ⚠️ AI: STOP HERE — Use the tool first, read docs only if something breaks

**You are an AI agent. Your default workflow for Cocos scene/prefab editing is:**

1. **Copy or modify** `examples/scene-config.example.json` to create your config JSON.
2. **Run the builder** (`node cocos-builder.js` or `node cli.js` are equivalent):
   - `node cocos-builder.js prefab your-config.json` → create/append Prefab
   - `node cocos-builder.js scene your-config.json` → create/append Scene
   - `node cocos-builder.js clean scene1.scene` → strip `_id` from cc.Scene
   - `node cocos-builder.js uuid <uuid>` → compress/decompress UUID
   - `node demo/game-over-panel.js` → run Prefab demo
   - `node demo/ui-demo-scene.js` → run Scene demo
3. **Only read below** if the command fails, or you need to understand internals (UUID compression, `__id__` references, append-only rules, etc.).

> Programmatic API also available: `const { PrefabBuilder, SceneBuilder, stripSceneFileIds } = require('./cocos-builder')`

---

# 第一篇：Cocos Creator 原理篇

---

## 一、场景文件的数据结构

### 1.1 JSON 数组 = 扁平对象图

`.scene` 和 `.prefab` 文件本质是**一个 JSON 数组**。Cocos 把整棵场景树（节点、组件、资源引用）序列化到这个扁平数组中。

为什么是数组而非嵌套 JSON 树？因为场景内对象之间的引用关系是**网状 DAG**——父节点引用子节点、子节点引用父节点、组件交叉引用。树状 JSON 无法表达这种多对多关系。

**引擎反序列化流程**：
1. 一次性解析整个数组到内存
2. 按 `__type__` 创建对象（Node、Component、Asset）
3. 通过 `__id__` 重建对象间引用关系
4. 通过 `__uuid__` 从 AssetManager 加载外部资源

### 1.2 `__id__` —— 文件内部的"指针"

```json
{ "__id__": 5 }
```

表示**引用本文件数组的第 5 个元素**。Cocos 用这个机制表达一切内部引用：

- 父节点 → 子节点：`_children: [{ "__id__": 3 }]`
- 组件 → 所属节点：`node: { "__id__": 1 }`
- Button → 目标 Label 节点：`_target: { "__id__": 7 }`
- Canvas → Camera 节点：`_cameraComponent: { "__id__": 2 }`

**⚠️ `null` vs `{"__id__": null}`**：Cocos 引擎期望字段值为字面量 `null`（表示"无引用"），而非 `{"__id__": null}`（非法引用对象）。工具链的 `Id()` 函数已处理 null/undefined → 返回 `null`。手写 JSON 时务必写 `null`，不要写 `{"__id__": null}`。

**核心约束**：`append-only`。因为整个引用体系建立在索引稳定上，`splice()` 删除/插入会偏移所有后继索引。

### 1.3 Scene 与 Prefab 的根对象差异

```
┌─ .scene ────────────────────────┐  ┌─ .prefab ───────────────────────┐
│ [0] cc.SceneAsset               │  │ [0] cc.Prefab                   │
│     scene: Id(1) → 根节点        │  │     data: Id(1) → 根节点         │
│ [1] cc.Node (根)                │  │ [1] cc.Node (根)                │
│     _parent: null               │  │     _parent: null                │
│     _prefab: null  ← 原生节点    │  │     _prefab: Id(8) → PrefabInfo  │
│ ...                             │  │ ...                             │
└─────────────────────────────────┘  └─────────────────────────────────┘
```

**关键区别**：场景节点 `_prefab = null`；预制体节点每个都挂 `PrefabInfo`，用于追踪实例化和覆盖。

---

## 二、节点系统

### 2.1 Node 完整结构

```json
{
  "__type__": "cc.Node", "_name": "MyNode", "_objFlags": 0,
  "_parent": { "__id__": 0 },
  "_children": [{ "__id__": 3 }, { "__id__": 5 }],
  "_active": true,
  "_components": [{ "__id__": 2 }, { "__id__": 4 }],
  "_prefab": null,
  "_lpos":   { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 },
  "_lrot":   { "__type__": "cc.Quat", "x": 0, "y": 0, "z": 0, "w": 1 },
  "_lscale": { "__type__": "cc.Vec3", "x": 1, "y": 1, "z": 1 },
  "_layer": 33554432,
  "_euler":  { "__type__": "cc.Vec3", "x": 0, "y": 0, "z": 0 }
}
```

| 字段 | 说明 |
|------|------|
| `_objFlags` | 0=正常, 512=锁定, 1024=隐藏 |
| `_layer` | 33554432 = UI_2D 渲染层 |
| `_prefab` | `null`=场景原生；`Id(n)`=预制体节点 |
| `_children` | **数组顺序 = 渲染顺序**：索引小→先绘制→底层 |

### 2.2 坐标变换

运行时：`ChildWorldMatrix = ParentWorldMatrix × ChildLocalMatrix`

局部矩阵由 `_lpos`、`_lrot`、`_lscale` 组合。`_euler` 是编辑器中的旋转表示，引擎自动与 `_lrot` 互转。

### 2.3 append-only 原则

```
✅ 添加：sceneArr.push(template)
✅ 修改：sceneArr[idx].field = value
✅ 软删：sceneArr[idx]._active = false
❌ 删除：sceneArr.splice(idx, 1)   ← 破坏所有后继 __id__
❌ 插入：sceneArr.splice(idx, 0, obj) ← 全部索引偏移
```

---

## 三、组件系统

### 3.1 双向绑定必须同步

```
Node._components[i] → Component    (节点持有组件)
Component.node.__id__ → Node        (组件反向引用节点)
```

两方向必须一致。`component.node.__id__` 指错索引 = 组件挂错节点。

**正确添加组件流程**：
```
newCompIdx = sceneArr.push(componentTemplate) - 1
sceneArr[newCompIdx].node.__id__ = ownerNodeIdx    ← 必须同步!
node._components.push({ "__id__": newCompIdx })
```

### 3.2 UITransform 为什么必选

`cc.UITransform` 负责节点尺寸（`_contentSize`）和锚点（`_anchorPoint`）。Widget 对齐、Layout 排列、触摸命中检测全部依赖它。没有 UITransform 的节点在 UI 系统中是"隐形的"。

**唯一例外**：纯 Camera 节点（有 `cc.Camera` 无 `cc.Canvas`），不需要 UI 尺寸。

### 3.3 关键组件坑位

| 组件 | 陷阱 | 正确做法 |
|------|------|---------|
| `Label._string` | 字段缺失 → 解析失败 | 空文本也写 `"_string": ""` |
| `Button._target` | 指向 Label 组件 / `{"__id__": null}` | 应指向 Label 所在**节点**；无目标时写 `null` |
| `Widget._target` | 指向自身节点 / 非法节点 | 必须是父节点或 `null`（与 Cocos 原生 Canvas 一致） |
| `Canvas._cameraComponent` | 指向 Camera 组件 | 应指向 Camera 所在**节点** |
| `Layout._resizeMode: 2` | 循环依赖 → 无限递归 | 永远不要用 CONTAINER 模式 |

### 3.4 自定义脚本的 `__type__`

```json
// ✅ 正确：压缩 UUID（23 字符）
{ "__type__": "4c18b44YlBLQ51A1l46ffFB" }

// ❌ 错误：原始 UUID（36 字符）
{ "__type__": "4c18be38-6250-4b43-9d40-d65e3a7df141" }
```

原因：引擎的 classFinder 用压缩 UUID 做映射 key，原始 UUID 无法匹配。

---

## 四、UUID 体系

### 4.1 UUID 生命周期

```
创建 .ts → Cocos 生成 UUID v4
   → .meta 文件存为压缩格式（23 字符）
   → 引擎扫描所有 .meta 建映射表 { 压缩UUID → 类路径 }
   → 场景加载 __type__ → 查表 → require → new
```

### 4.2 压缩算法

**原理**：去横线得 32 hex → 前 5 个 hex 原样保留 → 剩余 27 hex 每 3 个一组（共 9 组），每组转 2 个 Base64。

```
原始：bcb36bda-f613-4c6d-8c78-15fbc3810c89
去线：bcb36bdaf6134c6d8c7815fbc3810c89

前5位: bcb36 (原样)
第1组: bda(hex)=3034(dec) → 高位3034>>6=47='v' 低位3034&63=26='a' → "va"
第2组: f61(hex)=3937(dec) → 高位3937>>6=61='9' 低位3937&63=33='h' → "9h"
...×9轮

结果: bcb36va9hNMbYx4FfvDgQyJ  (5+18=23字符)
```

**为什么 3 hex → 2 Base64？** 3 hex = 12 bit，2 Base64 = 12 bit，完美对齐零浪费。

**Base64 字符集**（标准，非 URL-safe）：
```
ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
```

### 4.3 各场景 UUID 格式选择

| 使用场景 | 格式 | 示例长度 |
|---------|------|---------|
| `.meta` 文件 | **压缩** 23-char | `4c18b44YlBLQ51A1l46ffFB` |
| Scene/Prefab `__type__` | **压缩** 23-char | 同上 |
| 资源引用 `__uuid__` | **原始** 36-char | `4c18be38-6250-4b43-9d40-d65e3a7df141` |
| `PrefabInfo.fileId` | 原始 UUID-v4 | `a1b2c3d4-...` |
| `CompPrefabInfo.fileId` | 压缩 23-char | 同压缩格式 |

### 4.4 classFinder 原理

```javascript
// 引擎内部映射表（启动时从所有 .meta 构建）
{
  "4c18b44YlBLQ51A1l46ffFB": "db://assets/Scripts/GameOverPanelUI.ts",
  "560feGM3htMUbBaEw5wHPsI": "db://assets/Scripts/DropCardUI.ts",
}

// 场景反序列化
__type__: "4c18b44YlBLQ..."
  → 查表 → "db://.../GameOverPanelUI.ts"
  → require() → 构造函数 → new() → 组件实例
```

**如果 `__type__` 用原始 UUID → 表里没这个 key → "Missing class"**。

### 4.5 `@f9941` 子资源

Cocos 的 Texture2D 内部包含 SpriteFrame 子资源。`@f9941` 是默认 SpriteFrame 的固定 ID。

```
✅ cc.SpriteFrame:       "uuid@f9941"  必须带
❌ cc.Prefab/Material:   只用纯 UUID    带了就 "Missing Asset"
```

**内置白色 SpriteFrame**：`7d8f9b89-4fd1-4c9f-a3ab-38ec7cded7ca@f9941`，配合 `_color` 染色即得任意颜色方块。

### 4.6 手动计算的致命风险

一组 27 hex → 9 组 Base64 涉及 9 次 hex→dec→bitshift→Base64 查表。**任何一步字符提取错位或顺序颠倒**都会产生无效 `__type__`。**永远从 .meta 复制压缩 UUID，或使用工具脚本计算。**

---

## 五、资源引用三种方式

| 引用 | 含义 | 作用域 |
|------|------|--------|
| `{ "__id__": 12 }` | 文件内部对象引用 | 当前 .scene / .prefab |
| `{ "__uuid__": "xxx-xxx..." }` | 跨文件资源引用 | 全局 AssetManager |
| `{ "__uuid__": "xxx@f9941" }` | 子资源引用 | 仅 SpriteFrame |

---

## 六、Prefab 变体机制

### 6.1 身份标记

```
每个节点   → cc.PrefabInfo     (fileId = UUID-v4)
每个组件   → cc.CompPrefabInfo  (fileId = 唯一标识)
```

### 6.2 PrefabInfo 结构

```json
{
  "__type__": "cc.PrefabInfo",
  "root": { "__id__": 1 },      // 所属节点
  "asset": { "__id__": 0 },      // Prefab 根对象
  "fileId": "uuid-v4-format",    // 全局唯一标识
  "instance": null,              // 源文件中为 null
  "targetOverrides": null,
  "nestedPrefabInstanceRoots": null
}
```

### 6.3 场景中实例化 Prefab

```
1. push cc.PrefabInstance → prefab: { __uuid__: "..." }
2. 深拷贝 Prefab 节点到场景
   - Node._prefab → Id(instanceIdx)
   - Component.__prefab → Id(instanceIdx)
   - PrefabInfo.instance → Id(instanceIdx)
3. CompPrefabInfo 不拷贝到场景
```

### 6.4 Override 追踪

编辑器中修改 Prefab 实例属性 → 通过 `fileId` 比对与源文件的差异 → 标记为 override。

---

# 第二篇：工具使用篇

---

## 一、工具目录结构

```
_tools/
├── cocos-builder.js              # 主入口（导出 + CLI 转发）
├── cli.js                        # CLI 入口（package.json bin 指向此文件）
├── package.json                  # Node 工具包配置
├── cocos工具手册.md               # 本文档
├── examples/                     # 示例配置
│   └── scene-config.example.json
├── lib/                          # 核心模块（9 个 .js）
│   ├── uuid.js                   #   UUID 压缩/解压/生成
│   ├── types.js                  #   数据类型模板（Vec3、Color 等）
│   ├── constants.js              #   已知 UUID 映射
│   ├── utils.js                  #   通用工具函数
│   ├── templates.js              #   组件模板生成
│   ├── base-builder.js           #   Builder 基类（节点/组件管理、__id__偏移、JSON配置解析）
│   ├── prefab-builder.js         #   Prefab 构建器
│   ├── scene-builder.js          #   Scene 构建器
│   └── clean.js                  #   清理场景 _id 字段
└── demo/                         # 可独立运行的 Demo 脚本
    ├── game-over-panel.js        #   演示：生成 GameOverPanel.prefab
    └── ui-demo-scene.js          #   演示：生成 UIDemo.scene
```

> ⚠️ **整个 `_tools/` 目录是纯开发期工具链，Cocos Creator 构建时完全不依赖它。** 打包发布时可安全排除。Demo 脚本的输出目标为主项目 `assets/` 目录，不会污染 `_tools/`。

## 二、工具概览

`cocos-builder.js` 是基于 Node.js 的场景/Prefab JSON 自动化构建工具。

| 功能 | 说明 |
|------|------|
| 生成/追加 Prefab | 从零创建或追加节点到已有 .prefab |
| 生成/追加 Scene | 从零创建或追加节点到已有 .scene |
| 编辑已有文件 | moveNode/moveComponent/addChildNode/deleteNode/deleteComponent |
| UUID 压缩/解压 | 交互式工具，验证映射关系 |
| 清理缓存 | 清理 `library/` `temp/`（资产重新生成后必须执行） |
| API 调用 | `require('./cocos-builder')` 编程式构建 |
| 内置 Demo | `demo/` 下可独立运行，展示 Prefab/Scene 构建用法 |

## 三、命令行

入口文件：`cocos-builder.js`（兼容入口，自动转发到 `cli.js`）或 `cli.js`（直接入口），两者等效。

```bash
# 运行内置 Demo
node cocos-builder.js

# UUID 工具
node cocos-builder.js uuid                              # 验证已知映射
node cocos-builder.js uuid <标准UUID>                    # 压缩
node cocos-builder.js uuid <压缩形态>                    # 解压

# Prefab
node cocos-builder.js prefab <config.json>               # 生成/追加 Prefab
node cocos-builder.js prefab <config.json> <输出路径>     # 指定输出

# Scene
node cocos-builder.js scene <config.json>                # 生成/追加 Scene
node cocos-builder.js scene <config.json> <输出路径>      # 指定输出

# 清理
node cocos-builder.js clean <scene1.scene> [scene2 ...]  # 清除 cc.Scene._id
node cocos-builder.js clean-cache                        # 清理 library/ temp/ 缓存目录
```

**命令输出示例**：
```bash
$ node cocos-builder.js uuid "4c18be38-6250-4b43-9d40-d65e3a7df141"
UUID压缩: 4c18be38... → 4c18b44YlBLQ51A1l46ffFB

$ node cocos-builder.js prefab prefab-config.example.json
📄 配置: prefab-config.example.json
✅ Prefab新建成功! 名称: GameOverPanel  总对象: 25
   写入: assets/resources/prefabs/ui/GameOverPanel.prefab
```

---

## 四、JSON 配置格式

### 4.1 Prefab 配置

```json
{
  "name": "GameOverPanel",
  "scriptUuid": "4c18b44YlBLQ51A1l46ffFB",
  "outputPath": "assets/resources/prefabs/ui/GameOverPanel.prefab",
  "fileIdPrefix": "gameOver",
  "loadPath": null,
  "nodes": [
    { "name": "MyRoot", "parent": null, "position": [0, 0, 0] },
    { "name": "ChildLabel", "parent": "MyRoot", "position": [0, 200, 0] }
  ],
  "components": [
    { "type": "UITransform", "node": "MyRoot", "size": [540, 960] },
    { "type": "UITransform", "node": "ChildLabel", "size": [400, 60] },
    { "type": "Label", "node": "ChildLabel", "text": "Hello",
      "fontSize": 48, "lineHeight": 56,
      "color": [255, 215, 0, 255], "bold": true,
      "hAlign": 1, "vAlign": 1 }
  ]
}
```

| 顶层字段 | 必填 | 说明 |
|---------|------|------|
| `name` | ✅ | 名称，同时作为文件名 |
| `scriptUuid` | 推荐 | 默认脚本的**压缩 UUID** |
| `outputPath` | 推荐 | 输出路径（相对项目根） |
| `fileIdPrefix` | 推荐 | PrefabInfo fileId 前缀 |
| `loadPath` | 追加时 | 已有 .prefab 路径（触发追加模式） |
| `nodes` | ✅ | 节点定义 |
| `components` | ✅ | 组件定义 |

**节点字段**：

| 字段 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | ✅ | — | 全局唯一名称 |
| `parent` | ✅ | — | 父节点名，`null`=根 |
| `position` | 否 | `[0,0,0]` | `[x, y, z]` |
| `static` | 否 | false | 静态标记 |
| `scale` | 否 | `[1,1,1]` | 缩放 |

### 4.2 Scene 配置

```json
{
  "name": "MainMenu",
  "scenePath": "assets/scenes/MainMenu.scene",
  "nodes": [
    { "name": "Canvas", "parent": null, "position": [0, 0, 0] },
    { "name": "Camera", "parent": "Canvas", "position": [0, 0, 1000] },
    { "name": "TitleLabel", "parent": "Canvas", "position": [0, 400, 0] }
  ],
  "components": [
    { "type": "UITransform", "node": "Canvas", "size": [1080, 1920] },
    { "type": "Canvas", "node": "Canvas", "camera": "Camera",
      "designWidth": 1080, "designHeight": 1920 },
    { "type": "Camera", "node": "Camera" },
    { "type": "UITransform", "node": "TitleLabel", "size": [600, 80] },
    { "type": "Label", "node": "TitleLabel", "text": "Hello",
      "fontSize": 48, "lineHeight": 56 }
  ]
}
```

区别：Scene 不需要 `scriptUuid`/`fileIdPrefix`；`outputPath` 换成 `scenePath`。

**追加模式**：Scene 配置同样支持 `loadPath`。加入该字段后工具加载已有 Scene 并追加新节点/组件：

```json
{
  "loadPath": "assets/scenes/Existing.scene",
  "nodes": [
    { "name": "NewNode", "parent": "Canvas", "position": [100, 0, 0] }
  ],
  "components": [
    { "type": "UITransform", "node": "NewNode", "size": [50, 50] }
  ]
}
```

### 4.3 追加模式

配置中加入 `loadPath` 即进入追加模式：

```json
{
  "loadPath": "assets/prefabs/Existing.prefab",
  "nodes": [
    { "name": "NewNode", "parent": "ExistingParent", "position": [100, 0, 0] }
  ],
  "components": [
    { "type": "UITransform", "node": "NewNode", "size": [50, 50] }
  ]
}
```

内部处理：解析已有文件 → 偏移新对象 `__id__` → 合并数组 → 已有节点追加新引用。

### 4.4 组件参数速查

#### UITransform
```json
{ "type": "UITransform", "node": "N", "size": [width, height] }
```

#### Sprite
```json
{
  "type": "Sprite", "node": "N",
  "color": [r, g, b, a],
  "spriteFrame": "uuid@f9941"     // 可选，默认白色
}
```

#### Label
```json
{
  "type": "Label", "node": "N",
  "text": "内容", "fontSize": 24, "lineHeight": 30,
  "color": [255,255,255,255], "bold": false,
  "hAlign": 1, "vAlign": 1,
  // hAlign: 0=LEFT 1=CENTER 2=RIGHT
  // vAlign: 0=TOP 1=CENTER 2=BOTTOM
  "overflow": 0, "wrap": true, "fontFamily": "Arial"
}
```

#### Button
```json
{
  "type": "Button", "node": "N",
  "target": "LabelNodeName",       // ← 指向 Label 所在节点名！可选，无目标时不填或填 null
  "colors": {
    "normal": [100,180,255,255],
    "hover": [130,200,255,255],
    "pressed": [60,140,220,255],
    "disabled": [80,80,80,255]
  }
}
```

#### Layout
```json
{
  "type": "Layout", "node": "N",
  "layoutType": 3,                 // 0=NONE 1=H 2=V 3=GRID
  "resizeMode": 1,                 // ⚠️ 永不为 2
  "cellSize": [180, 160],
  "startAxis": 0,
  "spacingX": 10, "spacingY": 10,
  "padding": [L, R, T, B],
  "constraint": 2, "constraintNum": 3
  // constraint: 0=NONE 1=FIXED_ROW 2=FIXED_COL
}
```

#### Widget
```json
{
  "type": "Widget", "node": "N",
  "alignFlags": 45,               // 位掩码: TOP=1 MID=2 BOT=4 LEFT=8 CENTER=16 RIGHT=32
  "alignMode": 0,                 // 0=ALWAYS 1=ON_WINDOW_RESIZE 2=ONCE
  "targetRef": "ParentNode",      // ← Widget 对齐目标节点名，可选，不填时 _target 为 null
  "left": 0, "right": 0, "top": 0, "bottom": 0,
  "hCenter": 0, "vCenter": 0
}
```

#### Canvas
```json
{
  "type": "Canvas", "node": "N",
  "camera": "CameraNodeName",      // ← 指向 Camera 节点名！
  "designWidth": 1080, "designHeight": 1920
}
```

#### Camera
```json
{ "type": "Camera", "node": "N" }
```

#### Script（自定义脚本）
```json
{
  "type": "Script", "node": "N",
  "scriptUuid": "压缩UUID",        // 不填则用顶层 scriptUuid
  "props": {
    "propName1": { "node": "TargetNode", "component": "Label" },
    "propName2": { "node": "TargetNode" }
  }
}
```

---

## 五、API 编程参考

```javascript
const {
  PrefabBuilder, SceneBuilder,
  compressUuid, decompressUuid,
  generateFileIdV4, KNOWN_UUIDS,
  stripSceneFileIds
} = require('./cocos-builder');
```

### PrefabBuilder

```javascript
const b = new PrefabBuilder({
  name: 'MyPanel',
  scriptUuid: '4c18b44YlBLQ51A1l46ffFB',   // 压缩 UUID
  outputPath: 'assets/prefabs/MyPanel.prefab',
  fileIdPrefix: 'myPanel'
});

// 链式调用添加节点和组件
b.addNode({ name: 'Root', parent: null, position: [0, 0, 0] })
 .addNode({ name: 'Title', parent: 'Root', position: [0, 200, 0] })
 .addUITransform({ node: 'Root', size: [540, 960] })
 .addUITransform({ node: 'Title', size: [400, 60] })
 .addLabel({ node: 'Title', text: '标题', fontSize: 48, lineHeight: 56 })
 .addScript({ node: 'Root', props: {
   titleLabel: { node: 'Title', component: 'Label' }
 }});

// 追加模式：先加载已有文件
b.load('assets/prefabs/Existing.prefab')
 .addNode({ name: 'NewNode', parent: 'ExistingRoot', position: [100, 0, 0] })
 .addUITransform({ node: 'NewNode', size: [50, 50] })
 .addSprite({ node: 'NewNode', color: [255, 0, 0, 255] });

// 构建并写入
b.write();  // 或 b.build() 获取数组自己写入
```

### SceneBuilder

```javascript
const sb = new SceneBuilder({
  name: 'MainMenu',
  scenePath: 'assets/scenes/MainMenu.scene'
});

sb.addNode({ name: 'Canvas', parent: null })
  .addNode({ name: 'Camera', parent: 'Canvas', position: [0, 0, 1000] })
  .addUITransform({ node: 'Canvas', size: [1080, 1920] })
  .addCanvas({ node: 'Canvas', camera: 'Camera', designWidth: 1080, designHeight: 1920 })
  .addCamera({ node: 'Camera' });

sb.write();
```

### UUID 工具函数

```javascript
// 压缩
compressUuid('4c18be38-6250-4b43-9d40-d65e3a7df141')
// → '4c18b44YlBLQ51A1l46ffFB'

// 解压
decompressUuid('4c18b44YlBLQ51A1l46ffFB')
// → '4c18be38-6250-4b43-9d40-d65e3a7df141'

// 生成 UUID-v4（用于 PrefabInfo.fileId）
generateFileIdV4()
// → 'a1b2c3d4-e5f6-4a7b-8901-cdef23456789'

// 清理场景文件中 cc.Scene 上的 _id（Cocos 编辑器导入时会自动加回）
stripSceneFileIds('assets/scenes/MyScene.scene')
// → 🧹 已清理 1 个 _id: assets/scenes/MyScene.scene
```

### 编辑已有文件（移动节点/组件）

加载已有 Prefab 或 Scene 后，可通过以下方法修改结构（仅改字段引用，不破坏 `__id__` 索引）。**以下方法 PrefabBuilder 和 SceneBuilder 通用**：

```javascript
// Prefab 示例
const b = new PrefabBuilder({ name: 'Edit' });
b.load('assets/prefabs/xxx.prefab');

// Scene 示例
const sb = new SceneBuilder({ name: 'Edit' });
sb.load('assets/scenes/Game.scene');

// --- 以下方法两者均支持 ---

// 1. 节点搬家——改父节点
b.moveNode('ChildA', 'NewParentB');

// 2. 组件搬家——移到另一个已有节点
b.moveComponent('NodeA', 'cc.Label', 'NodeB');

// 3. 新建空白子节点（自动继承父节点尺寸）
b.addChildNode('Parent', 'NewChild', { size: [200, 60] });

// 4. 便捷：新建子节点 + 移入组件（解决 renderable 冲突）
b.moveComponentToChild('HpBar', 'HpText', 'cc.Label');

b.saveLoaded();   // Prefab: 直接写回
sb.saveLoaded();  // Scene: 直接写回
```

| 方法 | 说明 |
|------|------|
| `moveNode(name, newParent)` | 节点搬家（改 `_parent` + 双方 `_children`） |
| `moveComponent(fromNode, type, toNode)` | 组件搬家（改 `node.__id__` + 双方 `_components`） |
| `addChildNode(parent, name, opts?)` | 新建空白子节点（仅 UITransform，返回 idx） |
| `moveComponentToChild(parent, child, type, opts?)` | 等价 `addChildNode` + `moveComponent` |
| `deleteNode(name)` | 安全删除节点及子树（**仅末尾**） |
| `deleteComponent(nodeName, compType)` | 安全删除单个组件（**仅末尾**） |

### 删除节点/组件（安全物理删除）

安全的物理删除能力，与 `append-only` 原则互补——**仅当目标对象在数组末尾时**才执行物理删除（此时 splice 不影响其他索引）。**PrefabBuilder 和 SceneBuilder 通用**。

```javascript
// Prefab 示例
const b = new PrefabBuilder({ name: 'Edit' });
b.load('assets/prefabs/xxx.prefab');
b.deleteNode('TestNode');                          // 删除节点及其所有子节点、组件、PrefabInfo
b.deleteComponent('SomeNode', 'cc.Label');         // 删除单个组件及其 CompPrefabInfo
b.saveLoaded();

// Scene 示例
const sb = new SceneBuilder({ name: 'Edit' });
sb.load('assets/scenes/Game.scene');
sb.deleteNode('MoveTestChild');
sb.saveLoaded({ validate: true });                 // 写回前验证引用完整性
```

### saveLoaded 选项

`saveLoaded(opts?)` 支持以下选项：

| 选项 | 类型 | 说明 |
|------|------|------|
| `validate` | `boolean` | `true` 时写入前自动调用 `_validate()` 检测 ORPHAN、悬挂引用、renderable 冲突，发现问题即报错阻止写入 |

> ⚠️ **安全机制**：`deleteNode`/`deleteComponent` 内部调用 `canSafeDelete` 检测目标是否在数组末尾。若不在末尾，抛错并建议：
> 1. 先用 `moveNode` 把目标子树移至末尾
> 2. 或软删除（设置 `_active = false`）

### 静态构建方法

```javascript
// 从 JSON 配置直接构建（支持 loadPath 追加模式）
PrefabBuilder.fromJSON('examples/scene-config.example.json').write();
PrefabBuilder.fromJSON({ name: 'X', nodes: [...], components: [...] }).write();
SceneBuilder.fromJSON('examples/scene-config.example.json').write();
// Scene 追加模式：配置中加 "loadPath": "assets/scenes/Existing.scene"
SceneBuilder.fromJSON({ loadPath: 'assets/scenes/Game.scene', nodes: [...], components: [...] }).write();
```

---

## 六、Demo 脚本

`_tools/demo/` 下有两个可独立运行的 Demo，展示 Prefab 和 Scene 的构建用法：

### 运行方式

```bash
# 生成 GameOverPanel.prefab
node demo/game-over-panel.js

# 生成 UIDemo.scene
node demo/ui-demo-scene.js
```

> 两个 Demo 的产物直接写入主项目 `assets/` 目录，不会污染 `_tools/`。

### game-over-panel.js

生成一个完整的 `GameOverPanel.prefab`，包含遮罩、标题、详情、返回按钮及自定义脚本绑定，输出到 `assets/resources/prefabs/ui/GameOverPanel.prefab`。

### ui-demo-scene.js

生成一个最小可用的 `UIDemo.scene`（Canvas + Camera），输出到 `assets/scenes/UIDemo.scene`。

---

## 七、完整工作流举例

### 工作流：从零生成 Prefab

```
1. 编写 JSON 配置文件（参考 四、JSON 配置格式）
2. 确保 scriptUuid 是压缩格式（从 .meta 复制）
3. 运行: node cocos-builder.js prefab config.json
4. Cocos 编辑器刷新资源面板 → 新 Prefab 出现
5. 拖入场景使用
```

### 工作流：往已有 Prefab 追加节点

```
1. 在配置中加入 "loadPath": "路径/to/已有.prefab"
2. 定义新的 nodes 和 components
3. 运行: node cocos-builder.js prefab config.json
4. 工具自动处理偏移量和引用完整性
```

### 工作流：验证 UUID

```
1. 打开 .ts 对应的 .meta 文件 → 复制 uuid 字段（压缩格式）
2. 运行: node cocos-builder.js uuid <压缩UUID>
   确认能成功解压为标准 UUID
3. 对比场景/预制体中的 __type__ 与 .meta 中的 uuid 是否一致
```

### 工作流：修复损坏的 Prefab

```
现象: Cocos 编辑器报 "Missing class: xxxxxx"

1. 从错误信息中找到报错的 __type__ 值
2. 定位对应 .ts 的 .meta 文件 → 复制正确的压缩 UUID
3. 打开 .prefab JSON → 搜索并替换错误的 __type__
4. 验证: node cocos-builder.js uuid <新UUID> → 确认有效
5. 编辑器刷新 → 错误消失
```

---

## 八、快速错误对照表

| # | 错误现象 | 根因 | 修复 |
|---|---------|------|------|
| 1 | `comp.node.__id__` 不同步 | 添加组件后未回填 node 引用 | `sceneArr[compIdx].node.__id__ = ownerIdx` |
| 2 | `.prefab` 中 `_prefab: null` | 预制体节点未挂 PrefabInfo | 创建 PrefabInfo 并回填 |
| 3 | `Label._string` 缺失 → 解析失败 | JSON 中未写该字段 | 加上 `"_string": ""` |
| 4 | "Missing class: xxx" | `__type__` 用了原始 UUID | 改用**压缩 UUID**（23 字符） |
| 5 | `splice()` 后引用混乱 | 物理删除破坏索引 | 软删除：`_active = false` |
| 6 | "Missing Asset" on Prefab | `__uuid__` 误加了 `@f9941` | 去掉 `@f9941`，仅 SpriteFrame 需要 |
| 7 | 手动算的压缩 UUID 无效 | hex→base64 某步算错 | 从 .meta 复制或用工具计算 |
| 8 | `target.getComponent is not a function` | Button `_target` 为 `{"__id__": null}` | `_target` 写 `null`（或用工具 `Id()` 自动处理） |
| 9 | "Widget target must be one of the parent nodes" | Widget `_target` 指向自身节点 | `targetRef` 设为父节点或 `null` |
| 10 | "The uuid is already pointing to another asset" | prefab/ts 共用同一 UUID | 每个资产 `.meta` UUID 必须全局唯一 |
| 11 | "The same node can't have more than one renderable component" | 节点上存在 Sprite+Label 或 Sprite+Graphics 等 | 将其中一个移到子节点：`moveComponentToChild()` |

### 12. 手动删除节点安全规则（新增）

| 情况 | 判断 | 做法 |
|------|------|------|
| 节点在数组末尾 | `deleteNode()` 自动检测并安全删除 | ✅ 直接用 |
| 节点在数组中间 | 工具抛错阻止 | ① 先 `moveNode` 移到末尾 → `deleteNode` ② 或 `_active = false` 软删除 |
| 节点有外部引用 | `_validate()` 报告 ORPHAN/悬挂 | 先清理引用，再删除 |

### 13. 缓存清理（新增）

**何时需要**：使用工具生成或修改 `.scene` / `.prefab` 后，Cocos 编辑器可能缓存旧版本数据。

```bash
# 清理所有编辑器缓存
node cocos-builder.js clean-cache
# → 删除 library/ 和 temp/ 目录
# → Cocos 下次打开时自动重新编译
```

> ⚠️ 清理缓存后首次打开 Cocos 编辑器会较慢（需重新编译所有脚本），但这是解决"工具修改后编辑器不识别"的最可靠方式。

---

## 九、验证清单

```
① 无重复 __id__ 引用
② 每个 __id__ 指向有效 sceneArr 索引
③ Node._parent 正确（场景根 = Id(1)）
④ 每个 Node 至少 1 个 UITransform（纯 Camera 节点除外）
⑤ Component.node.__id__ 指向所属 Node
⑥ _children 顺序 = 渲染顺序（低索引→底层）
⑦ .prefab: _prefab/__prefab 非 null + PrefabInfo 完整
⑧ .scene: _prefab/__prefab = null（原生节点）
⑨ Label._string 字段存在，空则 ""
⑩ 脚本 __type__ = 压缩 UUID（23 字符，非原始 36 字符）
⑪ 压缩 UUID 已验证可解压（用工具确认）
⑫ 追加模式下不修改已有索引
⑬ Widget/Button/_parent 等引用字段无 `{"__id__": null}`（必须为字面量 `null`）
⑭ 每个资产 .meta UUID 全局唯一（prefab/ts/scene 互不冲突）
⑮ 每个节点至多一个 renderable 组件（Sprite/Label/Graphics，冲突时用 moveComponentToChild）
```

> 💡 **自动化验证**：调用 `builder.saveLoaded({ validate: true })` 可在写入前自动检测 ORPHAN 对象、悬挂引用和 renderable 冲突，无需手动逐项核对。

---

## 十、基础类型参考

```json
cc.Color: { "__type__": "cc.Color", "r": 0-255, "g": 0-255, "b": 0-255, "a": 0-255 }
cc.Vec2:  { "__type__": "cc.Vec2",  "x": n, "y": n }
cc.Vec3:  { "__type__": "cc.Vec3",  "x": n, "y": n, "z": n }
cc.Size:  { "__type__": "cc.Size",  "width": n, "height": n }
cc.Quat:  { "__type__": "cc.Quat",  "x": 0, "y": 0, "z": 0, "w": 1 }
```

---

## 附录

### 批处理限制

```
MAX_NEW_NODES      = 50
MAX_NEW_COMPONENTS = 100
MAX_NESTING_DEPTH  = 8
MAX_SCENE_SIZE     = 2 MB
```

### 工作区路径约定

工具运行在当前项目根目录，所有路径相对项目根：
- 配置文件中 `outputPath`/`scenePath`/`loadPath` 均为相对路径
- 命令行中可选输出路径同样为相对路径

### 原理篇与工具篇的关系

- 原理篇解释**为什么**要这样做——理解引擎底层机制才能避免出错
- 工具篇告诉**怎么做**——直接用 JSON 配置或 API 构建，不需要手写 JSON
- 遇到工具无法覆盖的场景 → 回到原理篇理解数据结构 → 手动编辑 JSON
