"use client";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  Check,
  Clock3,
  FlaskConical,
  HeartPulse,
  LayoutGrid,
  LogOut,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";

type Role =
  "admin" | "receptionist" | "doctor" | "nurse" | "lab" | "billing" | "patient";
type User = { id: string; name: string; role: Role };
type Row = Record<string, string | number | boolean | null>;
type PageData = {
  rows: Row[];
  counts: { status: string; count: number }[];
  hasMore: boolean;
};
type Field = {
  name: string;
  label: string;
  type?: string;
  options?: [string, string][];
  value?: string;
};
type Action = {
  title: string;
  path: string;
  method: string;
  fields: Field[];
  fixed?: Record<string, unknown>;
};
const roles: Record<Role, string> = {
  admin: "Administrator",
  receptionist: "Receptionist",
  doctor: "Doctor",
  nurse: "Nurse",
  lab: "Lab technician",
  billing: "Billing officer",
  patient: "Patient",
};
const nav = [
  [
    "Overview",
    "appointments",
    LayoutGrid,
    "admin receptionist doctor nurse billing patient",
  ],
  [
    "Appointments",
    "appointments",
    CalendarDays,
    "admin receptionist doctor nurse billing patient",
  ],
  [
    "Patients",
    "patients",
    UsersRound,
    "admin receptionist doctor nurse patient",
  ],
  ["Care records", "encounters", HeartPulse, "doctor nurse patient"],
  ["Laboratory", "labs", FlaskConical, "doctor nurse patient lab"],
  ["Billing", "invoices", Receipt, "admin billing patient"],
  [
    "Availability",
    "schedules",
    Clock3,
    "admin receptionist doctor nurse patient",
  ],
  ["Waitlist", "waitlist", UsersRound, "admin receptionist patient"],
  ["Staff", "staff", UsersRound, "admin"],
  ["Departments", "departments", Activity, "admin"],
  ["Reports", "reports", Activity, "admin"],
  ["Notifications", "notifications", Activity, "admin"],
  ["Audit log", "audit", ShieldCheck, "admin"],
  ["FHIR exchange", "fhir", HeartPulse, "doctor patient"],
] as const;
const pretty = (s: string) =>
  s.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
const initials = (s: string) =>
  s
    .replace(/^Dr\. /, "")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const time = new Intl.DateTimeFormat("en-IN", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});
