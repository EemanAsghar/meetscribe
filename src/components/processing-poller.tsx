"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While a meeting is processing, re-fetch the server-rendered page every 2 seconds until it is not. */
export function ProcessingPoller() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [router]);
  return null;
}
