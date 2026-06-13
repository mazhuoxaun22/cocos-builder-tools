// Demo 2: Basic UI Scene
const { SceneBuilder } = require('../cocos-builder');

function build() {
    const sb = new SceneBuilder({ name: 'UIDemo', scenePath: 'assets/scenes/UIDemo.scene' });
    sb.addNode({ name: 'Canvas', parent: null, position: [0, 0, 0] });
    sb.addNode({ name: 'Camera', parent: 'Canvas', position: [0, 0, 1000] });
    sb.addUITransform({ node: 'Canvas', size: [1080, 1920] });
    sb.addCanvas({ node: 'Canvas', camera: 'Camera', designWidth: 1080, designHeight: 1920 });
    sb.addCamera({ node: 'Camera' });
    sb.write();
}

if (require.main === module) build();
module.exports = { build };
