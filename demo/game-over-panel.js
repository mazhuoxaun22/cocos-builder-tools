// Demo 1: GameOverPanel (Prefab)
const { PrefabBuilder } = require('../cocos-builder');

function build() {
    const b = new PrefabBuilder({
        name: 'GameOverPanel', scriptUuid: '4c18b44YlBLQ51A1l46ffFB',
        outputPath: 'assets/resources/prefabs/ui/GameOverPanel.prefab', fileIdPrefix: 'gameOver',
    });
    b.addNode({ name: 'GameOverPanel', parent: null, position: [0, 0, 0] });
    b.addNode({ name: 'ModalMask', parent: 'GameOverPanel', position: [0, 0, 0], static: true });
    b.addNode({ name: 'TitleLabel', parent: 'GameOverPanel', position: [0, 200, 0] });
    b.addNode({ name: 'DetailLabel', parent: 'GameOverPanel', position: [0, 50, 0] });
    b.addNode({ name: 'BtnReturn', parent: 'GameOverPanel', position: [0, -250, 0] });
    b.addUITransform({ node: 'GameOverPanel', size: [540, 960] });
    b.addSprite({ node: 'GameOverPanel', color: [0, 0, 0, 180] });
    b.addScript({ node: 'GameOverPanel', props: {
        titleLabel: { node: 'TitleLabel', component: 'Label' },
        detailLabel: { node: 'DetailLabel', component: 'Label' },
        btnReturn: { node: 'BtnReturn' }, modalMask: { node: 'ModalMask' },
    }});
    b.addUITransform({ node: 'ModalMask', size: [1080, 1920] });
    b.addUITransform({ node: 'TitleLabel', size: [400, 60] });
    b.addLabel({ node: 'TitleLabel', text: '', fontSize: 48, lineHeight: 56, color: [255, 215, 0, 255], bold: true });
    b.addUITransform({ node: 'DetailLabel', size: [400, 40] });
    b.addLabel({ node: 'DetailLabel', text: '', fontSize: 24, lineHeight: 32, color: [200, 200, 200, 255] });
    b.addUITransform({ node: 'BtnReturn', size: [200, 50] });
    b.addSprite({ node: 'BtnReturn', color: [100, 180, 255, 255] });
    b.addButton({ node: 'BtnReturn', target: 'BtnReturn' });
    b.addLabel({ node: 'BtnReturn', text: 'Back to Level Select', fontSize: 28, lineHeight: 36, color: [255, 255, 255, 255] });
    b.write();
}

if (require.main === module) build();
module.exports = { build };
