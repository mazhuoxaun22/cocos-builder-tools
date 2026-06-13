// ============================================================
// SceneBuilder — Scene node generation (extends base class)
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
        if (!fs.existsSync(p)) throw new Error(`Scene file not found: ${p}`);
        this._loadedArr = JSON.parse(fs.readFileSync(p, 'utf-8'));
        if (!Array.isArray(this._loadedArr)) throw new Error(`Invalid format: ${p} is not a valid scene file`);
        // Clear mutable state for multi-round load→append→write
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
        console.log(`📂 Loaded scene: ${p}  (${this._loadedArr.length} objects)`);
        console.log(`   Existing nodes: ${Object.keys(this._nodeMap).join(', ')}`);
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
        const mode = this._isLoaded ? 'appended' : 'created';
        console.log(`✅ Scene ${mode} successfully! Name: ${this.name}  Total objects: ${this.sceneArr.length}  Script UUID: ${this.scriptUuid}`);
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

        // Cocos requires: SceneAsset at index 0, cc.Scene at index 1
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
            // cc.Scene is always at index 1 (SceneAsset at index 0)
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
    // Methods for editing existing Scene (moveNode/moveComponent inherited from base)
    // addChildNode / deleteNode / deleteComponent below (no PrefabInfo)
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
     * Create a blank child node (UITransform only, no PrefabInfo)
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
        // Register UITransform in _compMap
        this._compMap[childName + '|UITransform'] = uitIdx;
        this._existingCompKeys.add(childName + '|UITransform');

        console.log(`🔧 [Scene] Created child node "${childName}" (idx: ${childIdx}) under "${parentName}", size: ${size[0]}x${size[1]}`);
        return childIdx;
    }

    /** 
     * Create child node and move a component into it
     * @param {string} parentName parent node name
     * @param {string} childName new child node name
     * @param {string} compType component type to move
     * @param {object} [opts] { size: [w,h], position: [x,y,z] }
     */
    moveComponentToChild(parentName, childName, compType, opts = {}) {
        this.addChildNode(parentName, childName, opts);
        this.moveComponent(parentName, compType, childName);
        return this;
    }

    /**
     * Safely delete a node and all its children and components
     * Only physically splices when at array end; otherwise errors with soft-delete suggestion
     * @param {string} nodeName node name to delete
     */
    deleteNode(nodeName) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('Must call load() first');
        const nodeIdx = this._nodeMap[nodeName];
        if (nodeIdx === undefined) throw new Error(`Node not found: ${nodeName}`);

        const { collectNodeIndices, canSafeDelete, safeSplice } = require('./utils');
        const allIndices = collectNodeIndices(this._loadedArr, nodeIdx);

        // Safety check (Scene doesn't need PrefabInfo ref check since scene nodes have none)
        const check = canSafeDelete(this._loadedArr, allIndices, { skipDangleCheck: true });
        if (!check.safe) {
            const msg = check.reason.includes('indices not at array end')
                ? `❌ Cannot safely delete "${nodeName}": node not at array end, splice would corrupt subsequent indices.\n` +
                  `   Suggested alternatives:\n` +
                  `   1. Soft delete: this._loadedArr[${nodeIdx}]._active = false\n` +
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
            console.log(`🔧 [Scene] Deleted node "${nodeName}" and its ${allIndices.length - 1} associated object(s)`);
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

        const { canSafeDelete, safeSplice } = require('./utils');
        const check = canSafeDelete(this._loadedArr, [compIdx]);
        if (!check.safe) {
            throw new Error(`❌ Cannot safely delete component "${compType}" from "${nodeName}": ${check.reason}`);
        }

        node._components = node._components.filter(c => c && c.__id__ !== compIdx);
        delete this._compMap[compKey];

        const result = safeSplice(this._loadedArr, [compIdx]);
        if (result.success) {
            console.log(`🔧 [Scene] Deleted component ${compType} from "${nodeName}"`);
        }
        return this;
    }

    /** Save modifications to loaded scene (write _loadedArr directly, bypass build flow) */
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
        const out = outputPath || this.scenePath;
        fs.writeFileSync(out, JSON.stringify(this._loadedArr, null, 2));
        console.log(`   Written: ${out}`);
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
