/**
 * AuthContext.jsx — Custodial account session state
 *
 * Replaces the old MetaMask-based Web3Context entirely. There is no
 * `window.ethereum`/`ethers.BrowserProvider` anywhere in this file — signing
 * in is a normal email + password flow against the backend, which holds a
 * blockchain wallet on the user's behalf (see backend/src/wallets.js) and
 * signs transactions for them. See ../utils/api.js for the request layer.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, setAuthToken } from "../utils/api.js";

const TOKEN_STORAGE_KEY = "chainproof_token";

const AuthContext = createContext(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("idle"); // idle | authenticated | unauthenticated
  const [user, setUser] = useState(null); // { email, address }
  const [actor, setActor] = useState(null); // serialized actor from GET /me, or null

  const refreshActor = useCallback(async () => {
    const me = await api.get("/me");
    setUser({ email: me.email, address: me.address });
    setActor(me.actor);
    setStatus("authenticated");
  }, []);

  // On mount, resume a saved session if there is one.
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!savedToken) {
      setStatus("unauthenticated");
      return;
    }
    setAuthToken(savedToken);
    refreshActor().catch(() => {
      // Saved token is invalid/expired — clear it and start fresh.
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setAuthToken(null);
      setStatus("unauthenticated");
    });
  }, [refreshActor]);

  const applySession = useCallback(
    async (token) => {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      setAuthToken(token);
      await refreshActor();
    },
    [refreshActor]
  );

  const signup = useCallback(
    async (email, password) => {
      const { token } = await api.post("/auth/signup", { email, password });
      await applySession(token);
    },
    [applySession]
  );

  const login = useCallback(
    async (email, password) => {
      const { token } = await api.post("/auth/login", { email, password });
      await applySession(token);
    },
    [applySession]
  );

  const logout = useCallback(async () => {
    // Best-effort — invalidates the token server-side (see backend's
    // token_version), but the local session clears either way.
    try {
      await api.post("/auth/logout");
    } catch {
      // Ignore — e.g. the token was already invalid. Still clear locally.
    }
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAuthToken(null);
    setUser(null);
    setActor(null);
    setStatus("unauthenticated");
  }, []);

  const forgotPassword = useCallback(async (email) => {
    return api.post("/auth/forgot-password", { email });
  }, []);

  const resetPassword = useCallback(async (token, newPassword) => {
    return api.post("/auth/reset-password", { token, newPassword });
  }, []);

  const registerActor = useCallback(async ({ role, name, collegeAddress, website }) => {
    const { actor: newActor } = await api.post("/me/register", { role, name, collegeAddress, website });
    setActor(newActor);
  }, []);

  const value = {
    status,
    user,
    actor,
    signup,
    login,
    logout,
    forgotPassword,
    resetPassword,
    registerActor,
    refreshActor,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
