import Workspace from "@/components/workspace";
export const dynamic = "force-dynamic";
export default function Page() {
  return <Workspace schoolName={process.env.SCHOOL_NAME || "Observe"} />;
}
