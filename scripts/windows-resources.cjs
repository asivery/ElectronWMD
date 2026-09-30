const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const digest = (data) => createHash('sha256').update(Buffer.from(data)).digest('hex');
const iconBytes = (item) => item.isRaw() ? item.bin : item.generate();

module.exports = async function writeWindowsResources(context) {
    if (context.electronPlatformName !== 'win32') return;
    const R = await import('resedit');
    const { appInfo } = context.packager;
    const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
    const iconPath = path.join(context.packager.projectDir, 'res', 'icon.ico');
    const icon = R.Data.IconFile.from(await fs.readFile(iconPath));
    assert(icon.icons.length > 0, 'Application ICO must contain an image');
    // Like the normal resource editor, this produces an unsigned application.
    const exe = R.NtExecutable.from(await fs.readFile(exePath), { ignoreCert: true });
    const originalSections = exe.getAllSections()
        .filter((section) => section.info.name !== '.rsrc')
        .map((section) => ({
            name: section.info.name,
            address: section.info.virtualAddress,
            hash: digest(section.data || new ArrayBuffer(0)),
        }));
    const resources = R.NtExecutableResource.from(exe);
    const unchangedResources = resources.entries.filter((entry) => ![3, 14, 16].includes(entry.type))
        .map((entry) => ({ type: entry.type, id: entry.id, lang: entry.lang, hash: digest(entry.bin) }));
    const groups = R.Resource.IconGroupEntry.fromEntries(resources.entries);
    if (groups.length === 0) groups.push({ id: 1, lang: 1033 });
    for (const group of groups) {
        R.Resource.IconGroupEntry.replaceIconsForResource(
            resources.entries, group.id, group.lang, icon.icons.map((item) => item.data));
    }
    for (const version of R.Resource.VersionInfo.fromEntries(resources.entries)) {
        version.setFileVersion(`${appInfo.version.split('-')[0]}.0`);
        version.setProductVersion(`${appInfo.version.split('-')[0]}.0`);
        for (const language of version.getAllLanguagesForStringValues()) {
            version.setStringValues(language, {
                CompanyName: appInfo.companyName,
                FileDescription: appInfo.productName,
                ProductName: appInfo.productName,
                InternalName: appInfo.productFilename,
                OriginalFilename: `${appInfo.productFilename}.exe`,
                FileVersion: appInfo.version,
                ProductVersion: appInfo.version,
                LegalCopyright: appInfo.copyright,
            });
        }
        version.outputToResourceEntries(resources.entries);
    }
    resources.outputResource(exe);
    const result = Buffer.from(exe.generate());
    // Validate the generated PE before replacing the executable.
    const checkedExe = R.NtExecutable.from(result);
    const checkedResources = R.NtExecutableResource.from(checkedExe);
    const checkedGroups = R.Resource.IconGroupEntry.fromEntries(checkedResources.entries);
    assert.equal(checkedGroups.length, groups.length);
    for (const group of checkedGroups) {
        const images = group.getIconItemsFromEntries(checkedResources.entries);
        assert.equal(images.length, icon.icons.length);
        images.forEach((item, index) => assert.equal(digest(iconBytes(item)), digest(iconBytes(icon.icons[index].data))));
    }
    for (const original of originalSections) {
        const section = checkedExe.getAllSections().find((item) => item.info.name === original.name);
        assert(section, `Missing PE section: ${original.name}`);
        assert.equal(digest(section.data || new ArrayBuffer(0)), original.hash, `Changed PE section: ${original.name}`);
        // Resource growth may move the relocation table; executable code must stay at its original address.
        if (original.name !== '.reloc') assert.equal(section.info.virtualAddress, original.address);
    }
    for (const original of unchangedResources) {
        const entry = checkedResources.entries.find((item) =>
            item.type === original.type && item.id === original.id && item.lang === original.lang);
        assert(entry, `Missing resource: ${original.type}/${original.id}`);
        assert.equal(digest(entry.bin), original.hash);
    }
    await fs.writeFile(exePath, result);
    console.log(`Windows icon embedded and verified: ${exePath}`);
};
