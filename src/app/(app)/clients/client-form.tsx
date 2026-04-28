import type { ClientStatus } from "@prisma/client";

type Initial = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  assignedToId?: string | null;
  clientStatus?: ClientStatus;
};

const CLIENT_STATUS_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: "NEW",                label: "New" },
  { value: "FIRST_APPOINTMENT",  label: "First Meeting" },
  { value: "SECOND_APPOINTMENT", label: "Second Meeting" },
  { value: "PENDING",            label: "Pending" },
  { value: "CLOSED",             label: "Closed (Engaged)" },
  { value: "BLNT",               label: "Nice Try" },
];

export function ClientForm({
  action,
  initial,
  submitLabel,
  employees = [],
}: {
  action: (formData: FormData) => void | Promise<void>;
  initial?: Initial;
  submitLabel: string;
  employees?: { id: string; name: string }[];
}) {
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="name">Name *</label>
        <input id="name" name="name" required defaultValue={initial?.name ?? ""} className="input" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={initial?.email ?? ""} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="phone">Phone</label>
          <input id="phone" name="phone" defaultValue={initial?.phone ?? ""} className="input" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="address">Address</label>
        <input id="address" name="address" defaultValue={initial?.address ?? ""} className="input" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="clientStatus">Client status</label>
          <select
            id="clientStatus"
            name="clientStatus"
            defaultValue={initial?.clientStatus ?? "NEW"}
            className="input"
          >
            {CLIENT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="assignedToId">Assigned employee</label>
          <select
            id="assignedToId"
            name="assignedToId"
            defaultValue={initial?.assignedToId ?? ""}
            className="input"
          >
            <option value="">— Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="label" htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" rows={4} defaultValue={initial?.notes ?? ""} className="input" />
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary">{submitLabel}</button>
      </div>
    </form>
  );
}
