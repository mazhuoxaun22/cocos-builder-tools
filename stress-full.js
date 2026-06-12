// 全方位压力测试: 脚本组件 + 预制体嵌套引用
const fs = require('fs');
const path = require('path');
const { generateFileIdV4, genObjId, compressUuid } = require('./lib/uuid');
const SceneBuilder = require('./lib/scene-builder');
const PrefabBuilder = require('./lib/prefab-builder');
const { Id } = require('./lib/types');

const ROOT = path.resolve(__dirname, '..', 'assets', 'stress-test');
function ensure(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function writeMeta(filePath, uuid, importer) {
  fs.writeFileSync(filePath + '.meta', JSON.stringify({
    ver: '1.1.50', importer: importer || 'prefab', imported: false, uuid,
    files: [], subMetas: {}, userData: {},
  }, null, 2));
}

const _scriptRegistry = new Map();

function writeScriptFile(className, uuid) {
  const dir = path.join(ROOT, 'scripts');
  ensure(dir);
  const tsPath = path.join(dir, `${className}.ts`);
  if (fs.existsSync(tsPath)) return;
  fs.writeFileSync(tsPath, [
    `import { _decorator, Component } from 'cc';`,
    `const { ccclass } = _decorator;`,
    ``,
    `@ccclass('${className}')`,
    `export class ${className} extends Component {`,
    `  // Auto-generated stress-test script`,
    `}`,
    ``,
  ].join('\n'));
  fs.writeFileSync(tsPath + '.meta', JSON.stringify({
    ver: '1.1.50', importer: 'typescript', imported: false, uuid,
    files: [], subMetas: {}, userData: {},
  }, null, 2));
}

function ensureScriptFile(className) {
  if (_scriptRegistry.has(className)) return _scriptRegistry.get(className);
  const uuid = mockScriptUuid(className);
  writeScriptFile(className, uuid);
  _scriptRegistry.set(className, uuid);
  return uuid;
}

function mockScriptUuid(name) {
  const h = (s, len = 8) => {
    let a = 0, b = 0;
    for (let i = 0; i < s.length; i++) { a = ((a << 5) - a + s.charCodeAt(i)) | 0; b = ((b << 7) - b + s.charCodeAt(i) * (i + 1)) | 0; }
    const full = (Math.abs(a) * 0x100000000 + Math.abs(b)).toString(16).padStart(16, '0');
    return full.substring(0, len);
  };
  return `${h(name)}-${h(name+'a',4)}-4${h(name+'b',3)}-${'89ab'[name.length%4]}${h(name+'c',3)}-${h(name+'d',12)}`;
}

// 添加 PrefabInfo 引用外部预制体
function addNestedPrefabRef(arr, nodeName, targetUuid, prefix) {
  let nodeIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i]._name === nodeName) { nodeIdx = i; break; }
  }
  if (nodeIdx < 0) throw new Error('Node not found: ' + nodeName);
  const pfiIdx = arr.length;
  arr.push({
    __type__: 'cc.PrefabInfo', root: Id(nodeIdx),
    asset: { __uuid__: targetUuid, __expectedType__: 'cc.Prefab' },
    fileId: `${prefix}_${nodeName}_Nested`,
    instance: null, targetOverrides: [], nestedPrefabInstanceRoots: [],
  });
  arr[nodeIdx]._prefab = Id(pfiIdx);
  return pfiIdx;
}

// ===== Phase 1: 5 个带脚本的 Base Prefab =====
console.log('=== Phase 1: 脚本组件预制体 ===');

const BASE_UUIDS = {};

// 收集所有脚本 UUID
const SCRIPT_NAMES = ['ButtonController', 'HealthPanel', 'CountdownTimer', 'TimerDisplay', 'InventorySlot', 'DialogBox'];
SCRIPT_NAMES.forEach(n => ensureScriptFile(n));

