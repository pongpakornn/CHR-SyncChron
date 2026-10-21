export type Pr = {
  id: number;
  prNumber: string;
  date: string;
  requester: string;
  partCode: string;
  partName: string;
  qty: number;
  unit: string;
  status: string;
  remark: string;
  department: string;
  targetDept: string;
  userID: string;
  appDate: string;
  export: string;
  isExported: boolean;
  stockID: number | null;
  stockCode: string;
  coilNo: string | null;
  motherCoil: string | null;
};

export const STATUS_COLOR: Record<string, string> = { Waiting: "var(--warning)", Approved: "var(--success)", Rejected: "var(--danger)", Exported: "var(--info)" };
