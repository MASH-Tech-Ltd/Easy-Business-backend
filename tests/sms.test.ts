import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBDNumberForSms } from '../src/modules/notification/sms.service';
import { isMerchantOnline } from '../src/socket';

test('formatBDNumberForSms: normalizes 01..., +880..., and 880... and rejects invalid numbers', () => {
  assert.equal(formatBDNumberForSms('01712345678'), '8801712345678');
  assert.equal(formatBDNumberForSms('+8801812-345-678'), '8801812345678');
  assert.equal(formatBDNumberForSms('8801912345678'), '8801912345678');
  assert.equal(formatBDNumberForSms('01212345678'), null); // invalid BD operator prefix
  assert.equal(formatBDNumberForSms('12345'), null);
  assert.equal(formatBDNumberForSms(''), null);
});

test('isMerchantOnline: returns false when Socket.io is not initialized', () => {
  assert.equal(isMerchantOnline('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012'), false);
});
