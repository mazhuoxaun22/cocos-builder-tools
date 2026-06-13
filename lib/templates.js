// ---- Component / Node templates ----
const { Vec3, Vec2, Vec4, Quat, Size, Color, Id } = require('./types');
const { genObjId } = require('./uuid');
const { WHITE_SPRITE, UI_LAYER } = require('./constants');

// ---- Helper functions ----
function _prefabRef(isScene, idx) { return isScene ? null : Id(idx); }

// ---- Component templates ----
function uitransformTemplate(nIdx, cpIdx, w, h, isScene) {
    return {
        __type__: 'cc.UITransform', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx),
        _contentSize: Size(w, h), _anchorPoint: Vec2(0.5, 0.5),
        _id: genObjId(),
    };
}

function spriteTemplate(nIdx, cpIdx, color, sfUuid, isScene) {
    return {
        __type__: 'cc.Sprite', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx), _customMaterial: null,
        _srcBlendFactor: 2, _dstBlendFactor: 4, _color: color,
        _spriteFrame: { __uuid__: sfUuid || WHITE_SPRITE, __expectedType__: 'cc.SpriteFrame' },
        _type: 0, _fillType: 0, _sizeMode: 0, _fillCenter: Vec2(0, 0),
        _fillStart: 0, _fillRange: 0, _isTrimmedMode: true,
        _useGrayscale: false, _atlas: null,
        _id: genObjId(),
    };
}

function labelTemplate(nIdx, cpIdx, cfg, isScene) {
    return {
        __type__: 'cc.Label', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx), _customMaterial: null,
        _srcBlendFactor: 2, _dstBlendFactor: 4,
        _color: Color(cfg.color[0], cfg.color[1], cfg.color[2], cfg.color[3]),
        _string: cfg.text || '', _fontSize: cfg.fontSize, _lineHeight: cfg.lineHeight,
        _enableWrapText: cfg.wrap !== undefined ? cfg.wrap : true,
        '_N$horizontalAlign': cfg.hAlign !== undefined ? cfg.hAlign : 1,
        '_N$verticalAlign': cfg.vAlign !== undefined ? cfg.vAlign : 1,
        '_N$fontFamily': cfg.fontFamily || 'Arial', '_N$overflow': cfg.overflow || 0,
        '_N$cacheMode': 0, '_N$isSystemFontUsed': true, '_N$spacingX': 0,
        _isItalic: false, _isBold: !!cfg.bold, _isUnderline: false,
        _underlineColor: Color(0, 0, 0, 255),
        _id: genObjId(),
    };
}

function buttonTemplate(nIdx, cpIdx, targetIdx, colors, isScene) {
    const c = (arr) => Color(arr[0], arr[1], arr[2], arr[3]);
    return {
        __type__: 'cc.Button', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx), clickEvents: [], _interactable: true,
        _transition: 0,
        _normalColor: c(colors && colors.normal || [100, 180, 255, 255]),
        _hoverColor: c(colors && colors.hover || [130, 200, 255, 255]),
        _pressedColor: c(colors && colors.pressed || [60, 140, 220, 255]),
        _disabledColor: c(colors && colors.disabled || [80, 80, 80, 255]),
        _normalSprite: null, _hoverSprite: null, _pressedSprite: null, _disabledSprite: null,
        _duration: 0.1, _zoomScale: 1.2, _target: Id(targetIdx),
        _id: genObjId(),
    };
}

function layoutTemplate(nIdx, cpIdx, cfg, isScene) {
    return {
        __type__: 'cc.Layout', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx),
        _resizeMode: cfg.resizeMode !== undefined ? cfg.resizeMode : 1,
        _layoutType: cfg.layoutType || 0,
        _cellSize: cfg.cellSize ? Size(cfg.cellSize[0], cfg.cellSize[1]) : Size(40, 40),
        _startAxis: cfg.startAxis || 0,
        _paddingLeft: (cfg.padding || [])[0] || 0, _paddingRight: (cfg.padding || [])[1] || 0,
        _paddingTop: (cfg.padding || [])[2] || 0, _paddingBottom: (cfg.padding || [])[3] || 0,
        _spacingX: cfg.spacingX || 0, _spacingY: cfg.spacingY || 0,
        _constraint: cfg.constraint || 0, _constraintNum: cfg.constraintNum || 2,
        _affectedByScale: false,
        _id: genObjId(),
    };
}

function widgetTemplate(nIdx, cpIdx, cfg, isScene) {
    return {
        __type__: 'cc.Widget', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx),
        _alignFlags: cfg.alignFlags || 0, _alignMode: cfg.alignMode || 0,
        _target: Id(cfg.target),
        _left: cfg.left || 0, _right: cfg.right || 0,
        _bottom: cfg.bottom || 0, _top: cfg.top || 0,
        _horizontalCenter: cfg.hCenter || 0, _verticalCenter: cfg.vCenter || 0,
        _isAbsLeft: cfg.absLeft || false, _isAbsRight: cfg.absRight || false,
        _isAbsTop: cfg.absTop || false, _isAbsBottom: cfg.absBottom || false,
        _isAbsHorizontalCenter: cfg.absHCenter || false,
        _isAbsVerticalCenter: cfg.absVCenter || false, _isAlignOnce: cfg.alignOnce || false,
        _id: genObjId(),
    };
}

