const icpTiers = ["A", "B", "C", "D"] as const;
const priorityTiers = ["HOT", "WARM", "COOL", "MONITOR"] as const;

export default function AccountsPage() {
  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Accounts
          </h1>
          <div className="w-full max-w-md">
            <label htmlFor="account-search" className="sr-only">
              Search accounts
            </label>
            <input
              id="account-search"
              type="search"
              name="q"
              placeholder="Search accounts..."
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-zinc-600 focus:border-zinc-600 focus:ring-2 focus:ring-zinc-600/40"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            ICP tier
          </p>
          <div className="flex flex-wrap gap-2">
            {icpTiers.map((tier) => (
              <button
                key={tier}
                type="button"
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
              >
                {tier}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Priority tier
          </p>
          <div className="flex flex-wrap gap-2">
            {priorityTiers.map((tier) => (
              <button
                key={tier}
                type="button"
                className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
              >
                {tier}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900/80">
                  <th className="px-4 py-3 font-medium text-zinc-400">Name</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">
                    ICP tier
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-400">
                    Priority
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-400">
                    Expected revenue
                  </th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Stage</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">Signals</th>
                  <th className="px-4 py-3 font-medium text-zinc-400">
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-16 text-center"
                  >
                    <p className="text-base font-medium text-zinc-300">
                      No accounts loaded
                    </p>
                    <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
                      Connect your CRM in{" "}
                      <a href="/settings" className="text-zinc-300 underline hover:text-zinc-100">
                        Settings
                      </a>{" "}
                      to sync your accounts. They&apos;ll be scored and prioritised
                      automatically.
                    </p>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
