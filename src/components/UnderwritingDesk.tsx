"use client";

import { useCallback, useEffect, useState } from "react";
import { AccountView } from "./desk/AccountView";
import { ClientsView } from "./desk/ClientsView";
import { DeskGate } from "./desk/DeskGate";
import { MattersView } from "./desk/MattersView";
import { ProposalComposer } from "./desk/ProposalComposer";
import { TeamView } from "./desk/TeamView";
import {
  SESSION_EXPIRED_EVENT,
  call,
  post,
  type DeskUser,
  type NotificationConfiguration,
  type ProjectRow,
} from "./desk/deskApi";

type View = "send" | "clients" | "matters" | "team" | "account";

type Status = {
  authenticated: boolean;
  user?: DeskUser;
  needsSetup?: boolean;
  bootstrapReady?: boolean;
  mailerConfigured?: boolean;
  notifications?: NotificationConfiguration;
};

function roleLabel(role: DeskUser["role"]): string {
  if (role === "super_admin") return "super administrator";
  return role === "admin" ? "administrator" : "staff";
}

export function UnderwritingDesk() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<DeskUser | null>(null);
  const [gate, setGate] = useState({ needsSetup: false, bootstrapReady: true });
  const [mailerConfigured, setMailerConfigured] = useState(false);
  const [notifications, setNotifications] = useState<NotificationConfiguration | null>(null);
  const [view, setView] = useState<View>("send");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The session lives in an HttpOnly cookie, so the browser cannot read it: ask the server.
  useEffect(() => {
    void (async () => {
      try {
        const status = await call<Status>("/auth/status");
        if (status.authenticated && status.user) {
          setUser(status.user);
          setMailerConfigured(Boolean(status.mailerConfigured));
          setNotifications(status.notifications ?? null);
        } else {
          setGate({ needsSetup: Boolean(status.needsSetup), bootstrapReady: status.bootstrapReady !== false });
        }
      } catch {
        setError("The console could not be reached. Please reload.");
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const report = useCallback((message: string | null) => {
    setError(message);
  }, []);

  // A withdrawn or lapsed session drops straight back to the sign-in screen.
  useEffect(() => {
    function expired() {
      setUser(null);
      setProjects([]);
      setNotifications(null);
      setView("send");
      setError("Your session has ended. Please sign in again.");
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);

  async function signOut() {
    try {
      await post("/auth/logout");
    } catch {
      // Signing out locally matters more than the round trip succeeding.
    }
    setUser(null);
    setProjects([]);
    setNotifications(null);
    setView("send");
    setGate((current) => ({ ...current, needsSetup: false }));
  }

  if (!ready) {
    return (
      <div className="desk-gate">
        <p className="eyebrow">Sino Secure</p>
        <h1 className="desk-title">Underwriting console</h1>
        <p>Checking your session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        {error ? (
          <p className="form-error desk-notice" role="alert">
            {error}
          </p>
        ) : null}
        <DeskGate
          gate={gate}
          onSignedIn={(signedIn) => {
            setUser(signedIn.user);
            setMailerConfigured(Boolean(signedIn.mailerConfigured));
            setNotifications(signedIn.notifications ?? null);
            setError(null);
          }}
        />
      </>
    );
  }

  const views: { key: View; label: string }[] = [
    { key: "send", label: "Client token / proposal" },
    { key: "clients", label: "Clients" },
    { key: "matters", label: "Matters" },
    ...(user.role === "super_admin" ? ([{ key: "team", label: "Team & settings" }] as const) : []),
    { key: "account", label: "Account" },
  ];

  return (
    <div className="desk">
      <header className="desk-head">
        <div>
          <p className="eyebrow">Underwriting console</p>
          <h1 className="desk-title">{user.name}</h1>
          <p className="matter-meta">
            {user.email} · {roleLabel(user.role)}
          </p>
        </div>
        <div className="desk-actions">
          <button className="ghost-button" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {user.mustChangePassword ? (
        <AccountView user={user} onUpdated={setUser} />
      ) : (
        <>
          <nav className="desk-nav">
            {views.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.key === view ? "active" : undefined}
                onClick={() => {
                  setView(item.key);
                  setError(null);
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          {view === "send" ? (
            <ProposalComposer
              user={user}
              mailerConfigured={mailerConfigured}
              onIssued={(project) => setProjects((current) => [project, ...current])}
            />
          ) : null}
          {view === "clients" ? <ClientsView onError={report} /> : null}
          {view === "matters" ? <MattersView projects={projects} onProjects={setProjects} onError={report} /> : null}
          {view === "team" && user.role === "super_admin" ? (
            <TeamView user={user} notifications={notifications} onError={report} />
          ) : null}
          {view === "account" ? <AccountView user={user} onUpdated={setUser} /> : null}
        </>
      )}
    </div>
  );
}
