// ============================================================
// SceneBuilder — 场景节点生成（继承基类）
// ============================================================
const fs = require('fs');
const NodeBuilderBase = require('./base-builder');
const { Vec3, Id } = require('./types');
const { shiftIDs, shiftMapNewOnly } = require('./utils');
const { genObjId, generateFileIdV4 } = require('./uuid');
const { sceneGlobalsTemplate } = require('./templates');

class SceneBuilder extends NodeBuilderBase {
    constructor(config) {
        super(config);
        this.isScene = true;
        this.scenePath = config.scenePath || config.outputPath || `assets/scenes/${this.name}.scene`;
        this.outputPath = this.scenePath;
        this.fileIdPrefix = '';
        this._isLoaded = false;
        this._loadedArr = null;
    }

    _pushNodeMeta(name) { /* no-op */ }
    _pushCompMeta(nodeName, type) { return -1; }

    load(scenePath) {
        const p = scenePath || this.scenePath;
        if (!fs.existsSync(p)) throw new Error(`场景文件不存在: ${p}`);
        this._loadedArr = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (!Array.isArray(this._loadedArr)) throw new Error(`格式错误: ${p} 不是有效场景文件`);
        // 清理 mutable 状态以支持多轮 load→append→write
        this.sceneArr = [];
        this._nodeMap = {};
        this._compMap = {};
        this._steps = [];
        this._pendingResolutions = [];
        this._newCompKeys = new Set();
        this._finalized = false;
        this._existingNodeNames = new Set();
        this._existingCompKeys = new Set();
        for (let i = 0; i < this._loadedArr.length; i++) {
            const obj = this._loadedArr[i];
            if (!obj || typeof obj !== 'object') continue;
            if (obj.__type__ === 'cc.Node' && obj._name) {
                this._nodeMap[obj._name] = i;
                this._existingNodeNames.add(obj._name);
            }
        }
        for (let i = 0; i < this._loadedArr.length; i++) {
            const obj = this._loadedArr[i];
            if (!obj || typeof obj !== 'object' || !obj.node || obj.node.__id__ === undefined) continue;
            const ownerIdx = obj.node.__id__;
            const owner = this._loadedArr[ownerIdx];
            if (owner && owner._name && obj.__type__) {
                const t = obj.__type__;
                const key = owner._name + '|' + (t === this.scriptUuid ? 'Script' : t.replace('cc.', ''));
                this._compMap[key] = i;
                this._existingCompKeys.add(key);
            }
        }
        this._isLoaded = true;
        console.log(`📂 已加载场景: ${p}  (${this._loadedArr.length} 个对象)`);
        console.log(`   已有节点: ${Object.keys(this._nodeMap).join(', ')}`);
        return this;
    }

    _finalize() {
        if (this._isLoaded && this._loadedArr) {
            this._finalizeLoadedScene();
        } else {
            this._finalizeNewScene();
        }
        this._applyNodeFields();
        this._fixRootParent();
        this._autoInjectCanvasWidget();
        this._fixCameraComponentRef();
        this._resolvePendingScriptProps();
        const mode = this._isLoaded ? '追加' : '新建';
        console.log(`✅ 场景${mode}成功! 名称: ${this.name}  总对象: ${this.sceneArr.length}  脚本UUID: ${this.scriptUuid}`);
    }

    _finalizeLoadedScene() {
        const offset = this._loadedArr.length;
        const newArr = this.sceneArr;
        newArr.forEach(obj => shiftIDs(obj, offset));
        shiftMapNewOnly(this._nodeMap, offset, this._existingNodeNames);
        shiftMapNewOnly(this._compMap, offset, this._existingCompKeys);
        this.sceneArr = this._loadedArr.concat(newArr);
    }

