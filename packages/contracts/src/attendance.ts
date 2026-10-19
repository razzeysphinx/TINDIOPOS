export type TimeClockEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  storeId: string;
  storeName: string;
  clockedInAt: string;
  clockedOutAt?: string | null;
};

export type AttendanceEmployee = {
  id: string;
  employeeNumber: string;
  name: string;
  pinIsSet: boolean;
  entry: TimeClockEntry | null;
};

export type AttendanceEmployeesResult =
  | { ok: true; employees: AttendanceEmployee[] }
  | { ok: false; message: string; employees: [] };
