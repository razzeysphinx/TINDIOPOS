export function createForegroundReloadCoordinator<T>(
  task: (organizationId?: string) => Promise<T>,
) {
  let currentTask = task;
  let active: Promise<T> | null = null;
  let queued: {
    organizationId?: string;
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
  } | null = null;

  const start = (organizationId?: string) => {
    const started = Promise.resolve().then(() => currentTask(organizationId));
    active = started;
    const finish = () => {
      if (active !== started) return;
      active = null;
      const trailing = queued;
      queued = null;
      if (!trailing) return;
      void start(trailing.organizationId).then(trailing.resolve, trailing.reject);
    };
    void started.then(finish, finish);
    return started;
  };

  return {
    setTask(nextTask: (organizationId?: string) => Promise<T>) {
      currentTask = nextTask;
    },
    run(organizationId?: string) {
      if (!active) return start(organizationId);
      if (queued) {
        queued.organizationId = organizationId;
        return queued.promise;
      }
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      queued = { organizationId, promise, resolve, reject };
      return promise;
    },
  };
}