    _finalizeNewScene() {
        const origNodeMap = { ...this._nodeMap };
        const origCompMap = { ...this._compMap };
        const globalsBlock = sceneGlobalsTemplate();
        const userArr = this.sceneArr.slice();
        const userCount = userArr.length;

        globalsBlock.forEach(obj => shiftIDs(obj, userCount, false));
        this.sceneArr = [...userArr, ...globalsBlock];

        // Cocos 要求: SceneAsset 在 index 0, cc.Scene 在 index 1
        const shell = { __type__: 'cc.SceneAsset', _name: this.name, _objFlags: 0, _native: '', scene: Id(1) };
        const sceneObj = {
            __type__: 'cc.Scene', _name: this.name, _objFlags: 0,
            _parent: null, _children: [{ __id_marker__: 0 }], _active: true,
            _components: [], _prefab: null,
            autoReleaseAssets: false,
            _globals: { __id_marker__: userCount },
            _id: generateFileIdV4(),
        };

        this.sceneArr.unshift(shell, sceneObj);
        this.sceneArr.forEach(obj => shiftIDs(obj, 2));

        for (const k of Object.keys(this._nodeMap)) this._nodeMap[k] = (origNodeMap[k] || 0) + 2;
        for (const k of Object.keys(this._compMap)) this._compMap[k] = (origCompMap[k] || 0) + 2;
        shell.scene = Id(1);
    }

    _fixRootParent() {
        const rootNodeName = this._steps.find(s => s.type === 'node' && !s.parentName)?.name;
        if (rootNodeName && this._nodeMap[rootNodeName] !== undefined) {
            // cc.Scene 始终在 index 1（SceneAsset 在 index 0）
            this.sceneArr[this._nodeMap[rootNodeName]]._parent = Id(1);
        }
    }

    _autoInjectCanvasWidget() {
        if (!this.isScene) return;
        if (this._compMap['Canvas|Canvas'] === undefined) return;
        const canvasNodeIdx = this._nodeMap['Canvas'];
        if (canvasNodeIdx === undefined || this._compMap['Canvas|Widget']) return;

        const widgetIdx = this.sceneArr.length;
        this.sceneArr.push({
            __type__: 'cc.Widget', _name: '', _objFlags: 0,
            node: Id(canvasNodeIdx),
            _enabled: true, __prefab: null,
            _alignFlags: 45, _target: null,
            _left: 0, _right: 0,
            _top: 5.684341886080802e-14, _bottom: 5.684341886080802e-14,
            _horizontalCenter: 0, _verticalCenter: 0,
            _isAbsLeft: true, _isAbsRight: true,
            _isAbsTop: true, _isAbsBottom: true,
            _isAbsHorizontalCenter: true, _isAbsVerticalCenter: true,
            _originalWidth: 0, _originalHeight: 0,
            _alignMode: 2, _lockFlags: 0,
            _id: genObjId(),
        });
        this._compMap['Canvas|Widget'] = widgetIdx;
        const canvasNode = this.sceneArr[canvasNodeIdx];
        if (canvasNode && canvasNode._components) {
            canvasNode._components = [...canvasNode._components, Id(widgetIdx)];
        }
    }

    _fixCameraComponentRef() {
        const canv = this._compMap['Canvas|Canvas'];
        const cam = this._compMap['Camera|Camera'];
        if (canv === undefined || cam === undefined) return;
        const canvasComp = this.sceneArr[canv];
        if (canvasComp && canvasComp._cameraComponent) {
            canvasComp._cameraComponent = Id(cam);
        }
    }

    // ================================================================
    // 编辑已有 Scene 的方法（moveNode/moveComponent 继承基类）
    // addChildNode / deleteNode / deleteComponent 见下方（不含 PrefabInfo）
    // ================================================================

    _editLogPrefix() { return ' [Scene]'; }

