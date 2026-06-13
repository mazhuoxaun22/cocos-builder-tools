// ---- 共享工具函数 ----

/** 递归偏移对象中所有 __id__ 和 __id_marker__（通用 ID 偏移工具） */
function shiftIDs(obj, offset, resolveMarkers = true) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
        if (k === '__id_marker__') {
            if (resolveMarkers) { delete obj.__id_marker__; obj.__id__ = v + offset; }
            else obj.__id_marker__ = v + offset;
        } else if (k === '__id__' && typeof v === 'number') {
            obj.__id__ = v + offset;
        } else if (Array.isArray(v)) {
            v.forEach(it => shiftIDs(it, offset, resolveMarkers));
        } else if (typeof v === 'object' && v !== null) {
            shiftIDs(v, offset, resolveMarkers);
        }
    }
}

/** 偏移 map 中仅新增的 key */
function shiftMapNewOnly(map, offset, existingKeys) {
    for (const k of Object.keys(map)) {
        if (existingKeys && existingKeys.has(k)) continue;
        map[k] += offset;
    }
}

// ================================================================
//  安全删除节点/组件 — 避免破坏 __id__ 索引
// ================================================================

/**
 * 判断是否可以安全地从数组末尾删除 count 个元素
 * 安全条件: 被删索引全部连片且在数组末尾，且删除后无悬挂引用
 * @returns {{ safe: boolean, indices: number[], reason?: string }}
 */
function canSafeDelete(arr, indices, opts = {}) {
    if (!indices || indices.length === 0) return { safe: false, indices, reason: '空索引列表' };
    const sorted = [...indices].sort((a, b) => a - b);
    // 必须是连续块且在末尾
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) {
            return { safe: false, indices, reason: `索引不连续: ${sorted.join(', ')}` };
        }
    }
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    if (end !== arr.length - 1 && !opts.allowMidArray) {
        return { safe: false, indices, reason: `索引不在数组末尾 (${start}~${end}, 总长 ${arr.length})` };
    }
    // 检查是否有其他对象引用这些索引
    if (!opts.skipDangleCheck) {
        const dangling = findDanglingRefs(arr, sorted);
        if (dangling.length > 0) {
            const refs = dangling.map(d => `索引[${d.refIdx}] → __id__:${d.value}`).slice(0, 5);
            const more = dangling.length > 5 ? ` 及 ${dangling.length - 5} 处更多` : '';
            return { safe: false, indices, reason: `被删对象被外部引用: ${refs.join(', ')}${more}` };
        }
    }
    return { safe: true, indices: sorted };
}

/**
 * 查找数组中所有指向指定索引的 __id__ 引用（排除被删对象自身间的引用）
 * @returns {{ refIdx: number, key: string, value: number }[]}
 */
function findDanglingRefs(arr, deletedIndices) {
    const deletedSet = new Set(deletedIndices);
    const refs = [];
    function scan(obj, parentKey, parentIdx) {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
            if (k === '__id__' && typeof v === 'number' && deletedSet.has(v)) {
                // 排除被删对象内部的引用
                if (parentIdx !== undefined && !deletedSet.has(parentIdx)) {
                    refs.push({ refIdx: parentIdx, key: k, value: v });
                }
            } else if (Array.isArray(v)) {
                v.forEach((it, i) => scan(it, k + '[' + i + ']', parentIdx));
            } else if (typeof v === 'object' && v !== null) {
                scan(v, k, parentIdx);
            }
        }
    }
    for (let i = 0; i < arr.length; i++) {
        if (deletedSet.has(i)) continue;
        scan(arr[i], null, i);
    }
    return refs;
}

/**
 * 安全拼接删除：仅当索引安全时才执行 splice
 * @returns {{ success: boolean, removed: object[] }}
 */
function safeSplice(arr, indices) {
    const check = canSafeDelete(arr, indices);
    if (!check.safe) {
        console.error(`❌ 不安全删除: ${check.reason}`);
        return { success: false, removed: [] };
    }
    const count = indices.length;
    const start = arr.length - count;
    const removed = arr.splice(start, count);
    console.log(`🔧 已安全删除 ${count} 个对象 (索引 ${check.indices[0]}~${check.indices[check.indices.length - 1]})`);
    return { success: true, removed };
}

/**
 * 从数组中收集节点及其所有关联对象（组件、PrefabInfo、CompPrefabInfo）的索引
 * @returns {number[]} 排序后的索引列表
 */
function collectNodeIndices(arr, nodeIdx) {
    const collected = [nodeIdx];
    const node = arr[nodeIdx];
    if (!node || node.__type__ !== 'cc.Node') return collected;

    // 收集组件索引
    const comps = node._components || [];
    for (const c of comps) {
        if (c && c.__id__ !== undefined && c.__id__ !== null) {
            collected.push(c.__id__);
        }
    }

    // 收集关联的 PrefabInfo（节点的 _prefab 引用）
    if (node._prefab && node._prefab.__id__ !== undefined && node._prefab.__id__ !== null) {
        collected.push(node._prefab.__id__);
    }

    // 收集组件的 __prefab (CompPrefabInfo)
    for (const cIdx of collected.slice()) {  // 遍历副本
        const obj = arr[cIdx];
        if (!obj) continue;
        if (obj.__prefab && obj.__prefab.__id__ !== undefined && obj.__prefab.__id__ !== null) {
            const pfiIdx = obj.__prefab.__id__;
            if (!collected.includes(pfiIdx)) collected.push(pfiIdx);
        }
    }

    // 收集子节点递归
    const children = node._children || [];
    for (const child of children) {
        if (child && child.__id__ !== undefined && child.__id__ !== null) {
            const childIndices = collectNodeIndices(arr, child.__id__);
            for (const ci of childIndices) {
                if (!collected.includes(ci)) collected.push(ci);
            }
        }
    }

    return collected.sort((a, b) => a - b);
}

module.exports = { shiftIDs, shiftMapNewOnly, canSafeDelete, findDanglingRefs, safeSplice, collectNodeIndices };
