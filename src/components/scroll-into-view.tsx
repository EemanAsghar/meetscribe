"use client";

import { useEffect } from "react";

export function ScrollIntoView({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [targetId]);
  return null;
}
