export interface IContactInquiry {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  topic: string;
  message: string;
  status: 'pending' | 'resolved';
  ipAddress?: string;
}
