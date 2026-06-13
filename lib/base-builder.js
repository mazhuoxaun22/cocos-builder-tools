// ============================================================
// NodeBuilderBase — Shared base class for Prefab/Scene builders
// ============================================================
const { Vec3, Quat, Id, Color } = require('./types');
const { WHITE_SPRITE, UI_LAYER } = require('./constants');
const { compressUuid, genObjId } = require('./uuid');
const {
    uitransformTemplate, spriteTemplate, labelTemplate,
    buttonTemplate, layoutTemplate, widgetTemplate, canvasTemplate,
    cameraTemplate, scriptTemplate,
} = require('./templates');

class NodeBuilderBase {
    constructor(config) {
        this.name = config.name || 'Root';
        const suuid = config.scriptUuid || '';
        this.scriptUuid = suuid.includes('-') ? compressUuid(suuid) : suuid;
        this.defaultSpriteFrame = config.spriteFrame || WHITE_SPRITE;
        this.sceneArr = [];
        this._nodeMap = {};
        this._compMap = {};
        this._steps = [];
        this._pendingResolutions = [];
        this._newCompKeys = new Set();
        this._finalized = false;
        this._isLoaded = false;
        this._loadedArr = null;
    }

    _resolveRef(refStr, compType) {
        if (!refStr) return null;
        if (typeof refStr === 'number') return refStr;
        if (typeof refStr === 'string' && refStr.startsWith('#')) return parseInt(refStr.slice(1), 10);
        if (compType) { const k = refStr + '|' + compType; if (this._compMap[k] !== undefined) return this._compMap[k]; }
        if (this._nodeMap[refStr] !== undefined) return this._nodeMap[refStr];
        throw new Error(`Reference not found: "${refStr}". Known: ${Object.keys(this._nodeMap).join(', ')}`);
    }

    _pushNodeMeta(name) { /* no-op */ }
    _pushCompMeta(nodeName, type) { return -1; }

    addNode(spec) {
        const name = spec.name;
        this._pushNodeMeta(name);
        const nodeIdx = this.sceneArr.length;
        this.sceneArr.push({ __type__: 'cc.Node', _name: name });
        this._nodeMap[name] = nodeIdx;
        this._steps.push({ type: 'node', name, parentName: spec.parent || null, pos: spec.position || [0, 0, 0], static: spec.static, scale: spec.scale, rot: spec.rotation });
        return this;
    }

    _addCompBase(type, spec, templateFn) {
        const nodeName = spec.node;
        const nodeIdx = this._nodeMap[nodeName];
        const cpfiIdx = this._pushCompMeta(nodeName, type);
        const compIdx = this.sceneArr.length;
        const compObj = typeof templateFn === 'function' ? templateFn(nodeIdx, cpfiIdx, spec) : templateFn;
        this.sceneArr.push(compObj);
        const key = nodeName + '|' + type;
        this._compMap[key] = compIdx;
        this._newCompKeys.add(key);
        return this;
    }

