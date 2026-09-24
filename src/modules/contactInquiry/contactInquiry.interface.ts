export interface IContactInquiry {
  firstName: string;
  lastName: string;
  email: string;
  topic: string;
  message: string;
  status: 'pending' | 'resolved';
  ipAddress?: string;
}