const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const list = (...values: string[]): [string, string][] =>
  values.map((x) => [x, pretty(x)]);
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      json.error?.message ?? "MediCore is temporarily unavailable.",
    );
  return (json.data ?? json) as T;
}
function Brand() {
  return (
    <div className="brand">
      <span>
        <HeartPulse size={23} />
      </span>
      MediCore
    </div>
  );
}
function Avatar({ name, index = 0 }: { name: string; index?: number }) {
  return (
    <span className={"avatar avatar" + (index % 4)}>{initials(name)}</span>
  );
}
function Badge({ value }: { value: string }) {
  return <span className={"badge " + value}>{pretty(value)}</span>;
}
function Login({ done }: { done: (user: User) => void }) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function login(email: string, password: string) {
    setBusy(true);
    setError("");
    try {
      done(await api<User>("login", "POST", { email, password }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <section className="loginArt">
        <Brand />
        <div>
          <small>HOSPITAL OPERATIONS</small>
          <h1>
            Care starts
            <br />
            with coordination.
          </h1>
          <p>
            Appointments, patient records, and hospital operations in one
            workspace.
          </p>
        </div>
        <span>MediCore Hospital</span>
      </section>
      <section className="loginPanel">
        <div>
          <h2>Welcome to MediCore</h2>
          <p>Sign in to your hospital workspace.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void login(String(f.get("email")), String(f.get("password")));
            }}
          >
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Sign in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
function Modal({
  label,
  close,
  children,
}: {
  label: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      {children}
    </dialog>
  );
}
function Editor({
  action,
  close,
  done,
}: {
  action: Action;
  close: () => void;
  done: (result: unknown) => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const fields = Object.fromEntries(
      action.fields.map((field) => {
        const value = String(form.get(field.name) ?? "");
        return [
          field.name,
          field.type === "checkbox"
            ? form.has(field.name)
            : field.type === "number"
              ? Number(value)
              : field.type === "datetime-local"
                ? value + ":00+05:30"
                : value,
        ];
      }),
    );
    try {
      done(
        await api(
          action.path.replaceAll(/\{(\w+)\}/g, (_, key) =>
            encodeURIComponent(String(fields[key])),
          ),
          action.method,
          action.method === "GET" ? undefined : { ...fields, ...action.fixed },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal label={action.title} close={close}>
      <header>
        <h2>{action.title}</h2>
        <button className="icon" aria-label="Close" onClick={close}>
          <X size={19} />
        </button>
      </header>
      <form onSubmit={submit}>
        {action.fields.map((f) => (
          <label key={f.name}>
            {f.type === "checkbox" ? (
              <>
                <input
                  name={f.name}
                  type="checkbox"
                  defaultChecked={f.value === "true"}
                />{" "}
                {f.label}
              </>
            ) : (
              <>
                {f.label}
                {f.options ? (
                  <select required name={f.name} defaultValue={f.value ?? ""}>
                    <option value="" disabled>
                      Select an option
                    </option>
                    {f.options.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    required
                    name={f.name}
                    type={f.type ?? "text"}
                    step={f.type === "number" ? "any" : undefined}
                    defaultValue={f.value}
                  />
                )}
              </>
            )}
          </label>
        ))}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer>
          <button className="secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Working…" : action.method === "GET" ? "Open" : "Save"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function Dashboard({ user, logout }: { user: User; logout: () => void }) {
  const allowed = nav.filter((item) => item[3].split(" ").includes(user.role));
  const [section, setSection] = useState<string>(allowed[0][0]),
    [q, setQ] = useState(""),
    [day, setDay] = useState(today()),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [action, setAction] = useState<Action | null>(null),
    [detail, setDetail] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const path =
    allowed.find((item) => item[0] === section)?.[1] ?? allowed[0][1];
  const isAppts = path === "appointments";
  const query = new URLSearchParams({ page: String(page) });
  if (isAppts) {
    if (q) query.set("q", q);
    if (day) query.set("day", day);
    if (status) query.set("status", status);
  }
  const client = useQueryClient();
  const records = useQuery({
    queryKey: [user.id, path, query.toString()],
    queryFn: () =>
      api<PageData | Row[] | Record<string, unknown>>(path + "?" + query),
    enabled: path !== "fhir",
  });
  const canBook = ["admin", "receptionist", "patient"].includes(user.role);
  const patients = useQuery({
    queryKey: [user.id, "patientOptions"],
    queryFn: () => api<Row[]>("patients"),
    enabled: canBook,
  });
  const directory = useQuery({
    queryKey: [user.id, "directory"],
    queryFn: () => api<{ providers: Row[]; departments: Row[] }>("directory"),
    enabled: canBook || user.role === "doctor",
  });
  const providerOptions: [string, string][] =
    directory.data?.providers.map((p) => [
      String(p.id),
      String(p.name) + " · " + String(p.department),
    ]) ?? [];
  const bookingFields: Field[] = [
    {
      name: "patientId",
      label: "Patient",
      options: patients.data?.map((p) => [String(p.id), String(p.name)]) ?? [],
    },
    { name: "providerId", label: "Provider", options: providerOptions },
  ];
  const open = (
    title: string,
    path: string,
    fields: Field[] = [],
    method = "POST",
    fixed?: Record<string, unknown>,
  ) => {
    setDetail(null);
    setNotice("");
    setAction({ title, path, method, fields, fixed });
  };
  const book = () =>
    open("New appointment", "appointments", [
      ...bookingFields,
      {
        name: "start",
        label: "Start time (IST)",
        type: "datetime-local",
        value: today() + "T15:00",
      },
      {
        name: "end",
        label: "End time (IST)",
        type: "datetime-local",
        value: today() + "T15:30",
      },
      { name: "reason", label: "Visit reason" },
    ]);
  const data = isAppts ? (records.data as PageData | undefined) : undefined;
  const rows = data?.rows ?? (Array.isArray(records.data) ? records.data : []);
  const fields = rows.length
    ? Object.keys(rows[0]).filter((k) => k !== "notes")
    : [];
  const counts = Object.fromEntries(
    data?.counts.map((c) => [c.status, c.count]) ?? [],
  );
  const stats = [
    [
      "Total appointments",
      Object.values(counts).reduce((a, b) => a + b, 0),
      CalendarDays,
      "All recorded visits",
    ],
    ["Scheduled", counts.scheduled ?? 0, Clock3, "Awaiting check-in"],
    ["Checked in", counts.checked_in ?? 0, UsersRound, "Patients on site"],
    ["Completed", counts.completed ?? 0, Check, "Visits completed"],
  ] as const;
  let topAction: { label: string; run: () => void } | undefined;
  if (isAppts && canBook) topAction = { label: "New appointment", run: book };
  if (path === "patients" && ["receptionist", "admin"].includes(user.role))
    topAction = {
      label: "Register patient",
      run: () =>
        open("Register patient", "patients", [
          { name: "name", label: "Full name" },
          { name: "birthDate", label: "Date of birth", type: "date" },
        ]),
    };
  if (path === "waitlist" && canBook)
    topAction = {
      label: "Join waitlist",
      run: () =>
        open("Join waitlist", "waitlist", [
          ...bookingFields,
          { name: "reason", label: "Visit reason" },
        ]),
    };
  if (path === "schedules" && ["admin", "doctor"].includes(user.role))
    topAction = {
      label: "Add availability",
      run: () =>
        open("Add availability", "schedules/{providerId}", [
          {
            name: "providerId",
            label: "Provider",
            options:
              user.role === "doctor"
                ? providerOptions.filter((p) => p[0] === user.id)
                : providerOptions,
          },
          { name: "start", label: "Start (IST)", type: "datetime-local" },
          { name: "end", label: "End (IST)", type: "datetime-local" },
        ]),
    };
  if (path === "invoices" && user.role === "billing")
    topAction = {
      label: "Create invoice",
      run: () =>
        open("Create invoice", "invoices", [
          { name: "appointmentId", label: "Appointment ID" },
          { name: "description", label: "Description" },
          { name: "cents", label: "Amount in cents", type: "number" },
        ]),
    };
  if (path === "staff")
    topAction = {
      label: "Add staff member",
      run: () =>
        open("Add staff member", "staff", [
          { name: "name", label: "Full name" },
          { name: "email", label: "Work email", type: "email" },
          {
            name: "password",
            label: "Initial password (at least 14 characters)",
            type: "password",
          },
          {
            name: "role",
            label: "Role",
            options: list("receptionist", "doctor", "nurse", "lab", "billing"),
          },
          {
            name: "departmentId",
            label: "Department",
            options:
              directory.data?.departments.map((d) => [
                String(d.id),
                String(d.name),
              ]) ?? [],
          },
        ]),
    };
  if (path === "departments")
    topAction = {
      label: "Add department",
      run: () =>
        open("Add department", "departments", [
          { name: "name", label: "Department name" },
        ]),
    };
  if (path === "fhir")
    topAction = {
      label: "Export resource",
      run: () =>
        open(
          "Export resource",
          "fhir/{kind}/{id}",
          [
            {
              name: "kind",
              label: "Resource type",
              options: list(
                "Patient",
                "Appointment",
                "Encounter",
                "Observation",
              ),
            },
            { name: "id", label: "Resource ID" },
          ],
          "GET",
        ),
    };
  function rowActions(row: Row) {
    const button = (name: string, run: () => void) => (
      <button className="link" onClick={run}>
        {name}
      </button>
    );
    const patch = (name: string, target: string, status: string) =>
      button(name, () => open(name, target, [], "PATCH", { status }));
    if (isAppts)
      return (
        <>
          {row.status === "scheduled" &&
            ["receptionist", "nurse"].includes(user.role) &&
            patch("Check in", "appointments/" + row.id, "checked_in")}
          {row.status === "scheduled" &&
            canBook &&
            patch("Cancel", "appointments/" + row.id, "cancelled")}
          {row.status === "checked_in" &&
            user.role === "doctor" &&
            button("Open encounter", () =>
              open(
                "Open encounter",
                "encounters",
                [{ name: "notes", label: "Visit notes" }],
                "POST",
                { appointmentId: row.id },
              ),
            )}
        </>
      );
    if (path === "patients" && ["receptionist", "patient"].includes(user.role))
      return button("Manage consent", () =>
        open(
          "Manage consent",
          "patients/" + row.id + "/consent",
          [
            {
              name: "clinical",
              label: "Allow care team access",
              type: "checkbox",
              value: String(row.clinical),
            },
            {
              name: "exchange",
              label: "Allow FHIR exports",
              type: "checkbox",
              value: String(row.exchange),
            },
          ],
          "PUT",
        ),
      );
    if (
      path === "labs" &&
      ["nurse", "lab"].includes(user.role) &&
      row.status === "ordered"
    )
      return patch("Collect sample", "labs/" + row.id, "collected");
    if (path === "labs" && user.role === "lab" && row.status === "collected")
      return button("Record result", () =>
        open("Record result", "labs/" + row.id + "/result", [
          { name: "value", label: "Result", type: "number" },
          {
            name: "unit",
            label: "Unit",
            value: row.test === "Hemoglobin" ? "g/dL" : "mg/dL",
          },
          { name: "low", label: "Reference low", type: "number" },
          { name: "high", label: "Reference high", type: "number" },
        ]),
      );
    if (
      path === "invoices" &&
      user.role === "billing" &&
      row.status === "unpaid"
    )
      return (
        <>
          {patch("Mark paid", "invoices/" + row.id, "paid")}
          {patch("Void", "invoices/" + row.id, "void")}
        </>
      );
    if (path === "encounters") {
      const target = "encounters/" + row.id;
      return (
        <>
          {button("View", () => open("View encounter", target, [], "GET"))}
          {user.role === "doctor" && row.status === "open" && (
            <>
              {button("Update", () =>
                open(
                  "Update encounter",
                  target,
                  [
                    { name: "notes", label: "Notes", value: String(row.notes) },
                    {
                      name: "status",
                      label: "Status",
                      options: list("open", "closed"),
                      value: "open",
                    },
                  ],
                  "PATCH",
                ),
              )}
              {button("Diagnosis", () =>
                open("Add diagnosis", target + "/diagnoses", [
                  { name: "code", label: "Code" },
                  { name: "description", label: "Description" },
                ]),
              )}
              {button("Prescription", () =>
                open("Add prescription", target + "/prescriptions", [
                  { name: "medication", label: "Medication" },
                  { name: "dose", label: "Dose" },
                  { name: "instructions", label: "Instructions" },
                ]),
              )}
              {button("Lab order", () =>
                open("Order lab test", target + "/labs", [
                  {
                    name: "test",
                    label: "Test",
                    options: list("Hemoglobin", "Glucose", "Creatinine"),
                  },
                ]),
              )}
            </>
          )}
        </>
      );
    }
  }
  return (
    <div className="shell">
      <aside>
        <Brand />
        <div className="hospital">
          <span>
            <Activity size={17} />
          </span>
          <div>
            <strong>MediCore Hospital</strong>
            <small>Hospital workspace</small>
          </div>
        </div>
        <nav aria-label="Workspace">
          <small>WORKSPACE</small>
          {allowed.map(([name, , Icon]) => (
            <button
              key={name}
              className={section === name ? "selected" : ""}
              onClick={() => {
                setSection(name);
                setPage(1);
                setNotice("");
              }}
            >
              <Icon size={18} />
              {name}
            </button>
          ))}
        </nav>
        <div className="asideFoot">● &nbsp; Synthetic data workspace</div>
      </aside>
      <main>
        <header className="top">
          <div className="crumb">
            Workspace <span>/</span> <strong>{section}</strong>
          </div>
          <select
            className="mobile"
            aria-label="Workspace section"
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              setPage(1);
            }}
          >
            {allowed.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <div className="profile">
            <Avatar name={user.name} />
            <div>
              <strong>{user.name}</strong>
              <small>{roles[user.role]}</small>
            </div>
            <button className="icon" aria-label="Sign out" onClick={logout}>
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">
                {roles[user.role].toUpperCase()} WORKSPACE
              </div>
              <h1>
                {section === "Overview" ? "Operations overview" : section}
              </h1>
              <p>
                {isAppts
                  ? "Track appointments and coordinate patient visits."
                  : path === "fhir"
                    ? "Export synthetic resources with patient consent."
                    : "View and manage " + section.toLowerCase() + "."}
              </p>
            </div>
            {topAction && (
              <button className="primary" onClick={topAction.run}>
                <Plus size={17} />
                {topAction.label}
              </button>
            )}
          </div>
          {notice && (
            <p className="notice" role="status">
              {notice}
            </p>
          )}
          {isAppts && (
            <div className="stats">
              {stats.map(([name, value, Icon, description], index) => (
                <article key={name}>
                  <span className={"statIcon avatar" + index}>
                    <Icon size={20} />
                  </span>
                  <div>{name}</div>
                  <strong>{records.isPending ? "—" : value}</strong>
                  <small>{description}</small>
                </article>
              ))}
            </div>
          )}
          <section className="panel">
            <div className="panelHead">
              <div>
                <h2>{isAppts ? "Appointment schedule" : section}</h2>
                {isAppts && (
                  <p>Visit times are shown in India Standard Time.</p>
                )}
              </div>
              {isAppts && (
                <div className="dateField">
                  <CalendarDays size={16} />
                  <input
                    aria-label="Appointment date"
                    type="date"
                    value={day}
                    onChange={(e) => {
                      setDay(e.target.value);
                      setPage(1);
                    }}
                  />
                  {day && (
                    <button
                      aria-label="Show all dates"
                      className="icon"
                      onClick={() => {
                        setDay("");
                        setPage(1);
                      }}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
              )}
            </div>
            {isAppts && (
              <div className="filters">
                <div>
                  {[
                    "",
                    "scheduled",
                    "checked_in",
                    "completed",
                    "cancelled",
                  ].map((s) => (
                    <button
                      key={s}
                      className={s === status ? "selected" : ""}
                      onClick={() => {
                        setStatus(s);
                        setPage(1);
                      }}
                    >
                      {s ? pretty(s) : "All visits"}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search appointments"
                    aria-label="Search appointments"
                  />
                </label>
              </div>
            )}
            {path === "fhir" ? (
              <p className="empty">
                Choose Patient, Appointment, Encounter, or Observation and enter
                its resource ID.
              </p>
            ) : records.isPending ? (
              <p className="empty">Loading records…</p>
            ) : records.error ? (
              <p className="empty error" role="alert">
                {records.error.message}
              </p>
            ) : rows.length > 0 ? (
              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      {(isAppts
                        ? ["Patient", "Provider", "Time", "Status"]
                        : fields.map(pretty)
                      ).map((k) => (
                        <th key={k}>{k}</th>
                      ))}
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={String(row.id)}>
                        {isAppts ? (
                          <>
                            <td>
                              <div className="person">
                                <Avatar
                                  name={String(row.patient)}
                                  index={index}
                                />
                                <div>
                                  <strong>{row.patient}</strong>
                                  <small>
                                    {row.reason ?? "Visit " + row.id}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <strong>{row.provider}</strong>
                              <small>{row.department}</small>
                            </td>
                            <td>
                              <strong>
                                {time.format(new Date(String(row.starts_at)))}
                              </strong>
                              <small>
                                {date.format(new Date(String(row.starts_at)))}
                              </small>
                            </td>
                            <td>
                              <Badge value={String(row.status)} />
                            </td>
                          </>
                        ) : (
                          fields.map((key) => (
                            <td key={key}>
                              {key === "status" ? (
                                <Badge value={String(row[key])} />
                              ) : typeof row[key] === "boolean" ? (
                                row[key] ? (
                                  "Allowed"
                                ) : (
                                  "Restricted"
                                )
                              ) : (
                                String(row[key] ?? "—")
                              )}
                            </td>
                          ))
                        )}
                        <td>{rowActions(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : path === "reports" ? (
              <pre>{JSON.stringify(records.data, null, 2)}</pre>
            ) : (
              <p className="empty">No records match this view.</p>
            )}
            {(isAppts || Array.isArray(records.data)) && (
              <div className="pager">
                <span>Page {page}</span>
                <div>
                  <button
                    className="secondary"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="secondary"
                    disabled={isAppts ? !data?.hasMore : rows.length < 25}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>
          <footer className="bottom">
            <span>MediCore Hospital Operations</span>
            <span>All times in IST</span>
          </footer>
        </div>
        {action && (
          <Editor
            action={action}
            close={() => setAction(null)}
            done={(result) => {
              if (action.method === "GET") setDetail(result);
              else setNotice(action.title + " saved.");
              setAction(null);
              void client.invalidateQueries();
            }}
          />
        )}
        {detail !== null && (
          <Modal label="Record details" close={() => setDetail(null)}>
            <header>
              <h2>Record details</h2>
              <button
                className="icon"
                aria-label="Close"
                onClick={() => setDetail(null)}
              >
                <X size={19} />
              </button>
            </header>
            <pre>{JSON.stringify(detail, null, 2)}</pre>
            {user.role === "doctor" &&
              typeof detail === "object" &&
              "prescriptions" in detail &&
              Array.isArray(detail.prescriptions) &&
              detail.prescriptions
                .filter((p: Row) => p.status === "draft")
                .map((p: Row) => (
                  <button
                    key={String(p.id)}
                    className="link"
                    onClick={() =>
                      open(
                        "Update prescription",
                        "prescriptions/" + p.id,
                        [
                          {
                            name: "status",
                            label: "New status",
                            options: list("issued", "cancelled"),
                          },
                        ],
                        "PATCH",
                      )
                    }
                  >
                    Update {p.medication}
                  </button>
                ))}
          </Modal>
        )}
      </main>
    </div>
  );
}
function Workspace() {
  const client = useQueryClient();
  const current = useQuery({
    queryKey: ["session"],
    queryFn: () => api<User>("me"),
  });
  if (current.isPending)
    return (
      <div className="loading">
        <Brand />
        Loading workspace…
      </div>
    );
  if (!current.data)
    return <Login done={(user) => client.setQueryData(["session"], user)} />;
  return (
    <Dashboard
      key={current.data.id}
      user={current.data}
      logout={() => {
        void api("logout", "POST", {})
          .then(() => {
            client.removeQueries({
              predicate: (query) => query.queryKey[0] !== "session",
            });
            client.setQueryData(["session"], null);
          })
          .catch(() => window.alert("Unable to sign out. Please retry."));
      }}
    />
  );
}
export default function Page() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 10000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Workspace />
    </QueryClientProvider>
  );
}
