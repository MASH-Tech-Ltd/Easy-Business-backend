const fs = require('fs');
const filePath = 'src/modules/subscription/subscription.service.ts';
let content = fs.readFileSync(filePath, 'utf-8');

const helper = `
const notifySubscriptionUpdate = async (tenantId?: string) => {
  try {
    const io = require('../../socket').getIO();
    const superAdmins = await User.find({ role: 'super_admin' });
    for (const admin of superAdmins) {
      io.to('user_' + admin._id.toString()).emit('refresh_subscriptions');
    }
    if (tenantId) {
      const tenant = await Tenant.findById(tenantId);
      if (tenant && tenant.ownerId) {
        io.to('user_' + tenant.ownerId.toString()).emit('refresh_subscriptions');
      }
    }
  } catch (error) {}
};
`;

content = content.replace('const assignPackage', helper + '\nconst assignPackage');
content = content.replace(/return subscription;\n};/g, 'await notifySubscriptionUpdate(subscription.tenantId || (typeof tenantId !== "undefined" ? tenantId : undefined));\n  return subscription;\n};');
content = content.replace('await Subscription.deleteOne({ _id: subscriptionId });\n};', 'await Subscription.deleteOne({ _id: subscriptionId });\n  await notifySubscriptionUpdate(subscription.tenantId);\n};');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Updated subscription.service.ts');
