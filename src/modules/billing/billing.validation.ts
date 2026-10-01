import { z } from 'zod';

export const submitPaymentProofValidation = z.object({
  body: z.object({
    purposeTitle: z.string({ message: 'purposeTitle is required' }).min(1, 'purposeTitle cannot be empty'),
    amount: z.number({ message: 'amount is required' }).positive('amount must be a positive number'),
    provider: z.string({ message: 'provider is required' }).min(1, 'provider cannot be empty'),
    senderNumber: z.string({ message: 'senderNumber is required' }).min(1, 'senderNumber cannot be empty'),
    transactionId: z.string({ message: 'transactionId is required' }).min(1, 'transactionId cannot be empty'),
    purpose: z.enum(['addon', 'package', 'renewal', 'other']).optional(),
    note: z.string().optional(),
  }),
});

export const updatePlatformPaymentSettingsValidation = z.object({
  body: z.object({
    accounts: z.array(
      z.object({
        id: z.string().optional(),
        provider: z.string({ message: 'provider is required' }),
        type: z.string({ message: 'type is required' }),
        accountNumber: z.string({ message: 'accountNumber is required' }),
        accountName: z.string().optional(),
        bankName: z.string().optional(),
        branchName: z.string().optional(),
        instructions: z.string().optional(),
        isActive: z.boolean().optional(),
      })
    ),
  }),
});

export const verifyPaymentSubmissionValidation = z.object({
  params: z.object({
    id: z.string({ message: 'ID parameter is required' }).min(1, 'ID cannot be empty'),
  }),
  body: z.object({
    status: z.enum(['approved', 'rejected', 'pending'], {
      message: 'Status must be approved, rejected, or pending',
    }),
    adminFeedback: z.string().optional(),
  }),
});

export const updatePaymentProofValidation = z.object({
  params: z.object({
    id: z.string({ message: 'ID parameter is required' }).min(1, 'ID cannot be empty'),
  }),
  body: z.object({
    purposeTitle: z.string().optional(),
    amount: z.number().positive().optional(),
    provider: z.string().optional(),
    senderNumber: z.string().optional(),
    transactionId: z.string().optional(),
    note: z.string().optional(),
  }),
});

export const BillingValidation = {
  submitPaymentProofValidation,
  updatePlatformPaymentSettingsValidation,
  verifyPaymentSubmissionValidation,
  updatePaymentProofValidation,
};

