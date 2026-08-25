export type TimeClockEntry = {
  id: string;
  storeId: string;
  clockedInAt: string;
};

export type TimeClockStoreOption = {
  id: string;
  name: string;
};

export type TimeClockActionResult =
  | { ok: true; message: string; entry: TimeClockEntry | null }
  | { ok: false; message: string };

export type TimeClockWorkspace = {
  stores: TimeClockStoreOption[];
  entry: TimeClockEntry | null;
};
