// ---- Shared utility functions ----

/**
 * Recursively shift all __id__ and __id_marker__ in an object (generic ID offset tool)
 */
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

/** Shift only newly added keys in map */
function shiftMapNewOnly(map, offset, existingKeys) {
    for (const k of Object.keys(map)) {
        if (existingKeys && existingKeys.has(k)) continue;
        map[k] += offset;
    }
}

// ================================================================
//  Safe delete node/component — avoid breaking __id__ index
// ================================================================

/**
 * Determine if it's safe to delete count elements from the end of the array
 * Safe conditions: deleted indices must be contiguous and at array end, with no dangling refs
 * @returns {{ safe: boolean, indices: number[], reason?: string }}
 */
function canSafeDelete(arr, indices, opts = {}) {
    if (!indices || indices.length === 0) return { safe: false, indices, reason: 'empty index list' };
    const sorted = [...indices].sort((a, b) => a - b);
    // must be contiguous block at end
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) {
            return { safe: false, indices, reason: `indices not contiguous: ${sorted.join(', ')}` };
        }
    }
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    if (end !== arr.length - 1 && !opts.allowMidArray) {
        return { safe: false, indices, reason: `indices not at array end (${start}~${end}, total ${arr.length})` };
    }
    // check if any other objects reference these indices
    if (!opts.skipDangleCheck) {
        const dangling = findDanglingRefs(arr, sorted);
        if (dangling.length > 0) {
            const refs = dangling.map(d => `idx[${d.refIdx}] → __id__:${d.value}`).slice(0, 5);
            const more = dangling.length > 5 ? ` + ${dangling.length - 5} more` : '';
            return { safe: false, indices, reason: `deleted objects still referenced: ${refs.join(', ')}${more}` };
        }
    }
    return { safe: true, indices: sorted };
}

/**
 * Find all __id__ references in array pointing to deleted indices
 * (excluding references within deleted objects themselves)
 * @returns {{ refIdx: number, key: string, value: number }[]}
 */
function findDanglingRefs(arr, deletedIndices) {
    const deletedSet = new Set(deletedIndices);
    const refs = [];
    function scan(obj, parentKey, parentIdx) {
        if (!obj || typeof obj !== 'object') return;
        for (const [k, v] of Object.entries(obj)) {
            if (k === '__id__' && typeof v === 'number' && deletedSet.has(v)) {
                // exclude references inside deleted objects themselves
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
 * Safe splice delete: only splice when indices are safe
 * @returns {{ success: boolean, removed: object[] }}
 */
function safeSplice(arr, indices) {
    const check = canSafeDelete(arr, indices);
    if (!check.safe) {
        console.error(`❌ Unsafe delete: ${check.reason}`);
        return { success: false, removed: [] };
    }
    const count = indices.length;
    const start = arr.length - count;
    const removed = arr.splice(start, count);
    console.log(`🔧 Safely deleted ${count} object(s) (indices ${check.indices[0]}~${check.indices[check.indices.length - 1]})`);
    return { success: true, removed };
}

/**
 * Collect indices of a node and all associated objects (components, PrefabInfo, CompPrefabInfo)
 * @returns {number[]} sorted index list
 */
function collectNodeIndices(arr, nodeIdx) {
    const collected = [nodeIdx];
    const node = arr[nodeIdx];
    if (!node || node.__type__ !== 'cc.Node') return collected;

    // collect component indices
    const comps = node._components || [];
    for (const c of comps) {
        if (c && c.__id__ !== undefined && c.__id__ !== null) {
            collected.push(c.__id__);
        }
    }

    // collect associated PrefabInfo (node._prefab reference)
    if (node._prefab && node._prefab.__id__ !== undefined && node._prefab.__id__ !== null) {
        collected.push(node._prefab.__id__);
    }

    // collect component __prefab (CompPrefabInfo)
    for (const cIdx of collected.slice()) {  // iterate over copy
        const obj = arr[cIdx];
        if (!obj) continue;
        if (obj.__prefab && obj.__prefab.__id__ !== undefined && obj.__prefab.__id__ !== null) {
            const pfiIdx = obj.__prefab.__id__;
            if (!collected.includes(pfiIdx)) collected.push(pfiIdx);
        }
    }

    // collect child nodes recursively
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