    _findComponentFallback(fromNodeName, shortType) {
        const fromIdx = this._nodeMap[fromNodeName];
        if (fromIdx === undefined) return undefined;
        const fromNode = this._loadedArr[fromIdx];
        if (!fromNode || !fromNode._components) return undefined;
        for (const compRef of fromNode._components) {
            if (!compRef || compRef.__id__ === undefined) continue;
            const c = this._loadedArr[compRef.__id__];
            if (c && c.__type__) {
                const tShort = c.__type__.replace('cc.', '');
                if (tShort === shortType) {
                    this._compMap[fromNodeName + '|' + shortType] = compRef.__id__;
                    return compRef.__id__;
                }
            }
        }
        return undefined;
    }

    /** 
     * 新建一个空白子节点（仅 UITransform，不含 PrefabInfo）
     * @param {string} parentName 父节点
     * @param {string} childName 新节点名
     * @param {object} [opts] { size: [w,h], position: [x,y,z] }
     * @returns {number} 新节点在 _loadedArr 中的索引
     */
    addChildNode(parentName, childName, opts = {}) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 场景');

        const parentIdx = this._nodeMap[parentName];
        if (parentIdx === undefined) throw new Error(`节点不存在: ${parentName}`);

        const size = opts.size || this._inheritParentSize(parentName);

        const childIdx = this._loadedArr.length;
        const uitIdx = childIdx + 1;

        const childNode = {
            __type__: 'cc.Node', _name: childName, _objFlags: 0,
            _parent: Id(parentIdx),
            _children: [],
            _active: true,
            _components: [Id(uitIdx)],
            _prefab: null,
            _lpos: opts.position ? Vec3(opts.position[0], opts.position[1], opts.position[2]) : Vec3(0, 0, 0),
            _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
            _lscale: Vec3(1, 1, 1),
            _layer: 33554432, _euler: Vec3(0, 0, 0),
            _id: genObjId(),
        };

        const childUITransform = {
            __type__: 'cc.UITransform', _name: '', _objFlags: 0,
            node: Id(childIdx),
            _enabled: true, __prefab: null,
            _contentSize: { __type__: 'cc.Size', width: size[0], height: size[1] },
            _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
            _id: genObjId(),
        };

        this._loadedArr.push(childNode, childUITransform);

        const parentNode = this._loadedArr[parentIdx];
        if (!parentNode._children) parentNode._children = [];
        parentNode._children.push(Id(childIdx));

        this._nodeMap[childName] = childIdx;
        this._existingNodeNames.add(childName);
        // 注册 UITransform 到 _compMap
        this._compMap[childName + '|UITransform'] = uitIdx;
        this._existingCompKeys.add(childName + '|UITransform');

