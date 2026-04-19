import AuthShell from "@/app/components/auth-shell";
import WorkspaceBoard from "@/app/components/workspace-board";

export default function Home() {
  return (
    <AuthShell>
      <WorkspaceBoard />
    </AuthShell>
  );
}
