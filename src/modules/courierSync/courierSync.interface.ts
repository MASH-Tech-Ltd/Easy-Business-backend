export interface ISyncDetail {
  tenantId:     string;
  merchantName: string;
  orderId:      string;
  provider:     string;
  oldStatus:    string;
  newStatus:    string;
}

export interface ISkippedDetail {
  tenantId:     string;
  merchantName: string;
  orderId?:     string;
  provider?:    string;
  reason:       string;
  errorType:
    | 'NO_CONFIG'
    | 'NO_PROVIDER'
    | 'UNKNOWN_PROVIDER'
    | 'AUTH_ERROR'
    | 'TRACKING_ERROR'
    | 'NO_STATUS_CHANGE';
}

export interface ICourierSyncReport {
  synced:         number;
  updated:        number;
  skipped:        number;
  details:        ISyncDetail[];
  skippedDetails: ISkippedDetail[];
  startedAt:      Date;
  completedAt:    Date;
  durationMs:     number;
  createdAt?:     Date;
  updatedAt?:     Date;
}
