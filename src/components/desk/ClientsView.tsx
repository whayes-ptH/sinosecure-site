"use client";

import { useCallback, useEffect, useState } from "react";
import { call, formatDate, type ClientRow } from "./deskApi";

/** Readable client register. Projects remain separate and are opened from Matters. */
export function ClientsView({ onError }: { onError: (message: string | null) => void }) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    onError(null);
    try {
      const payload = await call<{ clients: ClientRow[] }>("/clients");
      setClients(payload.clients ?? []);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The client register could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="desk-form">
        <p className="eyebrow">Client register</p>
        <p className="form-lead">
          A client can hold multiple projects. Each project keeps its own reference, proposal, documents, expiry and
          current upload token.
        </p>
      </div>
      <table className="desk-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Primary contact</th>
            <th>Projects</th>
            <th>Status</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td>{client.name}</td>
              <td>
                {client.contactName ?? "—"}
                {client.contactEmail ? <small>{client.contactEmail}</small> : null}
              </td>
              <td>{client.projectCount}</td>
              <td><span className="status-pill">{client.status}</span></td>
              <td>{formatDate(client.createdAt)}</td>
            </tr>
          ))}
          {!clients.length ? (
            <tr>
              <td colSpan={5}>{loading ? "Loading…" : "No clients yet. Create the first client and project from Client token / proposal."}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
