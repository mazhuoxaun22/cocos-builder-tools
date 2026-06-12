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

    static fromJSON(config) {
        config = typeof config === 'string' ? JSON.parse(fs.readFileSync(config, 'utf-8')) : config;
        const b = new SceneBuilder(config);
        NodeBuilderBase.populateFromConfig(b, config);
        return b;
    }
}

module.exports = SceneBuilder;