[
  { name: 'ScriptButton', uuid: _scriptRegistry.get('ButtonController'),
    build: (b, u) => b
      .addNode({ name: 'BtnRoot' }).addNode({ name: 'BtnLabel', parent: 'BtnRoot' })
      .addUITransform({ node: 'BtnRoot', size: [200, 80] })
      .addSprite({ node: 'BtnRoot', color: [60, 140, 255, 255], size: [200, 80] })
      .addButton({ node: 'BtnRoot' })
      .addUITransform({ node: 'BtnLabel', size: [160, 40] })
      .addLabel({ node: 'BtnLabel', text: 'ClickMe', fontSize: 28, color: [255,255,255,255] })
      .addScript({ node: 'BtnRoot', props: { clickCount: 0, cooldown: 0.5, labelRef: { node: 'BtnLabel', component: 'Label' } } })
  },
  { name: 'HealthPanel', uuid: _scriptRegistry.get('HealthPanel'),
    build: (b, u) => b
      .addNode({ name: 'PanelRoot' })
      .addNode({ name: 'HealthBar', parent: 'PanelRoot', position: [0, 80, 0] })
      .addNode({ name: 'HealthFill', parent: 'HealthBar' })
      .addNode({ name: 'NameLabel', parent: 'PanelRoot', position: [0, 130, 0] })
      .addNode({ name: 'HpLabel', parent: 'PanelRoot', position: [0, 30, 0] })
      .addUITransform({ node: 'PanelRoot', size: [300, 200] })
      .addSprite({ node: 'PanelRoot', color: [40, 40, 40, 200], size: [300, 200] })
      .addUITransform({ node: 'HealthBar', size: [260, 30] })
      .addSprite({ node: 'HealthBar', color: [80, 80, 80, 255], size: [260, 30] })
      .addUITransform({ node: 'HealthFill', size: [260, 30] })
      .addSprite({ node: 'HealthFill', color: [0, 220, 0, 255], size: [260, 30] })
      .addUITransform({ node: 'NameLabel', size: [200, 36] })
      .addLabel({ node: 'NameLabel', text: 'Player', fontSize: 24, color: [255,255,255,255] })
      .addUITransform({ node: 'HpLabel', size: [200, 28] })
      .addLabel({ node: 'HpLabel', text: '100/100', fontSize: 20, color: [200,200,200,255] })
      .addScript({ node: 'PanelRoot', props: { maxHp: 100, currentHp: 80,
        fillBar: { node: 'HealthFill', component: 'Sprite' },
        hpText: { node: 'HpLabel', component: 'Label' },
        nameText: { node: 'NameLabel', component: 'Label' } } })
  },
  { name: 'CountdownTimer', uuid: _scriptRegistry.get('CountdownTimer'),
    build: (b, u) => b
      .addNode({ name: 'TimerRoot' }).addNode({ name: 'TimeLabel', parent: 'TimerRoot' })
      .addUITransform({ node: 'TimerRoot', size: [200, 100] })
      .addSprite({ node: 'TimerRoot', color: [30, 30, 30, 220], size: [200, 100] })
      .addUITransform({ node: 'TimeLabel', size: [180, 60] })
      .addLabel({ node: 'TimeLabel', text: '60', fontSize: 52, color: [255,200,0,255], bold: true })
      .addScript({ node: 'TimerRoot', props: { totalSeconds: 60, remaining: 60,
        labelRef: { node: 'TimeLabel', component: 'Label' }, warnThreshold: 10 } })
      .addScript({ node: 'TimerRoot', uuid: compressUuid(_scriptRegistry.get('TimerDisplay')),
        props: { pulseScale: 1.2, blinkOnWarn: true } })
  },
  { name: 'InventorySlot', uuid: _scriptRegistry.get('InventorySlot'),
    build: (b, u) => b
      .addNode({ name: 'SlotRoot' }).addNode({ name: 'ItemIcon', parent: 'SlotRoot' })
      .addNode({ name: 'CountBadge', parent: 'SlotRoot', position: [30, -30, 0] })
      .addNode({ name: 'CountText', parent: 'CountBadge' })
      .addUITransform({ node: 'SlotRoot', size: [80, 80] })
      .addSprite({ node: 'SlotRoot', color: [60, 60, 60, 255], size: [80, 80] })
      .addButton({ node: 'SlotRoot' })
      .addUITransform({ node: 'ItemIcon', size: [60, 60] })
      .addSprite({ node: 'ItemIcon', color: [255,255,255,255], size: [60, 60] })
      .addUITransform({ node: 'CountBadge', size: [30, 22] })
      .addSprite({ node: 'CountBadge', color: [200, 50, 50, 255], size: [30, 22] })
      .addUITransform({ node: 'CountText', size: [30, 20] })
      .addLabel({ node: 'CountText', text: '99', fontSize: 14, color: [255,255,255,255] })
      .addScript({ node: 'SlotRoot', props: { slotIndex: 0, itemId: '', count: 0,
        iconRef: { node: 'ItemIcon', component: 'Sprite' },
        badgeRef: { node: 'CountBadge', component: 'Sprite' },
        textRef: { node: 'CountText', component: 'Label' } } })
  },
  { name: 'DialogBox', uuid: _scriptRegistry.get('DialogBox'),
    build: (b, u) => b
      .addNode({ name: 'DialogRoot' }).addNode({ name: 'DialogMask', parent: 'DialogRoot' })
      .addNode({ name: 'DialogBg', parent: 'DialogRoot' })
      .addNode({ name: 'TitleText', parent: 'DialogBg', position: [0, 80, 0] })
      .addNode({ name: 'ContentText', parent: 'DialogBg' })
      .addNode({ name: 'OkBtn', parent: 'DialogBg', position: [-80, -100, 0] })
      .addNode({ name: 'CancelBtn', parent: 'DialogBg', position: [80, -100, 0] })
      .addNode({ name: 'OkLabel', parent: 'OkBtn' }).addNode({ name: 'CancelLabel', parent: 'CancelBtn' })
      .addUITransform({ node: 'DialogRoot', size: [1080, 1920] })
      .addSprite({ node: 'DialogMask', color: [0, 0, 0, 150], size: [1080, 1920] })
      .addUITransform({ node: 'DialogMask', size: [1080, 1920] })
      .addUITransform({ node: 'DialogBg', size: [600, 400] })
      .addSprite({ node: 'DialogBg', color: [50, 50, 70, 240], size: [600, 400] })
      .addUITransform({ node: 'TitleText', size: [400, 50] }).addUITransform({ node: 'ContentText', size: [500, 100] })
      .addLabel({ node: 'TitleText', text: '提示', fontSize: 36, color: [255,255,255,255], bold: true })
      .addLabel({ node: 'ContentText', text: '确定要执行此操作吗？', fontSize: 24, color: [200,200,200,255], wrap: true })
      .addUITransform({ node: 'OkBtn', size: [160, 60] }).addUITransform({ node: 'CancelBtn', size: [160, 60] })
      .addSprite({ node: 'OkBtn', color: [0, 180, 0, 255], size: [160, 60] })
      .addSprite({ node: 'CancelBtn', color: [180, 60, 60, 255], size: [160, 60] })
      .addButton({ node: 'OkBtn' }).addButton({ node: 'CancelBtn' })
      .addUITransform({ node: 'OkLabel', size: [120, 36] }).addUITransform({ node: 'CancelLabel', size: [120, 36] })
      .addLabel({ node: 'OkLabel', text: '确定', fontSize: 24, color: [255,255,255,255] })
      .addLabel({ node: 'CancelLabel', text: '取消', fontSize: 24, color: [255,255,255,255] })
      .addScript({ node: 'DialogRoot', props: { title: '提示', content: '消息',
        titleRef: { node: 'TitleText', component: 'Label' }, contentRef: { node: 'ContentText', component: 'Label' } } })
  },
].forEach(({ name, uuid, build }) => {
  const prefabUuid = generateFileIdV4();  // prefab 必须有独立 UUID，不能与脚本冲突
  BASE_UUIDS[name] = prefabUuid;
  const out = path.join(ROOT, 'prefabs', `${name}.prefab`);
  ensure(path.dirname(out));
  const b = new PrefabBuilder({ name, outputPath: out, scriptUuid: compressUuid(uuid) });
  build(b, uuid).write();
  writeMeta(out, prefabUuid, 'prefab');
  console.log(`  ✅ ${name}.prefab (脚本: ${uuid.substring(0, 8)}... prefab: ${prefabUuid.substring(0, 8)}...)`);
});

