// ============================================================
// PrefabBuilder — Prefab 生成/追加
// ============================================================
const fs = require('fs');
const NodeBuilderBase = require('./base-builder');
const { Id, Vec3, Quat, Size } = require('./types');
const { shiftIDs, shiftMapNewOnly } = require('./utils');
const { prefabInfoTemplate, compPrefabInfoTemplate, uitransformTemplate } = require('./templates');
const { genObjId } = require('./uuid');
const { UI_LAYER } = require('./constants');

class PrefabBuilder extends NodeBuilderBase {
    constructor(config) {
        super(config);
        this.isScene = false;
        this.outputPath = config.outputPath || `assets/resources/prefabs/${this.name}.prefab`;
        this.fileIdPrefix = config.fileIdPrefix || this.name.replace(/[^a-zA-Z0-9_]/g, '_');
        this._pfiMap = {};
        this._cpfiMap = {};
        this._isLoaded = false;
        this._loadedArr = null;
    }

    _pushNodeMeta(name) {
        const fileId = this.fileIdPrefix + '_' + name + '_PrefabInfo';
        const idx = this.sceneArr.length;
        this.sceneArr.push(prefabInfoTemplate(fileId));
        this._pfiMap[name] = idx;
        return idx;
    }

    _pushCompMeta(nodeName, type) {
        const fileId = this.fileIdPrefix + '_' + nodeName + '_' + type;
        const idx = this.sceneArr.length;
        this.sceneArr.push(compPrefabInfoTemplate(fileId));
        this._cpfiMap[nodeName + '|' + type] = idx;
        return idx;
    }

    load(prefabPath) {
        const p = prefabPath || this.outputPath;
        if (!fs.existsSync(p)) throw new Error(`预制体不存在: ${p}`);
        this._loadedArr = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (!Array.isArray(this._loadedArr)) throw new Error(`格式错误: ${p}`);
        if (this._loadedArr.length < 1 || this._loadedArr[0].__type__ !== 'cc.Prefab')
            throw new Error(`格式错误: ${p} 缺少 cc.Prefab 根对象`);

        // 清理 mutable 状态以支持多轮 load→append→write
        this.sceneArr = [];
        this._nodeMap = {};
        this._compMap = {};
        this._pfiMap = {};
        this._cpfiMap = {};
        this._steps = [];
        this._pendingResolutions = [];
        this._newCompKeys = new Set();
        this._finalized = false;
        this._existingNodeNames = new Set();
        this._existingCompKeys = new Set();
        this._existingPfiKeys = new Set();
        this._existingCpfiKeys = new Set();

        for (let i = 0; i < this._loadedArr.length; i++) {
            const obj = this._loadedArr[i];
            if (!obj || typeof obj !== 'object') continue;
            if (obj.__type__ === 'cc.Node' && obj._name) {
                this._nodeMap[obj._name] = i;
                this._existingNodeNames.add(obj._name);
            }
            if (obj.__type__ === 'cc.PrefabInfo' && obj.fileId)
                this._existingPfiKeys.add(obj.fileId);
            if (obj.__type__ === 'cc.CompPrefabInfo' && obj.fileId)
                this._existingCpfiKeys.add(obj.fileId);
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
        console.log(`📂 已加载预制体: ${p}  (${this._loadedArr.length} 个对象)`);
        console.log(`   已有节点: ${Object.keys(this._nodeMap).join(', ')}`);
        return this;
    }

    // ================================================================
    // 编辑已有 Prefab 的方法（moveNode/moveComponent 继承基类）
    // addChildNode / deleteNode / deleteComponent 见下方（含 PrefabInfo 处理）
    // ================================================================

    /** 
     * 新建一个空白子节点（仅 UITransform）
     * @param {string} parentName 父节点
     * @param {string} childName 新节点名
     * @param {object} [opts] { size: [w,h], position: [x,y,z] }
     * @returns {number} 新节点在 _loadedArr 中的索引
     */
    addChildNode(parentName, childName, opts = {}) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 预制体');

        const parentIdx = this._nodeMap[parentName];
        if (parentIdx === undefined) throw new Error(`节点不存在: ${parentName}`);

        const size = opts.size || this._inheritParentSize(parentName);

        // 生成唯一 PrefabInfo / CompPrefabInfo fileId
        const genFileId = (base) => {
            if (!this._existingPfiKeys || !this._existingPfiKeys.has(base)) return base;
            let n = 1;
            while (this._existingPfiKeys.has(base + '_' + n)) n++;
            return base + '_' + n;
        };
        const pfiFileId = genFileId(this.fileIdPrefix + '_' + childName + '_PrefabInfo');
        const cpfiFileId = genFileId(this.fileIdPrefix + '_' + childName + '_UITransform');

        const childIdx = this._loadedArr.length;
        const uitIdx = childIdx + 1;
        const pfiIdx = childIdx + 2;
        const cpfiIdx = childIdx + 3;

        const childNode = {
            __type__: 'cc.Node', _name: childName, _objFlags: 0,
            _parent: Id(parentIdx),
            _children: [],
            _active: true,
            _components: [Id(uitIdx)],
            _prefab: Id(pfiIdx),
            _lpos: opts.position ? Vec3(opts.position[0], opts.position[1], opts.position[2]) : Vec3(0, 0, 0),
            _lrot: Quat(), _lscale: Vec3(1, 1, 1),
            _layer: UI_LAYER, _euler: Vec3(0, 0, 0),
            _id: genObjId(),
        };

        const childUITransform = uitransformTemplate(childIdx, cpfiIdx, size[0], size[1], false);

        const pfi = prefabInfoTemplate(pfiFileId);
        const cpfi = compPrefabInfoTemplate(cpfiFileId);

        this._loadedArr.push(childNode, childUITransform, pfi, cpfi);

        const parentNode = this._loadedArr[parentIdx];
        if (!parentNode._children) parentNode._children = [];
        parentNode._children.push(Id(childIdx));

        this._nodeMap[childName] = childIdx;
        this._existingNodeNames.add(childName);
        this._pfiMap[childName] = pfiIdx;
        this._cpfiMap[childName + '|UITransform'] = cpfiIdx;
        if (this._existingPfiKeys) this._existingPfiKeys.add(pfiFileId);
        if (this._existingCpfiKeys) this._existingCpfiKeys.add(cpfiFileId);

        console.log(`🔧 已创建子节点 "${childName}" (idx: ${childIdx}) 在 "${parentName}" 下, size: ${size[0]}x${size[1]}`);
        return childIdx;
    }

