"use client";

import { createContext, useContext } from "react";
import type { Account } from "@/lib/account";

const AccountContext = createContext<Account | null>(null);

/** The signed-in account (read once by the (app) layout). Null outside an AppShell. */
export const useAccount = () => useContext(AccountContext);
export const AccountProvider = AccountContext.Provider;
