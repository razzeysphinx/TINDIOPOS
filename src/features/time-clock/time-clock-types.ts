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

export type TimeClockStoreOption = {
  id: string;
  name: string;
};

export type TimeClockActionResult =
  | { ok: true; message: string; entry: TimeClockEntry }
  | {
      ok: false;
      message: string;
      code?: string;
      openShift?: {
        id: string;
        registerId: string;
        registerName: string;
        openedAt: string;
      };
    };

export type AttendanceEmployeesResult =
  | { ok: true; employees: AttendanceEmployee[] }
  | { ok: false; message: string; employees: [] };

export type TimeClockWorkspace = {
  stores: TimeClockStoreOption[];
  entry: TimeClockEntry | null;
  employees: AttendanceEmployee[];
};
