// ---- UUID 压缩/解压/生成 ----
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function compressUuid(uuid) {
    const hex = uuid.replace(/-/g, '').toLowerCase();
    if (hex.length !== 32) throw new Error(`Invalid UUID: ${uuid}`);
    let r = hex.substring(0, 5);
    for (let i = 5; i < hex.length; i += 3) {
        const n = parseInt(hex.substring(i, i + 3) || '0', 16);
        r += BASE64[n >> 6] + BASE64[n & 0x3F];
    }
    return r;
}

function decompressUuid(compressed) {
    if (compressed.length !== 23) throw new Error(`Invalid compressed UUID: ${compressed}, length should be 23`);
    let hex = compressed.substring(0, 5);
    for (let i = 5; i < compressed.length; i += 2) {
        const high = BASE64.indexOf(compressed[i]);
        const low = BASE64.indexOf(compressed[i + 1]);
        if (high === -1 || low === -1)
            throw new Error(`Invalid char at position ${i}: "${compressed[i]}${compressed[i + 1]}"`);
        const n = (high << 6) | low;
        hex += n.toString(16).padStart(3, '0');
    }
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

function generateFileIdV4() {
    const h = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
    return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.random() * 4 | 0]}${h(3)}-${h(12)}`;
}

/** 仿 Cocos 编辑器压缩 UUID 格式，22-23 字符 */
function genObjId() {
    const hex = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.random() * 16 | 0]).join('');
    return compressUuid(hex);
}

module.exports = { compressUuid, decompressUuid, generateFileIdV4, genObjId };
