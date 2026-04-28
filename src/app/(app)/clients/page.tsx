import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { autoPromoteClients } from "@/lib/auto-promote";
import { ProposalToggleButton } from "./proposal-toggle-button";
import { EmployeeFilter } from "./employee-filter";

const PAGE_SIZE = 20;

type SortKey = "name" | "status" | "assignedTo";
type SortDir = "asc" | "desc";

type Props = {
  searchParams: Promise<{ q?: string; page?: string; status?: string; sort?: string; dir?: string; assignedTo?: string }>;
};

const CLIENT_STATUS_LABEL: Record<string, string> = {
  NEW:                "New",
  FIRST_APPOINTMENT:  "1st Meeting",
  SECOND_APPOINTMENT: "2nd Meeting",
  PENDING:            "Pending",
  CLOSED:             "Closed",
  BLNT:               "BLNT",
};

const CLIENT_STATUS_STYLE: Record<string, string> = {
  NEW:                "bg-warm-50 text-warm-500",
  FIRST_APPOINTMENT:  "bg-blue-100 text-blue-700",
  SECOND_APPOINTMENT: "bg-amber-100 text-amber-700",
  PENDING:            "bg-purple-100 text-purple-700",
  CLOSED:             "bg-ok-ghost text-ok-dim",
  BLNT:               "bg-red-100 text-red-700",
};

const VALID_STATUSES = ["NEW", "FIRST_APPOINTMENT", "SECOND_APPOINTMENT", "PENDING", "CLOSED", "BLNT"] as const;
type ClientStatus = (typeof VALID_STATUSES)[number];

const VALID_SORTS: SortKey[] = ["name", "status", "assignedTo"];

function buildOrderBy(sort: SortKey, dir: SortDir) {
  if (sort === "status") return [{ clientStatus: dir }, { name: "asc" as const }];
  if (sort === "assignedTo") return [{ assignedTo: { name: dir } }, { name: "asc" as const }];
  return [{ name: dir }];
}

