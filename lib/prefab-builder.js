// ============================================================
// PrefabBuilder — Prefab 生成/追加
// ============================================================
const fs = require('fs');
const NodeBuilderBase = require('./base-builder');
const { Id } = require('./types');
const { shiftIDs, shiftMapNewOnly } = require('./utils');
const { prefabInfoTemplate, compPrefabInfoTemplate } = require('./templates');

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
