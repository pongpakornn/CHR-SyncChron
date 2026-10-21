export type User = {
  userId: string;
  name: string;
  position: string;
  department: string;
  section: string;
  division: string;
  level: number;
  isOnline: boolean;
  isLocked: boolean;
  isMasterAdmin: boolean;
  lastLogin: string | null;
  permCount: number;
  initials: string;
  levelText: string;
  lastLoginText: string;
  statusText: string;
  subText: string;
  subText2: string;
  showScanChip: boolean;
  scanNotSet: boolean;
  scanChipText: string;
};

export type Can = { add: boolean; edit: boolean; delete: boolean; perms: boolean; import: boolean; contact: boolean; setup: boolean };

export type PermRow = { sysId: string; title: string; group: string; hint: string; view: boolean; add: boolean; edit: boolean; delete: boolean; approve: boolean };

export type ScanStock = {
  stkId: number;
  code: string;
  name: string;
  canOut: boolean;
  deductEligible: boolean;
  on: boolean;
  priority: boolean;
  deduct: boolean;
  askEmployee: boolean;
  askDepartment: boolean;
  display: string;
  options: { key: string; label: string }[];
};

export type PermData = {
  user: User;
  rows: PermRow[];
  scanner: { hasWho: boolean; stocks: ScanStock[] } | null;
  contacts: string | null;
};

export type Contact = { fullName: string; phone: string; nickname: string };