    /** 
     * 便捷方法：新建子节点并移入组件（解决 renderable 冲突最常用）
     * 等价于 addChildNode + moveComponent
     * @param {string} parentName 父节点
     * @param {string} childName 新子节点名
     * @param {string} compType 要移入的组件类型，如 'cc.Label' / 'cc.Sprite'
     * @param {object} [opts] { size: [w,h], position: [x,y,z] }
     */
    moveComponentToChild(parentName, childName, compType, opts = {}) {
        this.addChildNode(parentName, childName, opts);
        this.moveComponent(parentName, compType, childName);
        return this;
    }

    /**
     * 安全删除节点及其所有子节点、组件、PrefabInfo
     * 仅当节点在数组末尾（无索引偏移）时执行物理删除，否则报错建议软删除
     * @param {string} nodeName 要删除的节点名
     */
    deleteNode(nodeName) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 预制体');
        const nodeIdx = this._nodeMap[nodeName];
        if (nodeIdx === undefined) throw new Error(`节点不存在: ${nodeName}`);

        const { collectNodeIndices, canSafeDelete, safeSplice } = require('./utils');
        const allIndices = collectNodeIndices(this._loadedArr, nodeIdx);

        // 安全检查
        const check = canSafeDelete(this._loadedArr, allIndices, { skipDangleCheck: true });
        if (!check.safe) {
            // 先试只删引用不 splice：标记 active=false + 移除引用
            const msg = check.reason.includes('索引不在数组末尾')
                ? `❌ 无法安全删除 "${nodeName}"：节点不在数组末尾，splice 会破坏后续索引。\n` +
                  `   建议方案:\n` +
                  `   1. 软删除：this._loadedArr[${nodeIdx}]._active = false（节点隐藏但不删除数据）\n` +
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
        function cleanMaps(arr, indices, nodeMap, compMap, pfiMap, cpfiMap) {
            for (const i of indices) {
                const obj = arr[i];
                if (!obj) continue;
                // 清理 _nodeMap
                if (obj.__type__ === 'cc.Node' && obj._name) delete nodeMap[obj._name];
                // 清理 _compMap
                if (obj.__type__ && obj.node && obj.node.__id__ !== undefined) {
                    const owner = arr[obj.node.__id__];
                    const shortType = obj.__type__.replace('cc.', '');
                    const key = (owner && owner._name || '?') + '|' + shortType;
                    for (const [k, v] of Object.entries(compMap)) {
                        if (v === i) delete compMap[k];
                    }
                }
                // 清理 PrefabInfo map
                if (obj.__type__ === 'cc.PrefabInfo' && obj.fileId) {
                    for (const [k, v] of Object.entries(pfiMap)) {
                        if (v === i) delete pfiMap[k];
                    }
                }
                if (obj.__type__ === 'cc.CompPrefabInfo' && obj.fileId) {
                    for (const [k, v] of Object.entries(cpfiMap)) {
                        if (v === i) delete cpfiMap[k];
                    }
                }
            }
        }
        cleanMaps(this._loadedArr, allIndices, this._nodeMap, this._compMap, this._pfiMap, this._cpfiMap);

        const result = safeSplice(this._loadedArr, allIndices);
        if (result.success) {
            console.log(`🔧 已删除节点 "${nodeName}" 及其 ${allIndices.length - 1} 个关联对象`);
        }
        return this;
    }