// ===== Phase 2: 预制体嵌套引用 =====
console.log('\n=== Phase 2: 预制体嵌套引用 ===');

// 2a. GameHUD — 嵌套 HealthPanel + CountdownTimer + ScriptButton
{
  const hudUuid = generateFileIdV4();
  const out = path.join(ROOT, 'prefabs', 'GameHUD.prefab');
  const b = new PrefabBuilder({ name: 'GameHUD', outputPath: out });
  b.addNode({ name: 'HUDRoot' })
    .addNode({ name: 'NestedHealth', parent: 'HUDRoot', position: [-350, 800, 0] })
    .addNode({ name: 'NestedTimer', parent: 'HUDRoot', position: [350, 850, 0] })
    .addNode({ name: 'NestedPauseBtn', parent: 'HUDRoot', position: [0, -800, 0] })
    .addUITransform({ node: 'HUDRoot', size: [1080, 1920] })
    .addUITransform({ node: 'NestedHealth', size: [300, 200] })
    .addUITransform({ node: 'NestedTimer', size: [200, 100] })
    .addUITransform({ node: 'NestedPauseBtn', size: [200, 80] });
  const arr = b.build();
  addNestedPrefabRef(arr, 'NestedHealth', BASE_UUIDS.HealthPanel, 'GameHUD');
  addNestedPrefabRef(arr, 'NestedTimer', BASE_UUIDS.CountdownTimer, 'GameHUD');
  addNestedPrefabRef(arr, 'NestedPauseBtn', BASE_UUIDS.ScriptButton, 'GameHUD');
  fs.writeFileSync(out, JSON.stringify(arr, null, 2));
  writeMeta(out, hudUuid, 'prefab');
  console.log('  ✅ GameHUD.prefab (3个嵌套引用)');
}

