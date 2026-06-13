// ---- Clean tool: strip _id from cc.Scene in scene files ----
const fs = require('fs');
const path = require('path');

function stripSceneFileIds(scenePath) {
    const p = path.resolve(scenePath);
    if (!fs.existsSync(p)) { console.error(`❌ File not found: ${p}`); return false; }
    const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!Array.isArray(arr)) { console.error('❌ Not a valid scene file'); return false; }
    let cleaned = 0;
    for (const obj of arr) {
        if (obj && obj.__type__ === 'cc.Scene' && obj._id) {
            delete obj._id;
            cleaned++;
        }
    }
    if (cleaned > 0) {
        fs.writeFileSync(p, JSON.stringify(arr, null, 2));
        console.log(`🧹 Cleaned ${cleaned} _id field(s): ${p}`);
    } else {
        console.log(`✅ No cleanup needed: ${p}`);
    }
    return true;
}

module.exports = stripSceneFileIds;
