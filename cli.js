#!/usr/bin/env node
// ============================================================
// Cocos Creator Universal Prefab / Scene JSON Builder CLI
// ============================================================
// Usage:
//   node cli.js                                → run built-in Demo
//   node cli.js uuid                            → UUID validation
//   node cli.js uuid <uuid|compressed>          → UUID compress/decompress
//   node cli.js prefab <config.json> [output]   → create/append Prefab
//   node cli.js scene <config.json> [output]    → create/append Scene
//   node cli.js clean <scene1> [scene2 ...]     → strip _id fields
//   node cli.js clean-cache                     → clean library/ temp/ (required after tool-generated assets)
// ============================================================


const fs = require('fs');
const path = require('path');
const { PrefabBuilder, SceneBuilder, compressUuid, decompressUuid, KNOWN_UUIDS, stripSceneFileIds } = require('./cocos-builder');

function main(args) {
    if (args.length === 0) {
        console.log('🔧 No args → running built-in Demo');
        require('./demo/game-over-panel').build();
        return;
    }

    const mode = args[0];

    // ---- UUID mode ----
    if (mode === 'uuid') {
        if (args.length === 1) {
            console.log('=== UUID Compression Algorithm Validation ===');
            let allPass = true;
            for (const [name, pair] of Object.entries(KNOWN_UUIDS)) {
                const comp = compressUuid(pair.uuid);
                const decomp = decompressUuid(pair.compressed);
                const cOk = comp === pair.compressed;
                const dOk = decomp === pair.uuid;
                console.log(`${name}: ${cOk ? '✅' : '❌'} compress ${dOk ? '✅' : '❌'} decompress`);
                if (!cOk || !dOk) allPass = false;
            }
            const demoUuid = '4c18be38-6250-4b43-9d40-d65e3a7df141';
            const demoCompressed = compressUuid(demoUuid);
            console.log(`\nDemo UUID: ${demoUuid}`);
            console.log(`Compressed:  ${demoCompressed} (${demoCompressed.length} chars)`);
            console.log(`Decompressed:  ${decompressUuid(demoCompressed)}`);
            console.log(allPass ? '\n✅ All known mappings validated!' : '\n⚠️ Warning: known mapping validation failed!');
            if (!allPass) process.exit(1);
        } else {
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                try {
                    if (arg.includes('-') && arg.length >= 36) {
                        console.log(`UUID compress: ${arg} → ${compressUuid(arg)}`);
                    } else if (arg.length === 23 && !arg.includes('-')) {
                        console.log(`UUID decompress: ${arg} → ${decompressUuid(arg)}`);
                    } else {
                        console.log(`Unrecognized: ${arg} (need 32-char UUID or 23-char compressed form)`);
                    }
                } catch (e) { console.log(`Error: ${e.message}`); }
            }
        }
        return;
    }

    // ---- Prefab mode ----
    if (mode === 'prefab') {
        const configPath = args[1];
        if (!configPath || !fs.existsSync(configPath)) {
            console.error('❌ Config file not found: ' + (configPath || '(not provided)'));
            console.log('Usage: node cli.js prefab <config.json> [output.prefab]');
            process.exit(1);
        }
        console.log('📄 Config: ' + configPath);
        PrefabBuilder.fromJSON(configPath).write(args[2]);
        return;
    }

    // ---- Scene mode ----
    if (mode === 'scene') {
        const configPath = args[1];
        if (!configPath || !fs.existsSync(configPath)) {
            console.error('❌ Config file not found: ' + (configPath || '(not provided)'));
            console.log('Usage: node cli.js scene <config.json> [output.scene]');
            process.exit(1);
        }
        console.log('📄 Config: ' + configPath);
        SceneBuilder.fromJSON(configPath).write(args[2]);
        return;
    }

    // ---- clean mode ----
    if (mode === 'clean') {
        if (args.length < 2) {
            console.error('❌ Please provide scene file path(s)');
            console.log('Usage: node cli.js clean <scene1.scene> [scene2.scene ...]');
            process.exit(1);
        }
        for (let i = 1; i < args.length; i++) {
            stripSceneFileIds(args[i]);
        }
        return;
    }

    // ---- clean-cache mode ---- (required after tool-generated assets)
    if (mode === 'clean-cache') {
        const dirs = ['library', 'temp'];
        for (const d of dirs) {
            const p = path.resolve(d);
            if (fs.existsSync(p)) {
                console.log(`🧹 Cleaning cache: ${p}`);
                fs.rmSync(p, { recursive: true, force: true });
                console.log(`   ✅ Deleted`);
            } else {
                console.log(`   ⏭️  Skipped (not found): ${p}`);
            }
        }
        console.log('✅ Cache cleaned. Cocos Creator will recompile on next launch.');
        return;
    }

    // ---- treat as Prefab config file ----
    if (fs.existsSync(mode)) {
        console.log('📄 Building Prefab from config: ' + mode);
        PrefabBuilder.fromJSON(mode).write(args[1]);
    } else {
        console.error('❌ Unknown command: ' + mode);
        console.log('Usage:');
        console.log('  node cli.js                              → run Demo');
        console.log('  node cli.js uuid [uuid|compressed]       → UUID tool');
        console.log('  node cli.js prefab <config.json> [out]   → Prefab');
        console.log('  node cli.js scene <config.json> [out]    → Scene');
        console.log('  node cli.js clean <scene1> [scene2 ...]  → strip _id');
        process.exit(1);
    }
}

main(process.argv.slice(2));