    addUITransform(spec) {
        return this._addCompBase('UITransform', spec,
            (nIdx, cpIdx, s) => uitransformTemplate(nIdx, cpIdx, (s.size || [100, 100])[0], (s.size || [100, 100])[1], this.isScene));
    }
    addSprite(spec) {
        const color = spec.color ? Color(spec.color[0], spec.color[1], spec.color[2], spec.color[3]) : Color(255, 255, 255, 255);
        return this._addCompBase('Sprite', spec,
            (nIdx, cpIdx) => spriteTemplate(nIdx, cpIdx, color, spec.spriteFrame || this.defaultSpriteFrame, this.isScene));
    }
    addLabel(spec) {
        return this._addCompBase('Label', spec, (nIdx, cpIdx) => labelTemplate(nIdx, cpIdx, {
            text: spec.text || '', fontSize: spec.fontSize || 24, lineHeight: spec.lineHeight || 30,
            color: spec.color || [255, 255, 255, 255], bold: spec.bold || false,
            wrap: spec.wrap, hAlign: spec.hAlign, vAlign: spec.vAlign,
            fontFamily: spec.fontFamily, overflow: spec.overflow,
        }, this.isScene));
    }
    addButton(spec) {
        // Id() already handles null/undefined, just pass _resolveRef result
        const targetIdx = this._resolveRef(spec.target || spec.targetNode);
        return this._addCompBase('Button', spec,
            (nIdx, cpIdx) => buttonTemplate(nIdx, cpIdx, targetIdx, spec.colors, this.isScene));
    }
    addLayout(spec) {
        return this._addCompBase('Layout', spec, (nIdx, cpIdx) => layoutTemplate(nIdx, cpIdx, spec, this.isScene));
    }
    addWidget(spec) {
        // Id() already handles null/undefined; when targetRef unspecified, target is null
        // (consistent with Cocos native Canvas)
        const resolved = { ...spec, target: this._resolveRef(spec.targetRef) };
        return this._addCompBase('Widget', spec, (nIdx, cpIdx) => widgetTemplate(nIdx, cpIdx, resolved, this.isScene));
    }
    addCanvas(spec) {
        const camCompIdx = this._resolveRef(spec.camera || 'Camera', 'Camera');
        return this._addCompBase('Canvas', spec,
            (nIdx, cpIdx) => canvasTemplate(nIdx, cpIdx, camCompIdx, spec.designWidth, spec.designHeight, this.isScene));
    }
    addCamera(spec) {
        return this._addCompBase('Camera', spec,
            (nIdx, cpIdx) => cameraTemplate(nIdx, cpIdx, this.isScene));
    }
    addScript(spec) {
        const uuid = spec.uuid || spec.scriptUuid || this.scriptUuid;
        const nodeName = spec.node;
        const nodeIdx = this._nodeMap[nodeName];
        const cpfiIdx = this._pushCompMeta(nodeName, 'Script');
        const compIdx = this.sceneArr.length;
        const scriptObj = scriptTemplate(nodeIdx, cpfiIdx, uuid, {}, this.isScene);
        this.sceneArr.push(scriptObj);
        this._compMap[nodeName + '|Script'] = compIdx;
        this._newCompKeys.add(nodeName + '|Script');
        if (spec.props) {
            for (const [k, v] of Object.entries(spec.props)) {
                if (v && typeof v === 'object' && v.node) {
                    this._pendingResolutions.push({ obj: scriptObj, key: k, nodeName: v.node, compType: v.component });
                }
            }
        }
        return this;
    }

    // ================================================================
    // Shared methods for editing existing files (moveNode, moveComponent, helpers)
    // ================================================================

    /** Subclass override: edit mode log suffix, e.g. ' [Scene]' */
    _editLogPrefix() { return ''; }

    /** Subclass override: component fuzzy fallback (Scene uses __type__ match) */
    _findComponentFallback(fromNodeName, shortType) { return undefined; }

    /** Inherit parent node UITransform size, used by addChildNode */
    _inheritParentSize(parentName) {
        const parentIdx = this._nodeMap[parentName];
        const parentNode = this._loadedArr[parentIdx];
        const parentComps = parentNode._components || [];
        for (const compRef of parentComps) {
            if (!compRef || compRef.__id__ === undefined) continue;
            const comp = this._loadedArr[compRef.__id__];
            if (comp && comp.__type__ === 'cc.UITransform' && comp._contentSize) {
                return [comp._contentSize.width, comp._contentSize.height];
            }
        }
        return [100, 100];
    }

    /** 
     * Move a node under another parent (update _parent + _children, don't move array position)
     */
    moveNode(nodeName, newParentName) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('Must call load() first');

        const nodeIdx = this._nodeMap[nodeName];
        if (nodeIdx === undefined) throw new Error(`Node not found: ${nodeName}`);
        const newNodeIdx = this._nodeMap[newParentName];
        if (newNodeIdx === undefined) throw new Error(`Target node not found: ${newParentName}`);

        const node = this._loadedArr[nodeIdx];
        const oldParentId = node._parent ? node._parent.__id__ : null;

        // prevent circular reference
        let p = newNodeIdx;
        while (p !== undefined && p !== null) {
            if (p === nodeIdx) throw new Error(`Cannot move "${nodeName}" under its own descendant`);
            const ancestor = this._loadedArr[p];
            p = ancestor && ancestor._parent ? ancestor._parent.__id__ : null;
        }

        if (oldParentId !== null && oldParentId !== undefined) {
            const oldParent = this._loadedArr[oldParentId];
            if (oldParent && oldParent._children) {
                oldParent._children = oldParent._children.filter(c => c && c.__id__ !== nodeIdx);
            }
        }

        node._parent = Id(newNodeIdx);

        const newParent = this._loadedArr[newNodeIdx];
        if (!newParent._children) newParent._children = [];
        newParent._children.push(Id(nodeIdx));

