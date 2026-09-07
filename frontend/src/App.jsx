/**
 * App.jsx — Top-level routing and layout shell
 *
 * Reads session state from AuthContext and conditionally renders:
 *  - AuthScreen      → not signed in
 *  - Registration    → signed in but not registered on-chain yet
 *  - PendingApproval → registered but a College/Company awaiting admin review
 *  - StudentDashboard, CollegeDashboard, CompanyDashboard → role-based routing
 *
 * `/admin` is a separate, plain-pathname route to the platform-admin
 * verification panel — no client-side router needed for one extra page.
 */

import React from "react";
import { AuthProvider, useAuth } from "./context/AuthContext.jsx";
import Registration       from "./components/Registration.jsx";
import StudentDashboard   from "./components/StudentDashboard.jsx";
import CollegeDashboard   from "./components/CollegeDashboard.jsx";
import CompanyDashboard   from "./components/CompanyDashboard.jsx";
import AuthScreen         from "./components/AuthScreen.jsx";
import PendingApproval    from "./components/PendingApproval.jsx";
import AdminPanel         from "./components/AdminPanel.jsx";
import PublicDashboard    from "./components/PublicDashboard.jsx";
import ResetPassword      from "./components/ResetPassword.jsx";
import Navbar             from "./components/Navbar.jsx";
import { ErrorBoundary }  from "./components/ErrorBoundary.jsx";

// ── Inner shell (has access to context) ──────────────────────────────────────
function AppShell() {
  const { status, actor } = useAuth();

  const renderMain = () => {
    // Viewable by anyone, signed in or not — that's the whole point.
    if (window.location.pathname === "/public") return <PublicDashboard />;
    if (window.location.pathname === "/reset-password") return <ResetPassword />;
    if (status !== "authenticated") return <AuthScreen />;
    if (!actor) return <Registration />;
    if (actor.status === "Pending" || actor.status === "Rejected") return <PendingApproval />;
    if (actor.role === "Student") return <StudentDashboard />;
    if (actor.role === "College") return <CollegeDashboard />;
    if (actor.role === "Company") return <CompanyDashboard />;
    return <AuthScreen />;
  };

  return (
    <>
      <Navbar />
      <main>{renderMain()}</main>
    </>
  );
}

// ── Root export (wraps in provider) ──────────────────────────────────────────
export default function App() {
  if (window.location.pathname === "/admin") {
    return (
      <ErrorBoundary>
        <AdminPanel />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
