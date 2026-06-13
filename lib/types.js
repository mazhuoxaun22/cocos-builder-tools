// ---- 基础类型构造函数 ----
const Vec3 = (x, y, z) => ({ __type__: 'cc.Vec3', x, y, z });
const Vec2 = (x, y) => ({ __type__: 'cc.Vec2', x, y });
const Vec4 = (x, y, z, w) => ({ __type__: 'cc.Vec4', x, y, z, w });
const Quat = () => ({ __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 });
const Size = (w, h) => ({ __type__: 'cc.Size', width: w, height: h });
const Color = (r, g, b, a) => ({ __type__: 'cc.Color', r, g, b, a });
// null/undefined returns null instead of { __id__: null }, avoids Cocos deserialization error
const Id = (n) => (n != null) ? { __id__: n } : null;

module.exports = { Vec3, Vec2, Vec4, Quat, Size, Color, Id };
