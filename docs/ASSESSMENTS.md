# Assessment status

| Assessment             | Local evidence and outstanding items                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01 Role-based frontend | Seven seed roles and role-specific navigation. Playwright exercises receptionist and patient.                                                                                  |
| 02 Backend APIs        | Express registration, scheduling, care, lab, billing, consent and audit routes.                                                                                                |
| 03 Relational database | Versioned SQL schema. The API suite passes with embedded PostgreSQL and with a disposable native PostgreSQL 16 instance. Full Compose verification depends on Docker.                                                                  |
| 04 Clinical security   | Role gates, assigned-record scopes, consent, session rotation/revocation, origin checks, audit.                                                                                |
| 05 Processing          | Typed synthetic appointment, lab and population datasets. Validation and report tests.                                                                                         |
| 06 Analytics           | FastAPI authenticated report service.                                                                                                                                          |
| 07 Care workflows      | Transactional scheduling, manual waitlist, check-in, encounter lifecycle, prescription drafts, lab collection and results.                                                     |
| 08 Interoperability    | Local FHIR-format exports with consent. Email and SMS deliveries are recorded by a database-backed sandbox sink. External FHIR conformance and external providers remain open. |
| 09 Docker              | Compose and Dockerfiles. Local execution uses Node and a project-local Python runtime. Verify Compose on a host with Docker. Compose uses a private Redis service and a BullMQ polling worker. Redis integration has not been exercised on this host.                        |
| 10 Change review       | Repository review template. Branch protection, assigned peer review and issue tracking require a GitHub repository.                                                            |
| 11 CI/CD               | GitHub Actions checks and container build definitions. Hosted CI run and environment approvals require GitHub configuration.                                                   |
| 12 Privacy testing     | API and browser regressions for the main scheduling, consent, access, lab and session boundaries.                                                                              |
| 13 API documentation   | Route index with status codes and example requests, and local Postman collection.                                                                                              |
| 14 Deployment          | Private database and HTTPS deployment procedure. Cloud, DNS, backups, restore evidence and incident contacts are pending.                                                      |
| 15 Incident simulation | Local booking collision, cross-patient access, notification retry, and result-association regression checks. An API test injects a database disconnection and checks readiness; the live datastore outage drill remains pending.                      |

## Incident replay

| Scenario                                                 | Expected behavior                                                                                                      | Evidence                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Two concurrent reservations for one provider and time    | One success and one HTTP 409. The losing transaction has no notification.                                              | API test for overlap and delivery deduplication        |
| Patient requests a different patient's encounter         | HTTP 404 and a denied audit record.                                                                                    | API consent and encounter tests                        |
| Worker processes the same event again                    | The second pass observes zero pending jobs. A unique key guards each channel.                                          | API delivery test                                      |
| Lab team submits a result too early or in the wrong unit | The API rejects it, and a valid result references the selected lab order.                                              | API lab transition test                                |
| Database becomes unavailable                             | Record write fails and readiness is unavailable. Check request IDs, restore connectivity, then reconcile pending jobs. | Injected database outage test passed. Run a live drill on a disposable Compose deployment before release. |

## Deployment handoff

Set up a VM and DNS, terminate HTTPS with a reverse proxy, expose only the proxy, and configure the external origin explicitly. Disable demo seeding and enable secure cookies. Provision staff identities through a restricted administrative process before enabling traffic. The bootstrap migration role currently owns its tables. A deployment should separate migration ownership from application access and restrict audit modifications. Back up with `pg_dump` using an appropriately scoped account, encrypt backups, and verify recovery with `pg_restore` into a separate database before recording a recovery time. Configure readiness and structured-log monitoring plus a documented on-call contact. Capture evidence from your own environment before submission.

The demo uses a single location and synthetic data. The notification worker writes to a local delivery journal and retries pending work on subsequent polls. External delivery, a dead-letter recovery panel, and automated waitlist promotion remain open.