function canvasTemplate(nIdx, cpIdx, camCompIdx, designW, designH, isScene) {
    const c = {
        __type__: 'cc.Canvas', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx),
        _cameraComponent: Id(camCompIdx),
        _id: genObjId(),
    };
    if (designW && designH) {
        c._designResolution = Size(designW, designH);
        c._fitWidth = false;
        c._fitHeight = true;
    } else {
        c._alignCanvasWithScreen = true;
    }
    return c;
}

function cameraTemplate(nIdx, cpIdx, isScene) {
    return {
        __type__: 'cc.Camera', _name: '', _objFlags: 0, node: Id(nIdx),
        _enabled: true, __prefab: _prefabRef(isScene, cpIdx),
        _projection: 0, _priority: 0, _fov: 45, _fovAxis: 0,
        _orthoHeight: 960, _near: 0, _far: 1000,
        _color: Color(0, 0, 0, 255),
        _depth: 1, _stencil: 0, _clearFlags: 7,
        _rect: { __type__: 'cc.Rect', x: 0, y: 0, width: 1, height: 1 },
        _aperture: 19, _shutter: 7, _iso: 0, _screenScale: 1,
        _visibility: 1108344832, _targetTexture: null,
        _id: genObjId(),
    };
}

function scriptTemplate(nIdx, cpIdx, uuid, props, isScene) {
    return { __type__: uuid, _name: '', _objFlags: 0, node: Id(nIdx), _enabled: true, __prefab: _prefabRef(isScene, cpIdx), _id: genObjId(), ...props };
}

// ---- SceneGlobals template (required for new scenes) ----
function sceneGlobalsTemplate() {
    return [
        {
            __type__: 'cc.SceneGlobals',
            ambient: { __id_marker__: 1 },
            shadows: { __id_marker__: 2 },
            _skybox: { __id_marker__: 3 },
            fog: { __id_marker__: 4 },
            octree: { __id_marker__: 5 },
            skin: { __id_marker__: 6 },
        },
        {
            __type__: 'cc.AmbientInfo',
            _skyColorHDR: Vec4(0, 0, 0, 0.520833125), _skyColor: Vec4(0, 0, 0, 0.520833125),
            _skyIllumHDR: 20000, _skyIllum: 20000,
            _groundAlbedoHDR: Vec4(0, 0, 0, 0), _groundAlbedo: Vec4(0, 0, 0, 0),
            _skyColorLDR: Vec4(0.2, 0.5, 0.8, 1), _skyIllumLDR: 20000,
            _groundAlbedoLDR: Vec4(0.2, 0.2, 0.2, 1),
        },
        {
            __type__: 'cc.ShadowsInfo',
            _enabled: false, _type: 0,
            _normal: Vec3(0, 1, 0), _distance: 0,
            _shadowColor: Color(76, 76, 76, 255), _maxReceived: 4,
            _size: Vec2(512, 512),
        },
        {
            __type__: 'cc.SkyboxInfo',
            _envLightingType: 0, _envmapHDR: null, _envmap: null, _envmapLDR: null,
            _diffuseMapHDR: null, _diffuseMapLDR: null,
            _enabled: false, _useHDR: true,
        },
        {
            __type__: 'cc.FogInfo',
            _type: 0, _fogColor: Color(200, 200, 200, 255),
            _enabled: false, _fogDensity: 0.3, _fogStart: 0.5, _fogEnd: 300,
            _fogAtten: 5, _fogTop: 1.5, _fogRange: 1.2, _accurate: false,
        },
        {
            __type__: 'cc.OctreeInfo',
            _enabled: false,
            _minPos: Vec3(-1024, -1024, -1024), _maxPos: Vec3(1024, 1024, 1024),
            _depth: 8,
        },
        {
            __type__: 'cc.SkinInfo',
            _enabled: false, _scale: 5,
        },
    ];
}

// ---- Prefab-specific metadata template ----
function prefabInfoTemplate(fileId) {
    return { __type__: 'cc.PrefabInfo', root: Id(1), asset: Id(0), fileId, instance: null, targetOverrides: [], nestedPrefabInstanceRoots: [] };
}

function compPrefabInfoTemplate(fileId) {
    return { __type__: 'cc.CompPrefabInfo', fileId };
}

module.exports = {
    uitransformTemplate, spriteTemplate, labelTemplate,
    buttonTemplate, layoutTemplate, widgetTemplate, canvasTemplate,
    cameraTemplate, scriptTemplate,
    sceneGlobalsTemplate, prefabInfoTemplate, compPrefabInfoTemplate,
};
