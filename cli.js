#!/usr/bin/env node
// ============================================================
// Cocos Creator 通用 Prefab / Scene JSON 构建器 CLI
// ============================================================
// 用法:
//   node cli.js                                → 运行内置 Demo
//   node cli.js uuid                            → UUID 验证
//   node cli.js uuid <uuid|compressed>          → UUID 压缩/解压
//   node cli.js prefab <config.json> [output]   → 生成/追加 Prefab
//   node cli.js scene <config.json> [output]    → 生成/追加 Scene
//   node cli.js clean <scene1> [scene2 ...]     → 清理 _id
//   node cli.js clean-cache                     → 清理 library/ temp/（工具生成后必须清理）
// ============================================================


const fs = require('fs');
const path = require('path');
const { PrefabBuilder, SceneBuilder, compressUuid, decompressUuid, KNOWN_UUIDS, stripSceneFileIds } = require('./cocos-builder');

function main(args) {
    if (args.length === 0) {
        console.log('🔧 无参数 → 运行内置 Demo');
        require('./demo/game-over-panel').build();
        return;
    }

    const mode = args[0];

    // ---- UUID 模式 ----
    if (mode === 'uuid') {
        if (args.length === 1) {
            console.log('=== UUID 压缩算法验证 ===');
            let allPass = true;
            for (const [name, pair] of Object.entries(KNOWN_UUIDS)) {
                const comp = compressUuid(pair.uuid);
                const decomp = decompressUuid(pair.compressed);
                const cOk = comp === pair.compressed;
                const dOk = decomp === pair.uuid;
                console.log(`${name}: ${cOk ? '✅' : '❌'}压缩 ${dOk ? '✅' : '❌'}解压`);
                if (!cOk || !dOk) allPass = false;
            }
            const demoUuid = '4c18be38-6250-4b43-9d40-d65e3a7df141';
            const demoCompressed = compressUuid(demoUuid);
            console.log(`\nDemo UUID: ${demoUuid}`);
            console.log(`压缩结果:  ${demoCompressed} (${demoCompressed.length}字符)`);
            console.log(`解压还原:  ${decompressUuid(demoCompressed)}`);
            console.log(allPass ? '\n✅ 所有已知映射验证通过！' : '\n⚠️ 警告：已知映射验证失败！');
            if (!allPass) process.exit(1);
        } else {
            for (let i = 1; i < args.length; i++) {
                const arg = args[i];
                try {
                    if (arg.includes('-') && arg.length >= 36) {
                        console.log(`UUID压缩: ${arg} → ${compressUuid(arg)}`);
                    } else if (arg.length === 23 && !arg.includes('-')) {
                        console.log(`压缩解压: ${arg} → ${decompressUuid(arg)}`);
                    } else {
                        console.log(`无法识别: ${arg} (需32位UUID或23位压缩形态)`);
                    }
                } catch (e) { console.log(`错误: ${e.message}`); }
            }
        }
        return;
    }

    // ---- Prefab 模式 ----
    if (mode === 'prefab') {
        const configPath = args[1];
        if (!configPath || !fs.existsSync(configPath)) {
            console.error('❌ 配置文件不存在: ' + (configPath || '(未提供)'));
            console.log('用法: node cli.js prefab <config.json> [output.prefab]');
            process.exit(1);
        }
        console.log('📄 配置: ' + configPath);
        PrefabBuilder.fromJSON(configPath).write(args[2]);
        return;
    }

    // ---- Scene 模式 ----
    if (mode === 'scene') {
        const configPath = args[1];
        if (!configPath || !fs.existsSync(configPath)) {
            console.error('❌ 配置文件不存在: ' + (configPath || '(未提供)'));
            console.log('用法: node cli.js scene <config.json> [output.scene]');
            process.exit(1);
        }
        console.log('📄 配置: ' + configPath);
        SceneBuilder.fromJSON(configPath).write(args[2]);
        return;
    }

    // ---- clean 清理模式 ----
    if (mode === 'clean') {
        if (args.length < 2) {
            console.error('❌ 请提供场景文件路径');
            console.log('用法: node cli.js clean <scene1.scene> [scene2.scene ...]');
            process.exit(1);
        }
        for (let i = 1; i < args.length; i++) {
            stripSceneFileIds(args[i]);
        }
        return;
    }

    // ---- clean-cache 清理缓存 ---- （资产重新生成后必须执行）
    if (mode === 'clean-cache') {
        const dirs = ['library', 'temp'];
        for (const d of dirs) {
            const p = path.resolve(d);
            if (fs.existsSync(p)) {
                console.log(`🧹 清理缓存: ${p}`);
                fs.rmSync(p, { recursive: true, force: true });
                console.log(`   ✅ 已删除`);
            } else {
                console.log(`   ⏭️  跳过(不存在): ${p}`);
            }
        }
        console.log('✅ 缓存清理完成，Cocos 编辑器下次打开将重新编译。');
        return;
    }

    // ---- 直接文件路径 → 当作 Prefab 配置 ----
    if (fs.existsSync(mode)) {
        console.log('📄 从配置文件构建 Prefab: ' + mode);
        PrefabBuilder.fromJSON(mode).write(args[1]);
    } else {
        console.error('❌ 未知命令: ' + mode);
        console.log('用法:');
        console.log('  node cli.js                              → 运行 Demo');
        console.log('  node cli.js uuid [uuid|compressed]       → UUID 工具');
        console.log('  node cli.js prefab <config.json> [out]   → Prefab');
        console.log('  node cli.js scene <config.json> [out]    → Scene');
        console.log('  node cli.js clean <scene1> [scene2 ...]  → 清理 _id');
        process.exit(1);
    }
}

main(process.argv.slice(2));
