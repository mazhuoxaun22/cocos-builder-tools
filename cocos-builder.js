// ============================================================
// Cocos Creator Prefab / Scene JSON 构建器 — 兼容入口
// ============================================================
// 所有实现已拆分到 lib/ 目录，此文件仅做统一导出
// 用法不变:
//   node cocos-builder.js                                → 运行内置 Demo
//   node cocos-builder.js prefab <config.json> [output]   → 生成/追加 Prefab
//   node cocos-builder.js scene <config.json> [output]    → 生成/追加 Scene
//   node cocos-builder.js uuid                            → UUID 验证
//   node cocos-builder.js uuid <uuid|compressed>          → UUID 压缩/解压
// ============================================================

const { compressUuid, decompressUuid, generateFileIdV4 } = require('./lib/uuid');
const PrefabBuilder = require('./lib/prefab-builder');
const SceneBuilder = require('./lib/scene-builder');
const stripSceneFileIds = require('./lib/clean');
const { KNOWN_UUIDS } = require('./lib/constants');

module.exports = { PrefabBuilder, SceneBuilder, compressUuid, decompressUuid, generateFileIdV4, KNOWN_UUIDS, stripSceneFileIds };

// ---- CLI 入口转发 ----
if (require.main === module) {
    require('./cli');
}
