export type ScanStock = {
  stkId: number;
  code: string;
  name: string;
  isMain: boolean;
  canScanIn: boolean;
  canScanOut: boolean;
  supportsReturn: boolean;
  allowDecimal: boolean;
  countCoil: boolean;
  isLiveView: boolean;
  unit: string;
  codeHeader: string;
};

export type ScanFormat = { delimiter: string; spaces: boolean; trimChars: string | null; minFields: number; required: number };

export type ScannerContext = {
  stocks: ScanStock[];
  scope: {
    auto: boolean;
    ids: number[];
    priorityId: number | null;
    isMulti: boolean;
    notAssigned: boolean;
    assignMode: boolean;
    canChange: boolean;
    token: string;
    text: string;
    subText: string;
    serialized: string;
  };
  modes: { out: boolean; return: boolean; remainder: boolean; test: boolean; outOnly: boolean };
  buttons: { scanOut: boolean; return: boolean; remainder: boolean; adjust: boolean; display: boolean; deducted: boolean; notDeducted: boolean; approve: boolean };
  counts: { deductedToday: number; notDeducted: number };
  who: { askEmployee: boolean; askDepartment: boolean; employeeHint: string; departmentHint: string; departments: string[] };
  codeHeader: string;
  contacts: string;
  formats: ScanFormat[];
};

export type ScanRow = {
  partId: number;
  stkId: number;
  stockCode: string;
  partCode: string;
  partName: string;
  partACode: string;
  code: string;
  qty: number;
  status: string;
  time: string;
  isDeductOut: boolean;
  imageUrl: string | null;
};

export type SummaryRow = {
  partId: number;
  stkId: number;
  stockCode: string;
  partCode: string;
  partName: string;
  code: string;
  inCount: number;
  totalInQty: number;
  outCount: number;
  totalOutQty: number;
  finalStock: number;
  imageUrl: string | null;
};

export type Today = { signature: string; rows: ScanRow[]; summary: SummaryRow[] };

export type ScanResult = {
  kind: "Saved" | "SavedWarning" | "Test" | "Error" | "Warning" | "Held" | "NeedStock" | "NeedQty" | "Locked" | "Denied" | "Ignored";
  title: string | null;
  message: string | null;
  item: ScanRow | null;
  focus: "employee" | "department" | null;
  candidates: { stkId: number; code: string; name: string }[] | null;
  qtyDecimal: boolean;
  toastTitle: string | null;
  toastMessage: string | null;
  toastOk: boolean | null;
  refreshDeduct: boolean;
};

export const qtyText = (v: number) => (Number.isFinite(v) ? Number(v.toFixed(3)).toLocaleString("en-US", { maximumFractionDigits: 3 }) : "-");
