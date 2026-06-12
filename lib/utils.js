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

module.exports = { shiftIDs, shiftMapNewOnly };
