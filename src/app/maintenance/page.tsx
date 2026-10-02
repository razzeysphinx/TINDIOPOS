export default function MaintenancePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-16">
      <section className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">
          TINDIO maintenance
        </p>

        <h1 className="text-3xl font-semibold tracking-tight">
          We will be back shortly.
        </h1>

        <p className="text-muted-foreground">
          TINDIO is temporarily unavailable while we complete scheduled database maintenance.
          Please retry in a few minutes.
        </p>
      </section>
    </main>
  );
}
