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
  const [status, setStatus] = useState("idle"); // idle | authenticated | unauthenticated | unavailable
  // Why a saved session couldn't be checked, when status is "unavailable".
  const [serviceError, setServiceError] = useState("");
  const [user, setUser] = useState(null); // { email, address }
  const [actor, setActor] = useState(null); // serialized actor from GET /me, or null
  // What is still outstanding before this account counts as real. An account
  // can be signed in and useful without being verified — that is the point.
  const [verification, setVerification] = useState(null);
  const [profile, setProfile] = useState(null);

  const refreshActor = useCallback(async () => {
    const me = await api.get("/me");
    setUser({ email: me.email, address: me.address });
    setActor(me.actor);
    setVerification(me.verification ?? null);
    setProfile(me.profile ?? null);
    setStatus("authenticated");
  }, []);

  // Resume a saved session if there is one.
  const resumeSession = useCallback(() => {
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!savedToken) {
      setStatus("unauthenticated");
      return;
    }
    setAuthToken(savedToken);
    refreshActor().catch((err) => {
      // Only a rejected token ends the session. Any other failure — the
      // backend restarting, or down — used to sign people out too, so a
      // server restart looked like being logged out for no reason.
      if (err.status === 401) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setAuthToken(null);
        setStatus("unauthenticated");
        return;
      }
      setServiceError(err.message);
      setStatus("unavailable");
    });
  }, [refreshActor]);

  useEffect(() => { resumeSession(); }, [resumeSession]);

  const applySession = useCallback(
    async (token) => {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      setAuthToken(token);
      await refreshActor();
    },
    [refreshActor]
  );

  /**
   * Signs up and signs straight in.
   *
   * Signup used to return no session: the account was unusable until the
   * emailed code came back, which put a wall at the very first step and
   * required a working inbox before you could even look around. Confirming the
   * email is now something you do to finish verifying, not the price of entry.
   */
  const signup = useCallback(
    async (email, password) => {
      const result = await api.post("/auth/signup", { email, password });
      if (result.token) await applySession(result.token);
      return result;
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

  const verifyEmailOtp = useCallback(
    async (email, otp) => {
      const { token } = await api.post("/auth/verify-email", { email, otp });
      await applySession(token);
    },
    [applySession]
  );

  const resendOtp = useCallback(async (email) => {
    return api.post("/auth/resend-otp", { email });
  }, []);

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

  /**
   * Registers this account in a role.
   * @dev Passes the payload straight through rather than naming each field. The
   *      student profile field list is expected to grow, and a destructured
   *      allow-list here would silently drop anything added to it — the failure
   *      would look like a backend bug rather than a missing line in this file.
   */
  const registerActor = useCallback(async (payload) => {
    const { actor: newActor } = await api.post("/me/register", payload);
    setActor(newActor);
  }, []);

  /** Records a student's roll number — verifies them, or queues them. */
  const claimRollNumber = useCallback(
    async (payload) => {
      const result = await api.post("/me/claim-roll-number", payload);
      await refreshActor();
      return result;
    },
    [refreshActor]
  );

  /**
   * Replaces this session's token in place.
   *
   * Changing a password ends every session, including this one — the server
   * hands back a fresh token so the person who just changed it is not thrown
   * out of the screen they are standing on.
   */
  const setToken = useCallback((token) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setAuthToken(token);
  }, []);

  const value = {
    status,
    setToken,
    serviceError,
    resumeSession,
    verification,
    profile,
    claimRollNumber,
    user,
    actor,
    signup,
    login,
    verifyEmailOtp,
    resendOtp,
    logout,
    forgotPassword,
    resetPassword,
    registerActor,
    refreshActor,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
