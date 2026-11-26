CREATE TABLE IF NOT EXISTS departments (
  id text PRIMARY KEY, name text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password text NOT NULL,
  role text NOT NULL CHECK (role IN ('patient','receptionist','doctor','nurse','lab','billing','admin')),
  department_id text REFERENCES departments
);
CREATE TABLE IF NOT EXISTS patients (
  id text PRIMARY KEY, user_id text UNIQUE REFERENCES users, name text NOT NULL, birth_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS consents (
  patient_id text PRIMARY KEY REFERENCES patients, clinical boolean NOT NULL DEFAULT false,
  exchange boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schedules (
  id text PRIMARY KEY, provider_id text NOT NULL REFERENCES users,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS appointments (
  id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients, provider_id text NOT NULL REFERENCES users,
  starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  reason text NOT NULL, status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','checked_in','completed','cancelled')),
  checked_in_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointment_provider_time ON appointments(provider_id, starts_at, ends_at) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS appointment_patient ON appointments(patient_id);
CREATE TABLE IF NOT EXISTS waitlist (
  id text PRIMARY KEY, patient_id text NOT NULL REFERENCES patients, provider_id text NOT NULL REFERENCES users,
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(patient_id, provider_id)
);
CREATE TABLE IF NOT EXISTS encounters (
  id text PRIMARY KEY, appointment_id text NOT NULL UNIQUE REFERENCES appointments,
  notes text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS diagnoses (
  id text PRIMARY KEY, encounter_id text NOT NULL REFERENCES encounters, code text NOT NULL, description text NOT NULL
);
CREATE TABLE IF NOT EXISTS prescriptions (
  id text PRIMARY KEY, encounter_id text NOT NULL REFERENCES encounters, medication text NOT NULL,
  dose text NOT NULL, instructions text NOT NULL, status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','cancelled'))
);
CREATE TABLE IF NOT EXISTS labs (
  id text PRIMARY KEY, encounter_id text NOT NULL REFERENCES encounters, test text NOT NULL,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','collected','resulted')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS results (
  lab_id text PRIMARY KEY REFERENCES labs, value numeric NOT NULL, unit text NOT NULL,
  reference_low numeric NOT NULL, reference_high numeric NOT NULL CHECK(reference_high >= reference_low),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY, appointment_id text NOT NULL UNIQUE REFERENCES appointments,
  description text NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','void'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id text REFERENCES users,
  action text NOT NULL, target text NOT NULL, outcome text NOT NULL, request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY, appointment_id text NOT NULL REFERENCES appointments, event text NOT NULL,
  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(appointment_id, event)
);
CREATE TABLE IF NOT EXISTS notification_deliveries (
  job_id text NOT NULL REFERENCES outbox, channel text NOT NULL CHECK(channel IN ('email','sms')),
  delivered_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id, channel)
);