export default async function ClientsPage({ searchParams }: Props) {
  const user = await requireUser();
  const owner = user.role === "OWNER";
  await autoPromoteClients();
  const { q, page: pageParam, status: statusParam, sort: sortParam, dir: dirParam, assignedTo: assignedToParam } = await searchParams;
  const query = q?.trim() ?? "";
  const statusFilter = VALID_STATUSES.includes(statusParam as ClientStatus)
    ? (statusParam as ClientStatus)
    : null;
  const sort: SortKey = VALID_SORTS.includes(sortParam as SortKey) ? (sortParam as SortKey) : "name";
  const dir: SortDir = dirParam === "desc" ? "desc" : "asc";
  const assignedToFilter = owner && assignedToParam ? assignedToParam : null;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Scope all queries to assigned clients for employees
  const scopeFilter = owner ? {} : { assignedToId: user.id };

  const employees = owner
    ? await prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  // Stats scoped to the same visibility as the table
  const [totalCount, newCount, firstApptCount, secondApptCount, pendingCount, awaitingProposalCount, closedCount, blntCount] =
    await Promise.all([
      prisma.client.count({ where: scopeFilter }),
      prisma.client.count({ where: { ...scopeFilter, clientStatus: "NEW" } }),
      prisma.client.count({ where: { ...scopeFilter, clientStatus: "FIRST_APPOINTMENT" } }),
      prisma.client.count({ where: { ...scopeFilter, clientStatus: "SECOND_APPOINTMENT" } }),
      prisma.client.count({ where: { ...scopeFilter, clientStatus: "PENDING" } }),
      prisma.client.count({ where: { ...scopeFilter, clientStatus: "PENDING", proposalSent: false } }),
      prisma.client.count({ where: { ...scopeFilter, clientStatus: "CLOSED" } }),
      prisma.client.count({ where: { ...scopeFilter, clientStatus: "BLNT" } }),
    ]);

  const where = {
    ...scopeFilter,
    ...(assignedToFilter ? { assignedToId: assignedToFilter } : {}),
    ...(statusFilter ? { clientStatus: statusFilter } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" as const } },
            { email: { contains: query, mode: "insensitive" as const } },
            { phone: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy: buildOrderBy(sort, dir),
      skip,
      take: PAGE_SIZE,
      include: {
        assignedTo: { select: { id: true, name: true } },
        contracts: {
          orderBy: { startDate: "desc" },
          take: 1,
          select: { id: true, title: true, status: true },
        },
      },
    }),
    prisma.client.count({ where }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const buildParams = (overrides: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (statusFilter) sp.set("status", statusFilter);
    if (assignedToFilter) sp.set("assignedTo", assignedToFilter);
    if (sort !== "name") sp.set("sort", sort);
    if (dir !== "asc") sp.set("dir", dir);
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    return `?${sp.toString()}`;
  };

  const params = (p: number) => buildParams({ page: String(p) });

  const filterLink = (s: ClientStatus | null) => buildParams({ status: s ?? null, page: null });

  const sortLink = (col: SortKey) => {
    const nextDir = sort === col && dir === "asc" ? "desc" : "asc";
    return buildParams({ sort: col === "name" ? null : col, dir: nextDir === "asc" ? null : "desc", page: null });
  };

  const SortArrow = ({ col }: { col: SortKey }) => {
    if (sort !== col) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="space-y-0">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-4 pb-6 mb-8 border-b border-warm-200">
        <div>
          <p className="text-sm text-warm-500 mb-1">Client overview</p>
          <h1 className="text-3xl font-semibold text-warm-800" style={{ fontFamily: "var(--font-display)" }}>
            Clients
          </h1>
        </div>
        <Link href="/clients/new" className="btn-primary shrink-0">+ New client</Link>
      </div>

      {/* ── Stats strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-7 border border-warm-200 bg-white mb-10">
        <ClientStatCell label="Total"      value={totalCount}      active={!statusFilter}                          href={filterLink(null)} />
        <ClientStatCell label="New"        value={newCount}        active={statusFilter === "NEW"}                 href={filterLink("NEW")} border />
        <ClientStatCell label="1st Mtg"    value={firstApptCount}  active={statusFilter === "FIRST_APPOINTMENT"}   href={filterLink("FIRST_APPOINTMENT")} border />
        <ClientStatCell label="2nd Mtg"    value={secondApptCount} active={statusFilter === "SECOND_APPOINTMENT"}  href={filterLink("SECOND_APPOINTMENT")} border />
        <ClientStatCell label="Pending"    value={pendingCount}    active={statusFilter === "PENDING"}             href={filterLink("PENDING")} border />
        <ClientStatCell label="Closed"     value={closedCount}     active={statusFilter === "CLOSED"}              href={filterLink("CLOSED")} border />
        <ClientStatCell label="BLNT"       value={blntCount}       active={statusFilter === "BLNT"}                href={filterLink("BLNT")} border />
      </div>

      {/* ── Awaiting proposal callout ─────────────────────────── */}
      {awaitingProposalCount > 0 && !statusFilter && !query && (
        <div
          className="flex items-center justify-between px-4 py-3 mb-6 border border-warn bg-amber-50"
        >
          <span className="text-sm font-medium text-amber-800">
            {awaitingProposalCount} client{awaitingProposalCount !== 1 ? "s" : ""} pending — proposal not yet sent
          </span>
          <Link
            href={filterLink("PENDING")}
            className="text-[10px] uppercase text-amber-700 hover:text-amber-900 transition-colors"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}
          >
            View →
          </Link>
        </div>
      )}

      {/* ── Search + filter bar ──────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <form method="GET" className="flex-1 min-w-0">
          {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
          {sort !== "name" && <input type="hidden" name="sort" value={sort} />}
          {dir !== "asc" && <input type="hidden" name="dir" value={dir} />}
          {assignedToFilter && <input type="hidden" name="assignedTo" value={assignedToFilter} />}
          <input
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Search by name, email or phone…"
            className="input w-full max-w-sm"
            autoComplete="off"
          />
        </form>
        {owner && employees.length > 0 && (
          <EmployeeFilter
            employees={employees}
            current={assignedToFilter}
            params={{
              ...(query && { q: query }),
              ...(statusFilter && { status: statusFilter }),
              ...(sort !== "name" && { sort }),
              ...(dir !== "asc" && { dir }),
            }}
          />
        )}
        {statusFilter && (
          <Link
            href={filterLink(null)}
            className="text-[10px] uppercase text-warm-500 hover:text-warm-800 transition-colors border border-warm-200 px-3 py-2"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}
          >
            × Clear filter
          </Link>
        )}
        {assignedToFilter && (
          <Link
            href={buildParams({ assignedTo: null, page: null })}
            className="text-[10px] uppercase text-warm-500 hover:text-warm-800 transition-colors border border-warm-200 px-3 py-2"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.1em" }}
          >
            × Clear employee
          </Link>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────── */}
      {total === 0 ? (
        <div className="border border-warm-200 bg-white p-8 text-center">
          <p className="text-sm text-warm-500" style={{ fontFamily: "var(--font-mono)" }}>
            {query
              ? `No clients matching "${query}".`
              : statusFilter
              ? `No clients with status ${CLIENT_STATUS_LABEL[statusFilter]}.`
              : "No clients yet."}
          </p>
          {!query && !statusFilter && (
            <Link href="/clients/new" className="mt-3 inline-block btn-primary">
              Add the first one
            </Link>
          )}
        </div>
      ) : (
        <>
          <p
            className="mb-3 text-[10px] uppercase text-warm-500"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.15em" }}
          >
            {query ? `${total} result${total !== 1 ? "s" : ""} for "${query}" · ` : ""}
            {statusFilter ? `${CLIENT_STATUS_LABEL[statusFilter]} · ` : ""}
            {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}
          </p>

          <div className="border border-warm-200 overflow-hidden bg-white">
            <table className="min-w-full divide-y divide-warm-100">
              <thead className="bg-warm-50 text-left">
                <tr>
                  <th
                    className="px-4 py-3 text-[9px] uppercase text-warm-500"
                    style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.2em" }}
                  >
                    <Link href={sortLink("name")} className="hover:text-warm-700 transition-colors inline-flex items-center">
                      Name<SortArrow col="name" />
                    </Link>
                  </th>
                  <th
                    className="px-4 py-3 text-[9px] uppercase text-warm-500"
                    style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.2em" }}
                  >
                    <Link href={sortLink("status")} className="hover:text-warm-700 transition-colors inline-flex items-center">
                      Status<SortArrow col="status" />
                    </Link>
                  </th>
                  <th
                    className="px-4 py-3 text-[9px] uppercase text-warm-500 hidden sm:table-cell"
                    style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.2em" }}
                  >
                    Email
                  </th>
                  <th
                    className="px-4 py-3 text-[9px] uppercase text-warm-500 hidden md:table-cell"
                    style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.2em" }}
                  >
                    <Link href={sortLink("assignedTo")} className="hover:text-warm-700 transition-colors inline-flex items-center">
                      Assigned To<SortArrow col="assignedTo" />
                    </Link>
                  </th>
                  <th
                    className="px-4 py-3 text-[9px] uppercase text-warm-500 hidden sm:table-cell"
                    style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.2em" }}
                  >
                    Project
                  </th>
                  <th
                    className="px-4 py-3 text-[9px] uppercase text-warm-500"
                    style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.2em" }}
                  >
                    Proposal
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-warm-100 text-sm">
                {clients.map((c) => {
                  const contract = c.contracts[0] ?? null;
                  return (
                    <tr key={c.id} className="hover:bg-warm-50 transition-colors">
                      <td className="px-4 py-3 font-semibold">
                        <Link href={`/clients/${c.id}`} className="text-warm-800 hover:text-warm-500 transition-colors">
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${CLIENT_STATUS_STYLE[c.clientStatus]}`}>
                          {CLIENT_STATUS_LABEL[c.clientStatus]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-warm-500 hidden sm:table-cell">
                        {c.email ?? <span className="text-warm-200">—</span>}
                      </td>
                      <td className="px-4 py-3 text-warm-500 hidden md:table-cell">
                        {c.assignedTo ? c.assignedTo.name : <span className="text-warm-200">—</span>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        {contract ? (
                          <Link
                            href={`/contracts/${contract.id}`}
                            className="text-warm-800 hover:text-warm-500 transition-colors truncate max-w-[160px] block"
                          >
                            {contract.title}
                          </Link>
                        ) : (
                          <span className="text-warm-200">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <ProposalToggleButton clientId={c.id} sent={c.proposalSent} compact />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <span
                className="text-[10px] uppercase text-warm-500"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link href={params(page - 1)} className="btn-secondary">← Prev</Link>
                )}
                {page < totalPages && (
                  <Link href={params(page + 1)} className="btn-secondary">Next →</Link>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ClientStatCell({
  label,
  value,
  href,
  active,
  border,
}: {
  label: string;
  value: number;
  href?: string;
  active?: boolean;
  border?: boolean;
}) {
  const inner = (
    <div
      className={`p-4 sm:p-5 ${border ? "border-l border-warm-200" : ""} ${
        active ? "bg-brand-600" : href ? "hover:bg-warm-50 transition-colors cursor-pointer" : ""
      }`}
    >
      <div className={`text-xs font-medium mb-1.5 ${active ? "text-warm-300" : "text-warm-500"}`}>
        {label}
      </div>
      <div
        className={`text-2xl font-normal leading-none tabular-nums ${
          active ? "text-white" : "text-warm-800"
        }`}
      >
        {value}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}
