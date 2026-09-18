import { signOut } from "@/app/actions";
import { Sidebar } from "@/components/sidebar";
import { requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar user={{ name: user.name, avatarColor: user.avatarColor }} signOut={signOut} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
