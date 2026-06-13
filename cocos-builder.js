// ============================================================
// Cocos Creator Prefab / Scene JSON Builder — Compatibility Entry
// ============================================================
// All implementations are split into lib/ directory; this file only re-exports
// Usage unchanged:
//   node cocos-builder.js                                → run built-in Demo
//   node cocos-builder.js prefab <config.json> [output]   → create/append Prefab
//   node cocos-builder.js scene <config.json> [output]    → create/append Scene
//   node cocos-builder.js uuid                            → UUID validation
//   node cocos-builder.js uuid <uuid|compressed>          → UUID compress/decompress
// ============================================================

const { compressUuid, decompressUuid, generateFileIdV4 } = require('./lib/uuid');
const PrefabBuilder = require('./lib/prefab-builder');
const SceneBuilder = require('./lib/scene-builder');
const stripSceneFileIds = require('./lib/clean');
const { KNOWN_UUIDS } = require('./lib/constants');

module.exports = { PrefabBuilder, SceneBuilder, compressUuid, decompressUuid, generateFileIdV4, KNOWN_UUIDS, stripSceneFileIds };

// ---- CLI entry forwarder ----
if (require.main === module) {
    require('./cli');
}