        console.log(`🔧 [Scene] 已创建子节点 "${childName}" (idx: ${childIdx}) 在 "${parentName}" 下, size: ${size[0]}x${size[1]}`);
        return childIdx;
    }

    /** 
     * 新建子节点并移入组件
     * @param {string} parentName 父节点
     * @param {string} childName 新子节点名
     * @param {string} compType 要移入的组件类型
     * @param {object} [opts] { size: [w,h], position: [x,y,z] }
     */
    moveComponentToChild(parentName, childName, compType, opts = {}) {
        this.addChildNode(parentName, childName, opts);
        this.moveComponent(parentName, compType, childName);
        return this;
    }

    /**
     * 安全删除节点及其所有子节点、组件
     * 仅当节点在数组末尾（无索引偏移）时执行物理删除，否则报错建议软删除
     * @param {string} nodeName 要删除的节点名
     */
    deleteNode(nodeName) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 场景');
        const nodeIdx = this._nodeMap[nodeName];
        if (nodeIdx === undefined) throw new Error(`节点不存在: ${nodeName}`);

        const { collectNodeIndices, canSafeDelete, safeSplice } = require('./utils');
        const allIndices = collectNodeIndices(this._loadedArr, nodeIdx);

        // 安全检查（Scene 不需要检查 PrefabInfo 引用，因为场景节点没有）
        const check = canSafeDelete(this._loadedArr, allIndices, { skipDangleCheck: true });
        if (!check.safe) {
            const msg = check.reason.includes('索引不在数组末尾')
                ? `❌ 无法安全删除 "${nodeName}"：节点不在数组末尾，splice 会破坏后续索引。\n` +
                  `   建议方案:\n` +
                  `   1. 软删除：this._loadedArr[${nodeIdx}]._active = false\n` +
                  `   2. 重新排序：先用 moveNode 把该节点子树移到末尾，再调用 deleteNode`
                : `❌ 无法安全删除 "${nodeName}"：${check.reason}`;
            throw new Error(msg);
        }

        // 从父节点 _children 移除引用
        const node = this._loadedArr[nodeIdx];
        const parentId = node._parent ? node._parent.__id__ : null;
        if (parentId !== null && parentId !== undefined) {
            const parent = this._loadedArr[parentId];
            if (parent && parent._children) {
                parent._children = parent._children.filter(c => c && c.__id__ !== nodeIdx);
            }
        }

        // 清理映射表
        for (const i of allIndices) {
            const obj = this._loadedArr[i];
            if (!obj) continue;
            if (obj.__type__ === 'cc.Node' && obj._name) delete this._nodeMap[obj._name];
            if (obj.__type__ && obj.node) {
                for (const [k, v] of Object.entries(this._compMap)) {
                    if (v === i) delete this._compMap[k];
                }
            }
        }

        const result = safeSplice(this._loadedArr, allIndices);
        if (result.success) {
            console.log(`🔧 [Scene] 已删除节点 "${nodeName}" 及其 ${allIndices.length - 1} 个关联对象`);
        }
        return this;
    }

    /**
     * 安全删除节点上的单个组件
     * @param {string} nodeName 节点名
     * @param {string} compType 组件类型，如 'Label' / 'Sprite' / 'Button'
     */
    deleteComponent(nodeName, compType) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 场景');
        const shortType = compType.replace('cc.', '');
        const compKey = nodeName + '|' + shortType;
        const compIdx = this._compMap[compKey];
        if (compIdx === undefined) throw new Error(`组件不存在: ${compKey}`);

        const node = this._loadedArr[this._nodeMap[nodeName]];
        if (!node) throw new Error(`节点不存在: ${nodeName}`);

        const { canSafeDelete, safeSplice } = require('./utils');
        const check = canSafeDelete(this._loadedArr, [compIdx]);
        if (!check.safe) {
            throw new Error(`❌ 无法安全删除组件 "${compType}" from "${nodeName}": ${check.reason}`);
        }

        node._components = node._components.filter(c => c && c.__id__ !== compIdx);
        delete this._compMap[compKey];

        const result = safeSplice(this._loadedArr, [compIdx]);
        if (result.success) {
            console.log(`🔧 [Scene] 已删除组件 ${compType} from "${nodeName}"`);
        }
        return this;
    }

    /** 保存已加载场景的修改 */
    saveLoaded(outputPath, opts = {}) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 场景');
        if (opts.validate) {
            const backup = this.sceneArr;
            this.sceneArr = this._loadedArr;
            const errors = this._validate();
            this.sceneArr = backup;
            if (errors.length > 0) {
                console.error('  ❌ 保存前验证失败:');
                errors.forEach(e => console.error('    ' + e));
                throw new Error('验证失败，拒绝写入。使用 {validate:false} 跳过验证。');
            }
        }
        const out = outputPath || this.scenePath;
        fs.writeFileSync(out, JSON.stringify(this._loadedArr, null, 2));
        console.log(`   写入: ${out}`);
        return this;
    }

    static fromJSON(config) {
        config = typeof config === 'string' ? JSON.parse(fs.readFileSync(config, 'utf-8')) : config;
        const b = new SceneBuilder(config);
        if (config.loadPath) b.load(config.loadPath);
        NodeBuilderBase.populateFromConfig(b, config);
        return b;
    }
}

module.exports = SceneBuilder;