// 2b. InventoryBag — 嵌套 12 个 InventorySlot
{
  const out = path.join(ROOT, 'prefabs', 'InventoryBag.prefab');
  const b = new PrefabBuilder({ name: 'InventoryBag', outputPath: out });
  b.addNode({ name: 'BagRoot' }).addNode({ name: 'GridContainer', parent: 'BagRoot' })
    .addUITransform({ node: 'BagRoot', size: [600, 800] })
    .addSprite({ node: 'BagRoot', color: [40, 40, 50, 240], size: [600, 800] })
    .addUITransform({ node: 'GridContainer', size: [400, 300] });
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++)
      b.addNode({ name: `Slot_${r}_${c}`, parent: 'GridContainer',
        position: [(c - 1.5) * 90, (1 - r) * 90, 0] })
        .addUITransform({ node: `Slot_${r}_${c}`, size: [80, 80] });
  const arr = b.build();
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 4; c++)
      addNestedPrefabRef(arr, `Slot_${r}_${c}`, BASE_UUIDS.InventorySlot, 'InventoryBag');
  fs.writeFileSync(out, JSON.stringify(arr, null, 2));
  writeMeta(out, generateFileIdV4(), 'prefab');
  console.log('  ✅ InventoryBag.prefab (12个嵌套 InventorySlot)');
}

// 2c. 深层嵌套: DialogBox 里嵌套 ScriptButton
{
  const out = path.join(ROOT, 'prefabs', 'DialogNestedBtn.prefab');
  const b = new PrefabBuilder({ name: 'DialogNestedBtn', outputPath: out });
  b.addNode({ name: 'DlgRoot' }).addNode({ name: 'DlgBg', parent: 'DlgRoot' })
    .addNode({ name: 'InfoText', parent: 'DlgBg', position: [0, 50, 0] })
    .addNode({ name: 'NestedOkBtn', parent: 'DlgBg', position: [0, -100, 0] })
    .addUITransform({ node: 'DlgRoot', size: [1080, 1920] })
    .addUITransform({ node: 'DlgBg', size: [500, 400] })
    .addSprite({ node: 'DlgBg', color: [45, 45, 65, 240], size: [500, 400] })
    .addUITransform({ node: 'InfoText', size: [400, 80] })
    .addUITransform({ node: 'NestedOkBtn', size: [200, 80] })
    .addLabel({ node: 'InfoText', text: '重要通知!', fontSize: 30, color: [255,255,255,255] });
  const arr = b.build();
  addNestedPrefabRef(arr, 'NestedOkBtn', BASE_UUIDS.ScriptButton, 'DialogNestedBtn');
  fs.writeFileSync(out, JSON.stringify(arr, null, 2));
  writeMeta(out, generateFileIdV4(), 'prefab');
  console.log('  ✅ DialogNestedBtn.prefab (Dialog 嵌套 ScriptButton)');
}

// 2d. 三层嵌套: Container → GameHUD (嵌套 HealthPanel) → HealthPanel (嵌套 InventorySlot)
{
  const out = path.join(ROOT, 'prefabs', 'DeepNest3.prefab');
  const b = new PrefabBuilder({ name: 'DeepNest3', outputPath: out });
  b.addNode({ name: 'DeepRoot' }).addNode({ name: 'NestedHUD', parent: 'DeepRoot' })
    .addUITransform({ node: 'DeepRoot', size: [1080, 1920] })
    .addUITransform({ node: 'NestedHUD', size: [1080, 1920] });
  const arr = b.build();
  // GameHUD uuid
  const gameHudMeta = path.join(ROOT, 'prefabs', 'GameHUD.prefab.meta');
  const hudUuid = JSON.parse(fs.readFileSync(gameHudMeta, 'utf-8')).uuid;
  addNestedPrefabRef(arr, 'NestedHUD', hudUuid, 'DeepNest3');
  fs.writeFileSync(out, JSON.stringify(arr, null, 2));
  writeMeta(out, generateFileIdV4(), 'prefab');
  console.log('  ✅ DeepNest3.prefab (嵌套 GameHUD → 3个二级嵌套)');
}

