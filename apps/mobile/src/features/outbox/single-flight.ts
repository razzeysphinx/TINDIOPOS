const activeSyncs = new Map<string, Promise<unknown>>();

export function runOutboxSingleFlight<T>(
  deviceScope: string,
  task: () => Promise<T>,
): Promise<T> {
  const active = activeSyncs.get(deviceScope) as Promise<T> | undefined;
  if (active) return active;

  const started = Promise.resolve().then(task);
  activeSyncs.set(deviceScope, started);

  const clear = () => {
    if (activeSyncs.get(deviceScope) === started) activeSyncs.delete(deviceScope);
  };
  void started.then(clear, clear);
  return started;
}
