import { z } from 'zod';

const registerAffiliateSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(80),
      email: z.string().trim().email('Please provide a valid email address'),
      phone: z
        .string()
        .trim()
        .min(10, 'Phone number must be at least 10 digits')
        .max(20, 'Phone number is too long'),
      password: z.string().min(6, 'Password must be at least 6 characters').max(100),
      confirmPassword: z.string().optional(),
      referralCode: z.string().trim().max(40).optional(),
    })
    .refine(
      (data) => !data.confirmPassword || data.password === data.confirmPassword,
      {
        message: 'Passwords do not match',
        path: ['confirmPassword'],
      }
    ),
});

const loginAffiliateSchema = z.object({
  body: z.object({
    email: z.string().trim().email('Valid email is required'),
    password: z.string().min(1, 'Password is required'),
  }),
});

const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80).optional(),
    phone: z.string().trim().min(10, 'Valid phone number is required').max(20).optional(),
    address: z.string().trim().max(250).optional(),
    avatarUrl: z.string().trim().max(2000000).optional(),
  }),
});

const changePasswordSchema = z.object({
  body: z
    .object({
      oldPassword: z.string().min(1, 'Current password is required'),
      newPassword: z.string().min(6, 'New password must be at least 6 characters').max(100),
      confirmPassword: z.string().optional(),
    })
    .refine(
      (data) => !data.confirmPassword || data.newPassword === data.confirmPassword,
      {
        message: 'New passwords do not match',
        path: ['confirmPassword'],
      }
    ),
});

const paymentMethodItemSchema = z.object({
  id: z.string().optional(),
  method: z.enum(['bKash', 'Nagad', 'Rocket', 'Bank']),
  accountType: z.string().trim().max(50).optional(),
  accountNumber: z.string().trim().min(5, 'Account number is required').max(50),
  accountName: z.string().trim().min(2, 'Account holder name is required').max(100),
  bankName: z.string().trim().max(100).optional(),
  branchName: z.string().trim().max(100).optional(),
  routingNumber: z.string().trim().max(50).optional(),
  isDefault: z.boolean().optional(),
});

const updatePaymentMethodsSchema = z.object({
  body: z.object({
    paymentMethods: z.array(paymentMethodItemSchema).max(10),
  }),
});

const requestWithdrawalSchema = z.object({
  body: z.object({
    amount: z
      .number({ message: 'Withdrawal amount must be a valid number' })
      .positive('Withdrawal amount must be greater than 0'),
    paymentMethod: z.enum(['bKash', 'Nagad', 'Rocket', 'Bank']),
    paymentDetails: z.object({
      accountNumber: z.string().trim().min(5, 'Account number is required').max(50),
      accountName: z.string().trim().min(2, 'Account holder name is required').max(100),
      accountType: z.string().trim().max(50).optional(),
      bankName: z.string().trim().max(100).optional(),
      branchName: z.string().trim().max(100).optional(),
      routingNumber: z.string().trim().max(50).optional(),
    }),
  }),
});

const adminUpdateStatusSchema = z.object({
  body: z.object({
    status: z.enum(['active', 'pending', 'suspended', 'deactivated']),
    reason: z.string().trim().max(300).optional(),
    commissionConfigOverride: z
      .object({
        commissionRate: z.number().min(0).max(100).optional(),
        durationMonths: z.number().min(1).max(60).optional(),
        commissionType: z.enum(['recurring', 'one_time']).optional(),
      })
      .optional(),
  }),
});

const adminCommissionActionSchema = z.object({
  body: z.object({
    status: z.enum(['approved', 'available', 'rejected', 'reversed']),
    reason: z.string().trim().max(300).optional(),
  }),
});

const adminProcessWithdrawalSchema = z.object({
  body: z.object({
    status: z.enum(['processing', 'completed', 'rejected']),
    transactionReference: z.string().trim().max(120).optional(),
    rejectionReason: z.string().trim().max(300).optional(),
    adminNotes: z.string().trim().max(300).optional(),
  }),
});

export const AffiliateValidation = {
  registerAffiliateSchema,
  loginAffiliateSchema,
  updateProfileSchema,
  changePasswordSchema,
  updatePaymentMethodsSchema,
  requestWithdrawalSchema,
  adminUpdateStatusSchema,
  adminCommissionActionSchema,
  adminProcessWithdrawalSchema,
};