    /**
     * 安全删除节点上的单个组件
     * @param {string} nodeName 节点名
     * @param {string} compType 组件类型，如 'Label' / 'Sprite' / 'Button'
     */
    deleteComponent(nodeName, compType) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 预制体');
        const shortType = compType.replace('cc.', '');
        const compKey = nodeName + '|' + shortType;
        const compIdx = this._compMap[compKey];
        if (compIdx === undefined) throw new Error(`组件不存在: ${compKey}`);

        const node = this._loadedArr[this._nodeMap[nodeName]];
        if (!node) throw new Error(`节点不存在: ${nodeName}`);

        // 收集组件及其 CompPrefabInfo
        const compObj = this._loadedArr[compIdx];
        const indices = [compIdx];
        if (compObj && compObj.__prefab && compObj.__prefab.__id__ !== undefined && compObj.__prefab.__id__ !== null) {
            indices.push(compObj.__prefab.__id__);
        }
        indices.sort((a, b) => a - b);

        const { canSafeDelete, safeSplice } = require('./utils');
        const check = canSafeDelete(this._loadedArr, indices);
        if (!check.safe) {
            throw new Error(`❌ 无法安全删除组件 "${compType}" from "${nodeName}": ${check.reason}`);
        }

        // 从节点 _components 移除
        node._components = node._components.filter(c => c && c.__id__ !== compIdx);
        delete this._compMap[compKey];

        const result = safeSplice(this._loadedArr, indices);
        if (result.success) {
            console.log(`🔧 已删除组件 ${compType} from "${nodeName}"`);
        }
        return this;
    }

    /** 保存已加载预制体的修改（直接写回 _loadedArr，不走 build 流程） */
    saveLoaded(outputPath, opts = {}) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('必须先 load() 预制体');
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
        const out = outputPath || this.outputPath;
        fs.writeFileSync(out, JSON.stringify(this._loadedArr, null, 2));
        console.log(`   写入: ${out}`);
        return this;
    }

    _finalize() {
        if (this._isLoaded && this._loadedArr) {
            this._finalizeLoadedPrefab();
        } else {
            this._finalizeNewPrefab();
        }
        this._applyNodeFields();
        this._backfillPrefabRefs();
        this._resolvePendingScriptProps();
        const mode = this._isLoaded ? '追加' : '新建';
        console.log(`✅ Prefab ${mode}成功! 名称: ${this.name}  总对象: ${this.sceneArr.length}  脚本UUID: ${this.scriptUuid}`);
    }

    _finalizeLoadedPrefab() {
        const offset = this._loadedArr.length;
        const newArr = this.sceneArr;
        newArr.forEach(obj => shiftIDs(obj, offset));
        for (const obj of newArr) {
            if (obj.__type__ === 'cc.PrefabInfo') obj.asset = Id(0);
        }
        shiftMapNewOnly(this._nodeMap, offset, this._existingNodeNames);
        shiftMapNewOnly(this._compMap, offset, this._existingCompKeys);
        shiftMapNewOnly(this._pfiMap, offset);
        shiftMapNewOnly(this._cpfiMap, offset);
        this.sceneArr = this._loadedArr.concat(newArr);
    }

    _finalizeNewPrefab() {
        const shell = { __type__: 'cc.Prefab', _name: this.name, _objFlags: 0, _native: '', data: null, persistent: false };
        this.sceneArr.unshift(shell);
        this.sceneArr.forEach(obj => shiftIDs(obj, 1));
        for (const m of [this._nodeMap, this._compMap, this._pfiMap, this._cpfiMap])
            for (const k of Object.keys(m)) m[k] += 1;
        for (const obj of this.sceneArr) {
            if (obj.__type__ === 'cc.PrefabInfo') obj.asset = Id(0);
        }
        shell.data = Id(this._nodeMap[Object.keys(this._nodeMap)[0]]);
    }

    _backfillPrefabRefs() {
        for (const [name, nIdx] of Object.entries(this._nodeMap)) {
            if (this._existingNodeNames && this._existingNodeNames.has(name)) continue;
            this.sceneArr[nIdx]._prefab = Id(this._pfiMap[name]);
        }
    }

    static fromJSON(config) {
        config = typeof config === 'string' ? JSON.parse(fs.readFileSync(config, 'utf-8')) : config;
        const b = new PrefabBuilder(config);
        if (config.loadPath) b.load(config.loadPath);
        NodeBuilderBase.populateFromConfig(b, config);
        return b;
    }
}

module.exports = PrefabBuilder;
