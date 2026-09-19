const fs = require('fs');
const filePath = 'src/modules/subscription/subscription.service.ts';
let content = fs.readFileSync(filePath, 'utf-8');

content = content.replace(/notifySubscriptionUpdate\(subscription\.tenantId \|\| \(typeof tenantId !== "undefined" \? tenantId : undefined\)\)/g, 'notifySubscriptionUpdate((subscription as any)?.tenantId?.toString())');

content = content.replace(/notifySubscriptionUpdate\(subscription\.tenantId\)/g, 'notifySubscriptionUpdate((subscription as any)?.tenantId?.toString())');

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Fixed TS errors');