// ===== Phase 3: 场景中的脚本 + 预制体引用 =====
console.log('\n=== Phase 3: 场景脚本与预制体引用 ===');

// 3a. 主场景 — GameController 脚本 + 3 个预制体实例
{
  const out = path.join(ROOT, 'scenes', 'ScriptStressScene.scene');
  ensure(path.dirname(out));
  const gameUuid = ensureScriptFile('GameController');
  const s = new SceneBuilder({ name: 'ScriptStressScene', outputPath: out, scriptUuid: compressUuid(gameUuid) });
  s.addNode({ name: 'Canvas' }).addNode({ name: 'Camera', parent: 'Canvas', position: [0, 0, 1000] })
    .addNode({ name: 'HUDInstance', parent: 'Canvas' })
    .addNode({ name: 'BagInstance', parent: 'Canvas', position: [0, -100, 0] })
    .addNode({ name: 'DialogInstance', parent: 'Canvas' })
    .addUITransform({ node: 'HUDInstance', size: [1080, 1920] })
    .addUITransform({ node: 'BagInstance', size: [600, 800] })
    .addUITransform({ node: 'DialogInstance', size: [1080, 1920] })
    .addUITransform({ node: 'Canvas', size: [1080, 1920] })
    .addCanvas({ node: 'Canvas', camera: 'Camera', designWidth: 1080, designHeight: 1920 })
    .addCamera({ node: 'Camera' }).addWidget({ node: 'Canvas' })
    .addScript({ node: 'Canvas', props: { score: 0, level: 1, isGameOver: false,
      hudRef: { node: 'HUDInstance' }, bagRef: { node: 'BagInstance' },
      dialogRef: { node: 'DialogInstance' } } });
  const arr = s.build();
  const sceneUuid = arr[1]._id;  // cc.Scene._id (index 1)
  const refMap = {
    HUDInstance: JSON.parse(fs.readFileSync(path.join(ROOT, 'prefabs', 'GameHUD.prefab.meta'), 'utf-8')).uuid,
    BagInstance: JSON.parse(fs.readFileSync(path.join(ROOT, 'prefabs', 'InventoryBag.prefab.meta'), 'utf-8')).uuid,
    DialogInstance: BASE_UUIDS.DialogBox,
  };
  for (const [name, uuid] of Object.entries(refMap))
    addNestedPrefabRef(arr, name, uuid, 'ScriptStressScene');
  fs.writeFileSync(out, JSON.stringify(arr, null, 2));
  writeMeta(out, sceneUuid, 'scene');
  console.log('  ✅ ScriptStressScene.scene (GameController + 3个预制体引用)');
}

// 3b. 100 节点场景 — 5 种脚本类型交替
{
  const out = path.join(ROOT, 'scenes', 'MassScriptScene.scene');
  ensure(path.dirname(out));
  const s = new SceneBuilder({ name: 'MassScriptScene', outputPath: out });
  s.addNode({ name: 'Canvas' }).addNode({ name: 'Camera', parent: 'Canvas', position: [0, 0, 1000] })
    .addUITransform({ node: 'Canvas', size: [1080, 1920] })
    .addCanvas({ node: 'Canvas', camera: 'Camera', designWidth: 1080, designHeight: 1920 })
    .addCamera({ node: 'Camera' }).addWidget({ node: 'Canvas' });
  const scripts = ['HealthMod', 'DamageDeal', 'BuffProvid', 'LootDroppr', 'AnimTriggr'];
  scripts.forEach(n => ensureScriptFile(n));
  for (let i = 0; i < 100; i++) {
    const name = `Item_${i}`;
    const x = (i % 10 - 4.5) * 100, y = 800 - Math.floor(i / 10) * 120;
    s.addNode({ name, parent: 'Canvas', position: [x, y, 0] });
    s.addUITransform({ node: name, size: [90, 100] });
    s.addSprite({ node: name, color: [40 + i % 200, 180 - i % 150, 100 + i % 130, 255], size: [90, 100] });
    s.addScript({ node: name, uuid: compressUuid(_scriptRegistry.get(scripts[i % 5])),
      props: { index: i, value: Math.random() * 100, active: i % 3 === 0, targetRef: { node: 'Canvas' } } });
  }
  const arr3b = s.build();
  const sceneUuid3b = arr3b[1]._id;
  fs.writeFileSync(out, JSON.stringify(arr3b, null, 2));
  writeMeta(out, sceneUuid3b, 'scene');
  console.log('  ✅ MassScriptScene.scene (100节点, 100脚本, 5种类型交替)');
}

