const fs = require('fs');
let filePath = 'src/modules/package/package.service.ts';
let content = fs.readFileSync(filePath, 'utf-8');

const helper = `
const notifyPackageUpdate = async () => {
  try {
    const io = require('../../socket').getIO();
    io.emit('refresh_packages');
  } catch (error) {}
};
`;

content = content.replace('const createPackage', helper + '\nconst createPackage');
content = content.replace(/return newPackage;\n};/g, 'await notifyPackageUpdate();\n  return newPackage;\n};');
content = content.replace(/return packageData;\n};/g, 'await notifyPackageUpdate();\n  return packageData;\n};');

fs.writeFileSync(filePath, content, 'utf-8');

filePath = 'src/modules/addon/addon.service.ts';
content = fs.readFileSync(filePath, 'utf-8');
content = content.replace('const createAddon', helper + '\nconst createAddon');
content = content.replace(/return addon;\n};/g, 'await notifyPackageUpdate();\n  return addon;\n};');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Updated package and addon services');
