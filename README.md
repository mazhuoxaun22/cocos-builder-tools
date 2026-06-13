# Cocos Creator Prefab/Scene JSON Builder

A Node.js CLI tool for programmatically generating and modifying Cocos Creator `.prefab` and `.scene` JSON files — without opening the Cocos Creator editor.

## Why?

Cocos Creator stores scenes and prefabs as flat JSON arrays with internal `__id__` pointer references. Hand-editing these files is error-prone. This tool:

- Generates prefabs/scenes from declarative JSON configs
- Appends nodes to existing prefabs/scenes (with automatic `__id__` offset)
- Compresses/decompresses Cocos UUIDs (v4 → 23-char Base64)
- Strips invalid `_id` fields from scene files
- Cleans `library/` and `temp/` caches after asset generation

## Installation

```bash
cd _tools
npm install  # (optional, no external deps required)
```

Or use directly without install:

```bash
node cli.js <command>
```

## CLI Usage

```bash
# Run built-in demo (generates DemoPanel.prefab)
node cli.js

# UUID tools
node cli.js uuid                                    # validate known UUID mappings
node cli.js uuid <36-char-uuid>                    # compress to 23-char form
node cli.js uuid <23-char-compressed>              # decompress to standard UUID

# Build prefab from JSON config
node cli.js prefab <config.json> [output.prefab]

# Build scene from JSON config
node cli.js scene <config.json> [output.scene]

# Strip _id fields from scene files (Cocos re-adds these on import)
node cli.js clean <scene1.scene> [scene2.scene ...]

# Clean library/ and temp/ (required after generating assets)
node cli.js clean-cache
```

## JSON Config Format

### Prefab Config

```json
{
  "name": "MyPanel",
  "scriptUuid": "<your-script-uuid>",
  "outputPath": "assets/prefabs/MyPanel.prefab",
  "fileIdPrefix": "myPanel",
  "nodes": [
    { "name": "Root", "parent": null, "position": [0, 0, 0] },
    { "name": "Title", "parent": "Root", "position": [0, 200, 0] }
  ],
  "components": [
    { "type": "UITransform", "node": "Root", "size": [540, 960] },
    { "type": "Label", "node": "Title", "text": "Hello", "fontSize": 48 }
  ]
}
```

### Scene Config

```json
{
  "name": "MyScene",
  "scenePath": "assets/scenes/MyScene.scene",
  "nodes": [
    { "name": "Canvas", "parent": null },
    { "name": "Camera", "parent": "Canvas", "position": [0, 0, 1000] }
  ],
  "components": [
    { "type": "UITransform", "node": "Canvas", "size": [1080, 1920] },
    { "type": "Canvas", "node": "Canvas", "camera": "Camera" },
    { "type": "Camera", "node": "Camera" }
  ]
}
```

### Append Mode

Add `"loadPath": "path/to/existing.prefab"` to your config to append nodes to an existing file. The tool automatically offsets all new `__id__` references.

## Programmatic API

```javascript
const { PrefabBuilder, SceneBuilder, compressUuid, decompressUuid } = require('./cocos-builder');

// Build a prefab
const b = new PrefabBuilder({ name: 'MyPanel', outputPath: 'assets/prefabs/MyPanel.prefab' });
b.addNode({ name: 'Root', parent: null })
 .addUITransform({ node: 'Root', size: [540, 960] })
 .addLabel({ node: 'Root', text: 'Hello', fontSize: 48 })
 .write();

// Build a scene
const s = new SceneBuilder({ name: 'MyScene', scenePath: 'assets/scenes/MyScene.scene' });
s.addNode({ name: 'Canvas', parent: null })
 .addCamera({ node: 'Canvas' })
 .write();
```

## File Structure

```
_tools/
├── cli.js                  # CLI entry point
├── cocos-builder.js        # Compatibility re-export entry
├── package.json
├── lib/                    # Core modules
│   ├── uuid.js             # UUID compress/decompress
│   ├── types.js            # Type templates (Vec3, Color, etc.)
│   ├── constants.js        # Known UUID mappings
│   ├── utils.js            # General utilities
│   ├── templates.js        # Component templates
│   ├── base-builder.js    # Builder base class
│   ├── prefab-builder.js  # Prefab builder
│   ├── scene-builder.js   # Scene builder
│   └── clean.js           # Strip _id from scenes
├── demo/                   # Runnable demos
│   ├── demo-panel.js
│   └── ui-demo-scene.js
├── examples/               # Example configs
│   └── scene-config.example.json
└── docs/                   # Documentation
    └── zh-CN.md
```

## Important Notes

- **Append-only principle**: Never `splice()` scene arrays — it breaks all subsequent `__id__` references. Use `_active = false` for soft-deletes.
- **UUID format**: `__type__` fields must use the **compressed** 23-char form (from `.meta` files), not the standard 36-char UUID.
- **Clean cache**: After generating assets, always run `node cli.js clean-cache` so Cocos Creator recompiles on next launch.
- **`library/` caveat**: If both old and new prefabs exist, delete `library/` to force reimport.

## Chinese Documentation

Full Chinese manual: [docs/zh-CN.md](docs/zh-CN.md)

## License

MIT