// 3c. 追加场景 — 10轮动态加载新脚本
{
  const out = path.join(ROOT, 'scenes', 'AppendScriptScene.scene');
  ensure(path.dirname(out));
  const s = new SceneBuilder({ name: 'AppendScriptScene', outputPath: out });
  s.addNode({ name: 'Canvas' }).addNode({ name: 'Camera', parent: 'Canvas', position: [0, 0, 1000] })
    .addUITransform({ node: 'Canvas', size: [1080, 1920] })
    .addCanvas({ node: 'Canvas', camera: 'Camera', designWidth: 1080, designHeight: 1920 })
    .addCamera({ node: 'Camera' }).addWidget({ node: 'Canvas' });
  const arr3c = s.build();
  const sceneUuid3c = arr3c[1]._id;
  fs.writeFileSync(out, JSON.stringify(arr3c, null, 2));
  writeMeta(out, sceneUuid3c, 'scene');
  const dynTypes = ['MoveCtrl', 'RotateCtrl', 'ScaleCtrl', 'ColorCtrl', 'AlphaCtrl'];
  dynTypes.forEach(n => ensureScriptFile(n));
  for (let r = 0; r < 10; r++) {
    s._finalized = false;
    s.load()
      .addNode({ name: `Dynamic_${r}`, parent: 'Canvas' })
      .addUITransform({ node: `Dynamic_${r}`, size: [60, 60] })
      .addSprite({ node: `Dynamic_${r}`, color: [r * 25, 255 - r * 25, 128, 255], size: [60, 60] })
      .addScript({ node: `Dynamic_${r}`, uuid: compressUuid(_scriptRegistry.get(dynTypes[r % 5])),
        props: { round: r, speed: 1 + r * 0.5, enabled: r % 2 === 0 } })
      .write();
  }
  console.log('  ✅ AppendScriptScene.scene (10轮增量追加脚本)');
}

// ===== 验证 =====
console.log('\n--- 验证结果 ---\n');
let totalFiles = 0, totalNodes = 0, totalComps = 0, totalBadRefs = 0;
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) { walk(fp); return; }
    if (!f.endsWith('.prefab') && !f.endsWith('.scene')) return;
    totalFiles++;
    const arr = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    const nodes = arr.filter(o => o && o.__type__ === 'cc.Node');
    const comps = arr.filter(o => o && o.__type__ && o.__type__.startsWith('cc.') &&
      !['cc.Node', 'cc.Scene', 'cc.Prefab', 'cc.SceneAsset', 'cc.SceneGlobals',
        'cc.AmbientInfo', 'cc.ShadowsInfo', 'cc.SkyboxInfo', 'cc.FogInfo',
        'cc.OctreeInfo', 'cc.SkinInfo', 'cc.PrefabInfo', 'cc.CompPrefabInfo'].includes(o.__type__));
    const scripts = arr.filter(o => o && o.__type__ && !o.__type__.startsWith('cc.') && o.node);
    totalNodes += nodes.length;
    totalComps += comps.length + scripts.length;
    // 检查坏引用
    let bad = 0;
    function findBadRefs(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (obj.__id__ !== undefined && (obj.__id__ < 0 || obj.__id__ >= arr.length)) bad++;
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(it => findBadRefs(it));
        else if (typeof v === 'object') findBadRefs(v);
      }
    }
    findBadRefs(arr);
    if (bad > 0) { console.log(`  ❌ ${fp}: ${bad} bad refs`); totalBadRefs += bad; }
  });
}
walk(path.join(ROOT, 'prefabs'));
walk(path.join(ROOT, 'scenes'));

console.log(`  文件: ${totalFiles}  节点: ${totalNodes}  组件+脚本: ${totalComps}  坏引用: ${totalBadRefs}`);
if (totalBadRefs === 0) console.log('\n🎉 全部通过!');
else console.log('\n❌ 存在坏引用!');

console.log(`\n📜 生成脚本: ${_scriptRegistry.size} 个 .ts 文件`);
_scriptRegistry.forEach((uuid, name) => console.log(`    ${name}.ts  (${uuid})`));
