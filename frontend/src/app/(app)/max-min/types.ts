export type Stock = { stkId: number; code: string; name: string; unit: string; inBox: boolean; coil: boolean };

export type Formula = {
  formulaId: number;
  name: string;
  isDefault: boolean;
  qtySource: "ORDER" | "FORECAST";
  roundMode: "UP" | "NEAREST" | "DOWN";
  defDayMax: number;
  defDayMin: number;
  defWorkdays: number;
  displayName: string;
  describe: string;
};

export type CalcRow = {
  ptId: number;
  group: string;
  no: number;
  partCode: string;
  partNo: string;
  partName: string;
  packSize: number;
  dayMax: number;
  dayMin: number;
  hasOwnDays: boolean;
  qtyMax: string;
  qtyMin: string;
};

export type CalcData = {
  unit: string;
  formulas: Formula[];
  formula: Formula;
  setting: { formulaId: number | null; autoCalc: boolean; lastCalc: string | null };
  order: string | null;
  rows: CalcRow[];
};
