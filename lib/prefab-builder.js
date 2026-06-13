// ============================================================
// PrefabBuilder — Prefab create/append
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
        this.outputPath = config.outputPath || `assets/prefabs/${this.name}.prefab`;
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
        if (!fs.existsSync(p)) throw new Error(`Prefab not found: ${p}`);
        this._loadedArr = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (!Array.isArray(this._loadedArr)) throw new Error(`Invalid format: ${p}`);
        if (this._loadedArr.length < 1 || this._loadedArr[0].__type__ !== 'cc.Prefab')
            throw new Error(`Invalid format: ${p} missing cc.Prefab root object`);

        // Clear mutable state for multi-round load→append→write
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
        console.log(`📂 Loaded prefab: ${p}  (${this._loadedArr.length} objects)`);
        console.log(`   Existing nodes: ${Object.keys(this._nodeMap).join(', ')}`);
        return this;
    }

    // ================================================================
    // Methods for editing existing Prefab (moveNode/moveComponent inherited from base)
    // addChildNode / deleteNode / deleteComponent below (with PrefabInfo handling)
    // ================================================================

    /** 
     * Create a blank child node (UITransform only)
     * @param {string} parentName parent node name
     * @param {string} childName new node name
     * @param {object} [opts] { size: [w,h], position: [x,y,z] }
     * @returns {number} new node index in _loadedArr
     */
    addChildNode(parentName, childName, opts = {}) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('Must call load() first');

        const parentIdx = this._nodeMap[parentName];
        if (parentIdx === undefined) throw new Error(`Node not found: ${parentName}`);

        const size = opts.size || this._inheritParentSize(parentName);

        // Generate unique PrefabInfo / CompPrefabInfo fileId
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

        console.log(`🔧 Created child node "${childName}" (idx: ${childIdx}) under "${parentName}", size: ${size[0]}x${size[1]}`);
        return childIdx;
    }

    /** 
     * Convenience: create child node and move a component into it (most common for renderable conflicts)
     * Equivalent to addChildNode + moveComponent
     * @param {string} parentName parent node name
     * @param {string} childName new child node name
     * @param {string} compType component type to move, e.g. 'cc.Label' / 'cc.Sprite'
     * @param {object} [opts] { size: [w,h], position: [x,y,z] }
     */
    moveComponentToChild(parentName, childName, compType, opts = {}) {
        this.addChildNode(parentName, childName, opts);
        this.moveComponent(parentName, compType, childName);
        return this;
    }

    /**
     * Safely delete a node and all its children, components, PrefabInfo
     * Only physically splices when the node is at the array end (no index offset); otherwise errors with soft-delete suggestion
     * @param {string} nodeName node name to delete
     */
    deleteNode(nodeName) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('Must call load() first');
        const nodeIdx = this._nodeMap[nodeName];
        if (nodeIdx === undefined) throw new Error(`Node not found: ${nodeName}`);

        const { collectNodeIndices, canSafeDelete, safeSplice } = require('./utils');
        const allIndices = collectNodeIndices(this._loadedArr, nodeIdx);

        // Safety check
        const check = canSafeDelete(this._loadedArr, allIndices, { skipDangleCheck: true });
        if (!check.safe) {
            // Try marking active=false instead of splice
            const msg = check.reason.includes('indices not at array end')
                ? `❌ Cannot safely delete "${nodeName}": node not at array end, splice would corrupt subsequent indices.\n` +
                  `   Suggested alternatives:\n` +
                  `   1. Soft delete: this._loadedArr[${nodeIdx}]._active = false (hides node without deleting data)\n` +
                  `   2. Reorder: use moveNode to move the subtree to the end first, then call deleteNode`
                : `❌ Cannot safely delete "${nodeName}": ${check.reason}`;
            throw new Error(msg);
        }

        // Remove from parent _children
        const node = this._loadedArr[nodeIdx];
        const parentId = node._parent ? node._parent.__id__ : null;
        if (parentId !== null && parentId !== undefined) {
            const parent = this._loadedArr[parentId];
            if (parent && parent._children) {
                parent._children = parent._children.filter(c => c && c.__id__ !== nodeIdx);
            }
        }

        // Clean up maps
        function cleanMaps(arr, indices, nodeMap, compMap, pfiMap, cpfiMap) {
            for (const i of indices) {
                const obj = arr[i];
                if (!obj) continue;
                // clean _nodeMap
                if (obj.__type__ === 'cc.Node' && obj._name) delete nodeMap[obj._name];
                // clean _compMap
                if (obj.__type__ && obj.node && obj.node.__id__ !== undefined) {
                    const owner = arr[obj.node.__id__];
                    const shortType = obj.__type__.replace('cc.', '');
                    const key = (owner && owner._name || '?') + '|' + shortType;
                    for (const [k, v] of Object.entries(compMap)) {
                        if (v === i) delete compMap[k];
                    }
                }
                // clean PrefabInfo map
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
            console.log(`🔧 Deleted node "${nodeName}" and its ${allIndices.length - 1} associated object(s)`);
        }
        return this;
    }

    /**
     * Safely delete a single component from a node
     * @param {string} nodeName node name
     * @param {string} compType component type, e.g. 'Label' / 'Sprite' / 'Button'
     */
    deleteComponent(nodeName, compType) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('Must call load() first');
        const shortType = compType.replace('cc.', '');
        const compKey = nodeName + '|' + shortType;
        const compIdx = this._compMap[compKey];
        if (compIdx === undefined) throw new Error(`Component not found: ${compKey}`);

        const node = this._loadedArr[this._nodeMap[nodeName]];
        if (!node) throw new Error(`Node not found: ${nodeName}`);

        // Collect component and its CompPrefabInfo
        const compObj = this._loadedArr[compIdx];
        const indices = [compIdx];
        if (compObj && compObj.__prefab && compObj.__prefab.__id__ !== undefined && compObj.__prefab.__id__ !== null) {
            indices.push(compObj.__prefab.__id__);
        }
        indices.sort((a, b) => a - b);

        const { canSafeDelete, safeSplice } = require('./utils');
        const check = canSafeDelete(this._loadedArr, indices);
        if (!check.safe) {
            throw new Error(`❌ Cannot safely delete component "${compType}" from "${nodeName}": ${check.reason}`);
        }

        // Remove from node _components
        node._components = node._components.filter(c => c && c.__id__ !== compIdx);
        delete this._compMap[compKey];

        const result = safeSplice(this._loadedArr, indices);
        if (result.success) {
            console.log(`🔧 Deleted component ${compType} from "${nodeName}"`);
        }
        return this;
    }

    /** Save modifications to loaded prefab (write _loadedArr directly, bypass build flow) */
    saveLoaded(outputPath, opts = {}) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('Must call load() first');
        if (opts.validate) {
            const backup = this.sceneArr;
            this.sceneArr = this._loadedArr;
            const errors = this._validate();
            this.sceneArr = backup;
            if (errors.length > 0) {
                console.error('  ❌ Pre-save validation failed:');
                errors.forEach(e => console.error('    ' + e));
                throw new Error('Validation failed, write denied. Use {validate:false} to skip.');
            }
        }
        const out = outputPath || this.outputPath;
        fs.writeFileSync(out, JSON.stringify(this._loadedArr, null, 2));
        console.log(`   Written: ${out}`);
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
        const mode = this._isLoaded ? 'appended' : 'created';
        console.log(`✅ Prefab ${mode} successfully! Name: ${this.name}  Total objects: ${this.sceneArr.length}  Script UUID: ${this.scriptUuid}`);
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
