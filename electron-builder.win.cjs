// Write Windows resources with JavaScript so macOS arm64 does not need Wine.
const { build } = require('./package.json');

module.exports = {
    ...build,
    directories: { ...build.directories, output: 'build/windows-x64' },
    artifactName: '${name}-${version}-${os}_${arch}-iconfix.${ext}',
    compression: 'normal',
    win: { ...build.win, signAndEditExecutable: false },
    afterPack: './scripts/windows-resources.cjs',
};