        console.log(`🔧${this._editLogPrefix()} Moved node "${nodeName}" under "${newParentName}"`);
        return this;
    }

    /** 
     * Move a component from source node to target node (update node ref + _components, don't move array position)
     */
    moveComponent(fromNodeName, compType, toNodeName) {
        if (!this._isLoaded || !this._loadedArr) throw new Error('Must call load() first');

        const shortType = compType.replace('cc.', '');
        const compKey = fromNodeName + '|' + shortType;
        let compIdx = this._compMap[compKey];

        if (compIdx === undefined) {
            compIdx = this._findComponentFallback(fromNodeName, shortType);
            if (compIdx === undefined) throw new Error(`Component not found: ${compKey}`);
        }

        const toIdx = this._nodeMap[toNodeName];
        if (toIdx === undefined) throw new Error(`Target node not found: ${toNodeName}`);

        const compObj = this._loadedArr[compIdx];

        const fromNode = this._loadedArr[this._nodeMap[fromNodeName]];
        fromNode._components = fromNode._components.filter(c => c && c.__id__ !== compIdx);

        compObj.node = Id(toIdx);

        const toNode = this._loadedArr[toIdx];
        if (!toNode._components) toNode._components = [];
        toNode._components.push(Id(compIdx));

        for (const [k, v] of Object.entries(this._compMap)) {
            if (v === compIdx && k.startsWith(fromNodeName + '|')) {
                delete this._compMap[k];
            }
        }
        this._compMap[toNodeName + '|' + shortType] = compIdx;

        console.log(`🔧${this._editLogPrefix()} Moved ${compType} from "${fromNodeName}" to "${toNodeName}"`);
        return this;
    }

    _applyNodeFields() {
        const childMap = {};
        for (const s of this._steps) {
            if (s.type === 'node' && s.parentName) {
                if (!childMap[s.parentName]) childMap[s.parentName] = [];
                childMap[s.parentName].push(s.name);
            }
        }
        const compByNode = {};
        for (let i = 0; i < this.sceneArr.length; i++) {
            const obj = this.sceneArr[i];
            if (!obj || !obj.node || obj.node.__id__ === undefined) continue;
            const ownerIdx = obj.node.__id__;
            const owner = this.sceneArr[ownerIdx];
            if (owner && owner._name) {
                if (!compByNode[owner._name]) compByNode[owner._name] = [];
                compByNode[owner._name].push(i);
            }
        }
        const newCompByNode = {};
        if (this._isLoaded && this._loadedArr) {
            const startIdx = this._loadedArr.length;
            for (let i = startIdx; i < this.sceneArr.length; i++) {
                const obj = this.sceneArr[i];
                if (!obj || !obj.node || obj.node.__id__ === undefined) continue;
                const ownerIdx = obj.node.__id__;
                const owner = this.sceneArr[ownerIdx];
                if (owner && owner._name) {
                    if (!newCompByNode[owner._name]) newCompByNode[owner._name] = [];
                    newCompByNode[owner._name].push(i);
                }
            }
        }

        const buildNodeObj = (name, parentId, childrenIds, compIds, pos, scale, isScene, isStatic) => {
            const hasCamera = compIds.some(idx => {
                const c = this.sceneArr[idx];
                return c && c.__type__ === 'cc.Camera';
            });
            const n = {
                __type__: 'cc.Node', _name: name, _objFlags: 0,
                _parent: Id(parentId),
                _children: childrenIds.map(Id), _active: true,
                _components: compIds.map(Id),
                _prefab: null,
                _lpos: pos, _lrot: Quat(), _lscale: scale,
                _layer: hasCamera ? 1073741824 : UI_LAYER, _euler: Vec3(0, 0, 0),
                _id: genObjId(),
            };
            if (isStatic) n._mobility = 0;
            return n;
        };

        for (const [name, nIdx] of Object.entries(this._nodeMap)) {
            const obj = this.sceneArr[nIdx];
            if (!obj) continue;
            const step = this._steps.find(s => s.type === 'node' && s.name === name);
            if (step) {
                const pos = Vec3(step.pos[0] || 0, step.pos[1] || 0, step.pos[2] || 0);
                const scale = step.scale ? Vec3(step.scale[0] || 1, step.scale[1] || 1, step.scale[2] || 1) : Vec3(1, 1, 1);
                const parentId = step.parentName && this._nodeMap[step.parentName] !== undefined ? this._nodeMap[step.parentName] : null;
                const childrenIds = (childMap[name] || []).map(c => this._nodeMap[c]);
                const compIds = (compByNode[name] || []);
                this.sceneArr[nIdx] = buildNodeObj(name, parentId, childrenIds, compIds, pos, scale, this.isScene, step.static);
            } else {
                if (childMap[name]) {
                    const existing = obj._children || [];
                    const newKids = childMap[name].map(c => Id(this._nodeMap[c]));
                    obj._children = existing.concat(newKids);
                }
                if (newCompByNode[name]) {
                    const existing = obj._components || [];
                    const newComps = newCompByNode[name].filter(idx => existing.every(e => e.__id__ !== idx)).map(Id);
                    obj._components = existing.concat(newComps);
                }
            }
        }
    }

    _resolvePendingScriptProps() {
        for (const p of this._pendingResolutions) {
            p.obj[p.key] = Id(this._resolveRef(p.nodeName, p.compType));
        }
        this._pendingResolutions = [];
    }

    _finalize() {
        throw new Error('_finalize() must be overridden by subclass');
    }

    static fromJSON(config) {
        throw new Error('fromJSON() must be overridden by subclass');
    }

    static populateFromConfig(builder, config) {
        const typeMap = {
            'UITransform': 'addUITransform', 'Sprite': 'addSprite', 'Label': 'addLabel',
            'Button': 'addButton', 'Layout': 'addLayout', 'Widget': 'addWidget',
            'Canvas': 'addCanvas', 'Camera': 'addCamera', 'Script': 'addScript',
        };
        for (const n of config.nodes || []) builder.addNode(n);
        for (const c of config.components || []) {
            const m = typeMap[c.type];
            if (m && builder[m]) builder[m](c);
            else console.warn('Unknown component type: ' + c.type);
        }
    }

    _validate() {
        const errors = [];
        const arr = this.sceneArr;

        // 1. Collect all referenced indices
        const referencedIds = new Set();
        function collectRefs(obj, parentIdx) {
            if (!obj || typeof obj !== 'object') return;
            for (const [k, v] of Object.entries(obj)) {
                if (k === '__id__' && typeof v === 'number') {
                    if (v < 0 || v >= arr.length) {
                        errors.push(`BAD REF: idx ${parentIdx || '?'}.${k}=${v} (range 0~${arr.length - 1})`);
                    } else {
                        referencedIds.add(v);
                    }
                } else if (Array.isArray(v)) {
                    v.forEach((it, i) => collectRefs(it, parentIdx !== undefined ? `${parentIdx}[${i}]` : `[${i}]`));
                } else if (typeof v === 'object' && v !== null) {
                    collectRefs(v, parentIdx);
                }
            }
        }
        for (let i = 0; i < arr.length; i++) collectRefs(arr[i], i);

        // 2. Detect unreferenced "orphan" objects (skip root, _id, globals)
        const skipTypes = new Set(['cc.SceneAsset', 'cc.Scene', 'cc.SceneGlobals', 'cc.Prefab']);
        for (let i = 0; i < arr.length; i++) {
            const obj = arr[i];
            if (!obj) continue;
            // root objects (index 0/1) always kept, _globals blocks also kept
            if (i <= 1 && (skipTypes.has(obj.__type__) || obj.__type__ === 'cc.Node')) continue;
            if (obj.__type__ === 'cc.SceneGlobals') continue;
            // cc.Scene._id being referenced is not counted (Cocos internal use)
            if (!referencedIds.has(i) && i > 1 && obj.__type__) {
                errors.push(`ORPHAN: idx[${i}] "${obj._name || obj.__type__}" not referenced by any object, possibly dangling dead data`);
            }
        }

        // 3. Check each Node's UITransform
        for (let i = 0; i < arr.length; i++) {
            if (!arr[i] || arr[i].__type__ !== 'cc.Node') continue;
            const comps = arr[i]._components || [];
            const compTypes = comps.map(c => arr[c.__id__] && arr[c.__id__].__type__).filter(Boolean);
            if (compTypes.includes('cc.Camera') && !compTypes.includes('cc.Canvas')) continue;
            if (!compTypes.includes('cc.UITransform'))
                errors.push(`MISSING UITransform: Node[${i}] "${arr[i]._name}"`);
            // check renderable conflicts
            const renderables = compTypes.filter(t => ['cc.Sprite', 'cc.Label', 'cc.Graphics', 'cc.Mask'].includes(t));
            if (renderables.length > 1)
                errors.push(`RENDERABLE conflict: Node[${i}] "${arr[i]._name}" has both ${renderables.join(' + ')}`);
        }
        return errors;
    }

    build() {
        if (this._finalized) return this.sceneArr;
        this._finalized = true;
        this._finalize();
        const errors = this._validate();
        if (errors.length > 0) { errors.forEach(e => console.error('  ❌ ' + e)); throw new Error('Validation failed'); }
        return this.sceneArr;
    }

    write(outputPath) {
        const fs = require('fs');
        const path = require('path');
        const out = outputPath || this.outputPath;
        if (!out) throw new Error('outputPath required');
        const arr = this.build();
        const dir = path.dirname(out);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(out, JSON.stringify(arr, null, 2));
        console.log('   Written: ' + out);
    }
}

module.exports = NodeBuilderBase;
