import { supabase } from './supabaseClient'
Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter as Router, Navigate, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";
import { queryClientInstance } from "@/lib/query-client";
import { AuthProvider } from "@/lib/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import ScrollToTop from "@/components/ScrollToTop";
import PageNotFound from "@/lib/PageNotFound";

import Home from "@/pages/Home";
import Success from "@/pages/Success";
import Studio from "@/pages/Studio";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import OAuthConsent from "@/pages/OAuthConsent";

export default function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/success" element={<Success />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/consent" element={<OAuthConsent />} />
            <Route
              path="/studio"
              element={<ProtectedRoute unauthenticatedElement={<Navigate to="/login?returnTo=/studio" replace />} />}
            >
              <Route index element={<Studio />} />
            </Route>
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  );
}
