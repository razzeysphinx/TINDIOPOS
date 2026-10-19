import type {
  AttendanceEmployee,
  TimeClockEntry,
} from "@tindio/contracts";

export type {
  AttendanceEmployee,
  AttendanceEmployeesResult,
  TimeClockActionResult,
  TimeClockEntry,
} from "@tindio/contracts";

export type TimeClockStoreOption = {
  id: string;
  name: string;
};

export type TimeClockWorkspace = {
  stores: TimeClockStoreOption[];
  entry: TimeClockEntry | null;
  employees: AttendanceEmployee[];
};

export type TimeAttendanceEntry = {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  storeId: string;
  storeName: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  clockInVerificationMethod: string;
  clockOutVerificationMethod: string | null;
};

export type TimeAttendanceEmployeeOption = {
  id: string;
  name: string;
  employeeNumber: string;
};

export type TimeAttendanceWorkspace = {
  entries: TimeAttendanceEntry[];
  employees: TimeAttendanceEmployeeOption[];
  stores: TimeClockStoreOption[];
  clockedInCount: number;
};
