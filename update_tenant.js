const fs = require('fs');
const filePath = 'src/modules/tenant/tenant.service.ts';
let content = fs.readFileSync(filePath, 'utf-8');

const helper = `
const notifyTenantUpdate = async (tenantId?: string) => {
  try {
    const io = require('../../socket').getIO();
    const { User } = require('../auth/auth.model');
    const superAdmins = await User.find({ role: 'super_admin' });
    for (const admin of superAdmins) {
      io.to('user_' + admin._id.toString()).emit('refresh_tenants');
    }
    if (tenantId) {
      const tenant = await Tenant.findById(tenantId);
      if (tenant && tenant.ownerId) {
        io.to('user_' + tenant.ownerId.toString()).emit('account_status_changed');
      }
    }
  } catch (error) {}
};
`;

content = content.replace('const createTenant', helper + '\nconst createTenant');
// find where we update or delete the tenant
content = content.replace(/return tenant;\n};/g, 'await notifyTenantUpdate(tenantId || tenant?._id);\n  return tenant;\n};');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Updated tenant.service.ts');
