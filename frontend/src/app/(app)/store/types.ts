// StockModel ของ API (ชื่อ property แบบ camelCase)
export type Stock = {
  stkId: number;
  code: string;
  name: string;
  unit: string;
  isMain: boolean;
  isLiveView: boolean;
  useMaxMin: boolean;
  allowDecimal: boolean;
  countCoil: boolean;
  showCoilRowsSetting: boolean | null;
  showCoilRows: boolean;
  maxMinDecimalSetting: boolean | null;
  maxMinDecimal: boolean;
  notSetButton: boolean;
  thirdButtonText: string;
  cardStyleSetting: string | null;
  cardStyle: string;
  coilRowColumns: string | null;
  columnOrder: string | null;
  groupBy: string;
  maxMinBasis: string;
  maxMinUnit: string;
  inPickList: boolean;
  inSupplier: boolean;
  inSysQr: boolean;
  inExcel: boolean;
  outPickList: boolean;
  outSupplier: boolean;
  outSysQr: boolean;
  formatIds: number[];
  qtyHeader: string;
  maxHeader: string;
  minHeader: string;
  boxHeader: string;
  unitDisplay: string;
  displayName: string;
};

export type Product = {
  partId: number;
  partCode: string;
  partName: string;
  customer: string;
  partA: string;
  partB: string;
  partNo: string;
  model: string;
  category: string;
  supplier: string;
  bin: string;
  groupKey: string;
  packSize: string;
  max: string;
  min: string;
  qty: string;
  stockBox: string;
  stockPcs: string;
  remark: string;
  stockStatus: string;
  imageUrl: string | null;
};

export type Counts = { total: number; max: number; min: number; noOrder: number } | null;

export const STATUS_COLOR = (s: string) =>
  s === "OVER_MAX" || s === "NORMAL_GOOD" ? "var(--success)" : s === "UNDER_MIN" || s === "OUT_OF_STOCK" ? "var(--danger)" : "#9e9aa3";

// ชื่อคอลัมน์ตามรหัส (StockModel.ColumnOrder)
export const COLUMN_LABEL: Record<string, string> = {
  NO: "NO.",
  IMAGE: "IMAGE",
  CUSTOMER: "CUSTOMER",
  CODE: "PD CODE",
  PARTA: "PART A",
  PARTB: "PART B",
  PARTNO: "PART NO",
  MODEL: "MODEL",
  NAME: "PRODUCT NAME",
  MAXMIN: "MAX / MIN",
  QTY: "QTY",
  BOX: "STOCK (BOX)",
  COIL: "STOCK (COIL)",
  PCS: "STOCK (PCS)",
  REMARK: "REMARK",
};
