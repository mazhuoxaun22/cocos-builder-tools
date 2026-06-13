// Demo: Generic Panel (Prefab)
const { PrefabBuilder } = require('../cocos-builder');

function build() {
    const b = new PrefabBuilder({
        name: 'DemoPanel',
        outputPath: 'assets/prefabs/DemoPanel.prefab',
        fileIdPrefix: 'demoPnl',
    });
    b.addNode({ name: 'DemoPanel', parent: null, position: [0, 0, 0] });
    b.addNode({ name: 'ModalMask', parent: 'DemoPanel', position: [0, 0, 0], static: true });
    b.addNode({ name: 'TitleLabel', parent: 'DemoPanel', position: [0, 200, 0] });
    b.addNode({ name: 'DetailLabel', parent: 'DemoPanel', position: [0, 50, 0] });
    b.addNode({ name: 'BtnOK', parent: 'DemoPanel', position: [0, -250, 0] });
    b.addUITransform({ node: 'DemoPanel', size: [540, 960] });
    b.addSprite({ node: 'DemoPanel', color: [0, 0, 0, 180] });
    b.addUITransform({ node: 'ModalMask', size: [1080, 1920] });
    b.addUITransform({ node: 'TitleLabel', size: [400, 60] });
    b.addLabel({ node: 'TitleLabel', text: 'Demo Title', fontSize: 48, lineHeight: 56, color: [255, 215, 0, 255], bold: true });
    b.addUITransform({ node: 'DetailLabel', size: [400, 40] });
    b.addLabel({ node: 'DetailLabel', text: 'This is a demo panel.', fontSize: 24, lineHeight: 32, color: [200, 200, 200, 255] });
    b.addUITransform({ node: 'BtnOK', size: [200, 50] });
    b.addSprite({ node: 'BtnOK', color: [100, 180, 255, 255] });
    b.addButton({ node: 'BtnOK', target: 'BtnOK' });
    b.addLabel({ node: 'BtnOK', text: 'OK', fontSize: 28, lineHeight: 36, color: [255, 255, 255, 255] });
    b.write();
}

if (require.main === module) build();
module.exports = { build };
