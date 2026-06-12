// ---- 清理工具：删除场景文件中 cc.Scene 上的 _id ----
const fs = require('fs');
const path = require('path');

function stripSceneFileIds(scenePath) {
    const p = path.resolve(scenePath);
    if (!fs.existsSync(p)) { console.error(`❌ 文件不存在: ${p}`); return false; }
    const arr = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (!Array.isArray(arr)) { console.error('❌ 不是有效的场景文件'); return false; }
    let cleaned = 0;
    for (const obj of arr) {
        if (obj && obj.__type__ === 'cc.Scene' && obj._id) {
            delete obj._id;
            cleaned++;
        }
    }
    if (cleaned > 0) {
        fs.writeFileSync(p, JSON.stringify(arr, null, 2));
        console.log(`🧹 已清理 ${cleaned} 个 _id: ${p}`);
    } else {
        console.log(`✅ 无需清理: ${p}`);
    }
    return true;
}

module.exports = stripSceneFileIds;
